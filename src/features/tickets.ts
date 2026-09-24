import { randomBytes } from 'node:crypto';
import { ButtonStyle, ChannelType, PermissionFlagsBits, escapeMarkdown, type Client, type GuildMember, type Guild, type OverwriteResolvable } from 'discord.js';
import { interpolate, type Config } from '../core/config.js';
import type { Store } from '../core/store.js';
import type { Audit } from '../core/audit.js';
import { button, card } from '../core/ui.js';
import { UserError, errorText } from '../core/errors.js';
import { isManager } from '../core/permissions.js';

export interface Ticket { id: string; guildId: string; ownerId: string; channelId: string; state: 'opening' | 'open' | 'closing' | 'closed'; createdAt: number; subject: string }
export class Tickets {
  private busy = new Set<string>();
  constructor(private client: Client, private config: Config, private store: Store, private audit: Audit) {}
  panel(guildId: string) {
    const cfg = this.config.guild(guildId).tickets;
    if (!cfg.enabled) throw new UserError(this.config.t('common.disabled'));
    return card(this.config, cfg.panelTitle, cfg.panelBody, { buttons: [button('ticket:open', cfg.openLabel, ButtonStyle.Primary)] });
  }
  async recover(): Promise<void> {
    for (const ticket of this.store.list<Ticket>('tickets').filter(t => t.state === 'opening' || t.state === 'closing')) {
      try {
        const guild = await this.client.guilds.fetch(ticket.guildId);
        const channels = await guild.channels.fetch();
        const channel = ticket.channelId ? channels.get(ticket.channelId) : channels.find(c => c?.type === ChannelType.GuildText && c.topic === `sole-ticket:${ticket.id}`);
        if (channel) { ticket.channelId = channel.id; ticket.state = 'open'; }
        else ticket.state = 'closed';
        this.store.set('tickets', ticket.id, ticket);
      } catch (error) { await this.audit.write(ticket.guildId, `티켓 ${ticket.id} 복구 실패: ${errorText(error)}`); }
    }
  }
  async open(member: GuildMember, subject: string, description: string): Promise<string> {
    const guild = member.guild, cfg = this.config.guild(guild.id).tickets;
    if (!cfg.enabled) throw new UserError(this.config.t('common.disabled'));
    if (!subject.trim() || subject.length > 100 || !description.trim() || description.length > 1800) throw new UserError('문의 제목과 내용을 입력해 주세요.');
    const key = `${guild.id}:${member.id}`;
    if (this.busy.has(key)) throw new UserError('문의 채널을 생성 중이에요. 잠시 기다려 주세요.');
    this.busy.add(key);
    try {
      const existing = this.store.list<Ticket>('tickets').filter(t => t.guildId === guild.id && t.ownerId === member.id && t.state !== 'closed');
      const valid: Ticket[] = [];
      for (const ticket of existing) {
        const channel = ticket.channelId ? await guild.channels.fetch(ticket.channelId).catch(error => { if (error.code === 10003) return null; throw error; }) : null;
        if (channel || ticket.state === 'opening') valid.push(ticket);
        else { ticket.state = 'closed'; this.store.set('tickets', ticket.id, ticket); }
      }
      if (valid.length >= cfg.maxOpenPerUser) throw new UserError(this.config.t('ticket.exists', { channel: valid[0]?.channelId ? `<#${valid[0].channelId}>` : '생성 중' }));
      const category = await guild.channels.fetch(cfg.categoryId);
      if (category?.type !== ChannelType.GuildCategory) throw new UserError(this.config.t('common.channelMissing'));
      const me = await guild.members.fetchMe();
      if (!category.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) throw new UserError('봇에 카테고리 보기·채널 관리·역할 관리 권한이 필요해요.');
      const roles = [...new Set([...cfg.supportRoleIds, ...this.config.guild(guild.id).managerRoleIds])];
      for (const roleId of roles) if (roleId === guild.id || !await guild.roles.fetch(roleId)) throw new UserError('티켓 담당 역할 ID를 확인해 주세요. @everyone은 사용할 수 없어요.');
      const id = randomBytes(8).toString('hex');
      const ticket: Ticket = { id, guildId: guild.id, ownerId: member.id, channelId: '', state: 'opening', createdAt: Date.now(), subject };
      const access = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles];
      const overwrites: OverwriteResolvable[] = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me.id, allow: [...access, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles] },
        { id: member.id, allow: access },
        ...roles.map(roleId => ({ id: roleId, allow: access })),
      ];
      this.store.set('tickets', id, ticket);
      let created = false;
      try {
        const name = interpolate(cfg.channelName, { username: member.user.username, number: id.slice(-6) }).toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 100) || `ticket-${id}`;
        const channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, topic: `sole-ticket:${id}`, permissionOverwrites: overwrites, reason: `문의 생성: ${member.id}` });
        created = true; ticket.channelId = channel.id; ticket.state = 'open'; this.store.set('tickets', id, ticket);
        try {
          await channel.send(card(this.config, this.config.t('ticket.subject', { subject: escapeMarkdown(subject) }), `${interpolate(cfg.intro, { user: `<@${member.id}>` })}\n\n${escapeMarkdown(description)}`, { buttons: [button(`ticket:close:${id}`, this.config.t('button.close'), ButtonStyle.Danger)] }));
        } catch (error) { await this.audit.write(guild.id, `티켓 <#${channel.id}> 안내 전송 실패. /ticket close로 종료 가능: ${errorText(error)}`); }
        return channel.id;
      } catch (error) {
        // API 응답이 유실되었을 수 있으므로 opening 레코드는 복구용으로 유지합니다.
        if (!created) await this.audit.write(guild.id, `티켓 ${id} 생성 결과 확인 필요. 재시작 시 채널 주제로 복구합니다: ${errorText(error)}`);
        const status = (error as { status?: number }).status;
        if (!created && status && status >= 400 && status < 500) this.store.delete('tickets', id);
        throw error;
      }
    } finally { this.busy.delete(key); }
  }
  findByChannel(guildId: string, channelId: string): Ticket | undefined {
    return this.store.list<Ticket>('tickets').find(t => t.guildId === guildId && t.channelId === channelId && t.state !== 'closed');
  }
  authorize(id: string, member: GuildMember): Ticket {
    const ticket = this.store.get<Ticket>('tickets', id);
    if (!ticket || ticket.guildId !== member.guild.id || ticket.state === 'closed') throw new UserError(this.config.t('ticket.notFound'));
    const support = this.config.guild(member.guild.id).tickets.supportRoleIds.some(roleId => member.roles.cache.has(roleId));
    if (ticket.ownerId !== member.id && !support && !isManager(member, this.config)) throw new UserError(this.config.t('common.forbidden'));
    return ticket;
  }
  async close(id: string, member: GuildMember): Promise<void> {
    const ticket = this.authorize(id, member);
    if (this.busy.has(id)) throw new UserError('티켓 종료 처리 중이에요.');
    this.busy.add(id);
    try {
      const channel = await member.guild.channels.fetch(ticket.channelId);
      ticket.state = 'closing'; this.store.set('tickets', id, ticket);
      if (channel?.type === ChannelType.GuildText) {
        if (this.config.guild(ticket.guildId).tickets.closeDeletesChannel) await channel.delete(`티켓 종료: ${member.id}`);
        else {
          await channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false });
          await channel.setName(`closed-${channel.name}`.slice(0, 100));
        }
      }
      ticket.state = 'closed'; this.store.set('tickets', id, ticket);
      await this.audit.write(ticket.guildId, this.config.t('log.ticketClosed', { channelId: ticket.channelId, ownerId: ticket.ownerId, actorId: member.id }));
    } catch (error) { ticket.state = 'open'; this.store.set('tickets', id, ticket); throw error; }
    finally { this.busy.delete(id); }
  }
}
