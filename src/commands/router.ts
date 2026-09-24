import { ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle, type Client, type Interaction, type RepliableInteraction, type ModalSubmitInteraction, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import type { Config } from '../core/config.js';
import { card, button, respond } from '../core/ui.js';
import { UserError, logError } from '../core/errors.js';
import { memberFor, requireManager, sendableChannel } from '../core/permissions.js';
import { welcomeCard } from '../features/welcome.js';
import type { Tickets } from '../features/tickets.js';
import type { Tts } from '../features/tts.js';
import { parseScheduleTime, validateScheduleChannel, type Schedules } from '../features/schedules.js';
import type { Moderation } from '../features/moderation.js';

export interface Services { client: Client; config: Config; tickets: Tickets; tts: Tts; schedules: Schedules; moderation: Moderation }
const field = (id: string, label: string, style: TextInputStyle, maxLength: number, placeholder?: string) => {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(true).setMaxLength(maxLength);
  if (placeholder) input.setPlaceholder(placeholder);
  return new LabelBuilder().setLabel(label.slice(0, 45)).setTextInputComponent(input);
};
export function ticketModal(config: Config) {
  return new ModalBuilder().setCustomId('ticket:create').setTitle(config.t('ticket.modalTitle'))
    .addLabelComponents(field('subject', config.t('ticket.subjectLabel'), TextInputStyle.Short, 100), field('description', config.t('ticket.descriptionLabel'), TextInputStyle.Paragraph, 1800));
}
export function ttsModal(config: Config, guildId: string) {
  return new ModalBuilder().setCustomId('tts:say').setTitle(config.t('tts.modalTitle'))
    .addLabelComponents(field('text', config.t('tts.textLabel'), TextInputStyle.Paragraph, config.guild(guildId).tts.maxCharacters));
}
export function scheduleModal(config: Config, guildId: string, channelId: string) {
  return new ModalBuilder().setCustomId(`schedule:create:${channelId}`).setTitle(config.t('schedule.modalTitle'))
    .addLabelComponents(field('time', config.t('schedule.timeLabel', { timezone: config.guild(guildId).timezone }), TextInputStyle.Short, 16, config.t('schedule.timePlaceholder')), field('content', config.t('schedule.contentLabel'), TextInputStyle.Paragraph, 3000));
}
const defer = (i: RepliableInteraction) => i.deferReply({ flags: MessageFlags.Ephemeral });

export async function route(interaction: Interaction, services: Services): Promise<void> {
  if (!interaction.isRepliable()) return;
  const { config } = services;
  try {
    if (!interaction.guildId || !interaction.guild) throw new UserError(config.t('common.guildOnly'));
    if (interaction.isChatInputCommand()) await command(interaction, services);
    else if (interaction.isButton()) {
      const [feature, action, id] = interaction.customId.split(':');
      if (feature === 'ticket' && action === 'open') {
        if (!config.guild(interaction.guildId).tickets.enabled) throw new UserError(config.t('common.disabled'));
        await interaction.showModal(ticketModal(config)); return;
      }
      if (feature === 'tts' && action === 'modal') {
        if (!config.guild(interaction.guildId).tts.enabled) throw new UserError(config.t('common.disabled'));
        await interaction.showModal(ttsModal(config, interaction.guildId)); return;
      }
      if (feature === 'ui' && action === 'cancel') {
        await interaction.update(card(config, config.t('common.success'), config.t('common.cancelled'))); return;
      }
      await defer(interaction);
      if (feature === 'ticket' && id) {
        const member = await memberFor(interaction);
        if (action === 'close') await closePrompt(interaction, services, id, member);
        else if (action === 'confirm') { await services.tickets.close(id, member); await success(interaction, config, config.t('ticket.closed')); }
        else throw new UserError(config.t('common.unexpected'));
      } else if (feature === 'tts' && action === 'stop') {
        services.tts.stop(await memberFor(interaction)); await success(interaction, config, config.t('tts.stopped'));
      } else if (feature === 'schedule') {
        const member = await requireManager(interaction, config);
        if (action === 'list') await listSchedules(interaction, services);
        else if (action === 'confirm' && id) {
          const job = services.schedules.get(id);
          if (!job || job.guildId !== interaction.guildId || job.creatorId !== member.id) throw new UserError(config.t('schedule.expired'));
          await validateScheduleChannel(member, job.channelId, config);
          const confirmed = services.schedules.confirm(id, interaction.guildId, member.id);
          await respond(interaction, card(config, config.t('common.success'), config.t('schedule.created', { id, time: `<t:${Math.floor(confirmed.runAt / 1000)}:F>` }), { buttons: [button(`schedule:cancel:${id}`, config.t('button.cancelSchedule'), ButtonStyle.Danger)] }));
        } else if (action === 'cancel' && id) {
          services.schedules.cancel(id, interaction.guildId); await success(interaction, config, config.t('schedule.cancelled', { id }));
        } else throw new UserError(config.t('common.unexpected'));
      } else if (feature === 'ui' && action === 'cancel') await success(interaction, config, config.t('common.cancelled'));
      else throw new UserError(config.t('common.unexpected'));
    } else if (interaction.isModalSubmit()) await modal(interaction, services);
  } catch (error) {
    logError('상호작용 처리', error);
    try { await respond(interaction, card(config, config.t('common.error'), error instanceof UserError ? error.message : config.t('common.unexpected'), { error: true })); }
    catch (replyError) { logError('오류 응답', replyError); }
  }
}
async function success(interaction: RepliableInteraction, config: Config, body: string) { await respond(interaction, card(config, config.t('common.success'), body)); }
async function closePrompt(interaction: RepliableInteraction, services: Services, id: string, member: GuildMember) {
  services.tickets.authorize(id, member);
  await respond(interaction, card(services.config, services.config.t('button.close'), services.config.t('ticket.closePrompt'), { buttons: [button(`ticket:confirm:${id}`, services.config.t('button.confirmClose'), ButtonStyle.Danger), button('ui:cancel', services.config.t('button.cancel'))] }));
}
async function listSchedules(interaction: RepliableInteraction, { config, schedules }: Services) {
  const jobs = schedules.list(interaction.guildId!);
  const names = { pending: '대기', sending: '전송 중', sent: '완료', cancelled: '취소', failed: '실패', uncertain: '전송 여부 확인 필요', draft: '초안' };
  const body = jobs.slice(0, 10).map(job => `**${names[job.state]}** · <#${job.channelId}> · <t:${Math.floor(job.runAt / 1000)}:f>\n\`${job.id}\`${job.error ? `\n${job.error.slice(0, 120)}` : ''}`).join('\n\n') || config.t('schedule.empty');
  await respond(interaction, card(config, config.t('schedule.listTitle'), `${body}${jobs.length > 10 ? `\n\n${config.t('schedule.more', { count: jobs.length })}` : ''}`, { buttons: jobs.filter(j => j.state === 'pending').slice(0, 5).map((job, index) => button(`schedule:cancel:${job.id}`, `${index + 1}. ${config.t('button.cancelSchedule')} · ${job.id.slice(-4)}`, ButtonStyle.Danger)) }));
}
async function command(i: ChatInputCommandInteraction, s: Services): Promise<void> {
  const { config } = s, guildId = i.guildId!;
  if (i.commandName === 'ticket' && i.options.getSubcommand() === 'open') {
    if (!config.guild(guildId).tickets.enabled) throw new UserError(config.t('common.disabled'));
    await i.showModal(ticketModal(config)); return;
  }
  if (i.commandName === 'tts' && i.options.getSubcommand() === 'say' && !i.options.getString('text')) {
    if (!config.guild(guildId).tts.enabled) throw new UserError(config.t('common.disabled'));
    await i.showModal(ttsModal(config, guildId)); return;
  }
  if (i.commandName === 'schedule' && i.options.getSubcommand() === 'create') {
    if (!config.guild(guildId).schedules.enabled) throw new UserError(config.t('common.disabled'));
    // 모달은 3초 이내 응답해야 하므로 실제 권한과 채널 검사는 제출/확정/전송 단계에서 수행합니다.
    await i.showModal(scheduleModal(config, guildId, i.options.getChannel('channel', true).id)); return;
  }
  await defer(i);
  if (i.commandName === 'command') {
    await respond(i, card(config, config.t('panel.title', { name: config.appearance.name }), `${config.t('panel.body')}\n\n${config.t('panel.help')}`, { buttons: [button('ticket:open', config.t('button.ticket'), ButtonStyle.Primary), button('tts:modal', config.t('button.tts')), button('tts:stop', config.t('button.ttsStop')), button('schedule:list', config.t('button.schedule'))] }));
  } else if (i.commandName === 'welcome') {
    const member = await requireManager(i, config); await respond(i, welcomeCard(member, config));
  } else if (i.commandName === 'ticket') {
    if (i.options.getSubcommand() === 'panel') {
      const member = await requireManager(i, config);
      const channel = await sendableChannel(i.guild!, i.channelId, config);
      if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.SendMessages)) throw new UserError(config.t('common.forbidden'));
      await channel.send(s.tickets.panel(guildId)); await success(i, config, config.t('ticket.panelSent'));
    } else {
      const member = await memberFor(i), ticket = s.tickets.findByChannel(guildId, i.channelId);
      if (!ticket) throw new UserError(config.t('ticket.notFound'));
      await closePrompt(i, s, ticket.id, member);
    }
  } else if (i.commandName === 'tts') {
    const member = await memberFor(i);
    switch (i.options.getSubcommand()) {
      case 'join': await success(i, config, config.t('tts.joined', { channel: `<#${await s.tts.join(member)}>` })); break;
      case 'say': await success(i, config, config.t('tts.queued', { count: s.tts.enqueue(member, i.options.getString('text', true)) })); break;
      case 'stop': s.tts.stop(member); await success(i, config, config.t('tts.stopped')); break;
      case 'leave': s.tts.leave(member); await success(i, config, config.t('tts.left')); break;
    }
  } else if (i.commandName === 'schedule') {
    await requireManager(i, config);
    if (i.options.getSubcommand() === 'list') await listSchedules(i, s);
    else { const id = i.options.getString('id', true); s.schedules.cancel(id, guildId); await success(i, config, config.t('schedule.cancelled', { id })); }
  } else if (i.commandName === 'settings') {
    await requireManager(i, config);
    if (i.options.getSubcommand() === 'reload') {
      const app = await s.client.application!.fetch();
      const owner = app.owner;
      const owners = (process.env.BOT_OWNER_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
      const appOwner = owner && ('ownerId' in owner ? owner.ownerId : owner.id);
      if (i.user.id !== appOwner && !owners.includes(i.user.id)) throw new UserError('전체 설정 다시 불러오기는 봇 소유자만 사용할 수 있어요.');
      config.reload(); s.tts.destroyAll(); await success(i, config, config.t('settings.reloaded'));
    } else {
      const cfg = config.guild(guildId);
      const on = (value: boolean) => value ? '켜짐' : '꺼짐';
      await respond(i, card(config, config.t('settings.title'), `**시간대** ${cfg.timezone}\n**환영 인사** ${on(cfg.welcome.enabled)} · ${cfg.welcome.channelId ? `<#${cfg.welcome.channelId}>` : '미설정'}\n**티켓** ${on(cfg.tickets.enabled)} · ${cfg.tickets.categoryId ? `<#${cfg.tickets.categoryId}>` : '미설정'}\n**TTS** ${on(cfg.tts.enabled)} · ${cfg.tts.voiceName}\n**자동 차단** ${on(cfg.moderation.enabled)} · ${cfg.moderation.triggerChannelIds.map(id => `<#${id}>`).join(', ') || '미설정'}\n**메시지 예약** ${on(cfg.schedules.enabled)}\n\n설정은 config/bot.json, 화면 문구는 config/messages.json에서 수정합니다.`));
    }
  } else if (i.commandName === 'moderation') {
    await requireManager(i, config);
    const jobs = s.moderation.list(guildId).slice(0, 5);
    const names = { ban_pending: '차단 대기', cleanup: '메시지 정리 중', done: '종료', failed: '실패' };
    await respond(i, card(config, '자동 차단 · 정리 상태', jobs.map(j => `**${names[j.state]}** · 사용자 \`${j.userId}\`\n직접 삭제 ${j.deleted}건 · 실패/누락 ${j.failures}건 · 채널 ${j.targets?.filter(t => t.done).length ?? 0}/${j.targets?.length ?? 0}\n${j.issues.slice(-2).join('\n').slice(0, 350)}`).join('\n\n') || '처리 내역이 없어요.'));
  }
}
async function modal(i: ModalSubmitInteraction, s: Services): Promise<void> {
  await defer(i);
  const { config } = s;
  if (i.customId === 'ticket:create') {
    const channelId = await s.tickets.open(await memberFor(i), i.fields.getTextInputValue('subject').trim(), i.fields.getTextInputValue('description').trim());
    await success(i, config, config.t('ticket.created', { channel: `<#${channelId}>` }));
  } else if (i.customId === 'tts:say') {
    const count = s.tts.enqueue(await memberFor(i), i.fields.getTextInputValue('text')); await success(i, config, config.t('tts.queued', { count }));
  } else if (i.customId.startsWith('schedule:create:')) {
    const channelId = i.customId.split(':')[2]!;
    const member = await requireManager(i, config); await validateScheduleChannel(member, channelId, config);
    const timezone = config.guild(i.guildId!).timezone;
    let runAt: number;
    try { runAt = parseScheduleTime(i.fields.getTextInputValue('time').trim(), timezone); }
    catch { throw new UserError(config.t('schedule.invalidTime', { timezone })); }
    const job = s.schedules.draft(i.guildId!, channelId, i.user.id, i.fields.getTextInputValue('content'), runAt);
    await respond(i, card(config, config.t('schedule.previewTitle'), config.t('schedule.preview', { channel: `<#${channelId}>`, time: `<t:${Math.floor(runAt / 1000)}:F>`, content: job.content }), { buttons: [button(`schedule:confirm:${job.id}`, config.t('button.confirmSchedule'), ButtonStyle.Success), button(`schedule:cancel:${job.id}`, config.t('button.cancel'))] }));
  } else throw new UserError(config.t('common.unexpected'));
}
