import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { PermissionFlagsBits, type Client, type GuildMember } from 'discord.js';
import type { Config } from '../core/config.js';
import type { Store } from '../core/store.js';
import type { Audit } from '../core/audit.js';
import { UserError, errorText } from '../core/errors.js';
import { isManager, sendableChannel } from '../core/permissions.js';
import { card } from '../core/ui.js';

export type ScheduleState = 'draft' | 'pending' | 'sending' | 'sent' | 'cancelled' | 'failed' | 'uncertain';
export interface Schedule { id: string; guildId: string; channelId: string; creatorId: string; content: string; runAt: number; createdAt: number; state: ScheduleState; attempts: number; nextAttempt: number; error?: string; messageId?: string }
export function parseScheduleTime(input: string, timezone: string, now = Date.now()): number {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input)) throw new Error('날짜 형식 오류');
  const date = DateTime.fromFormat(input, 'yyyy-MM-dd HH:mm', { zone: timezone });
  if (!date.isValid || date.toFormat('yyyy-MM-dd HH:mm') !== input || date.getPossibleOffsets().length !== 1 || date.toMillis() <= now) throw new Error('미래의 유효하고 유일한 시각이 필요합니다.');
  return date.toMillis();
}
export class DeliveryError extends Error {
  constructor(message: string, readonly kind: 'retry' | 'permanent' | 'uncertain') { super(message); }
}
export class Schedules {
  private running = false;
  private lastPoll = new Map<string, number>();
  constructor(private config: Config, private store: Store, private deliver: (job: Schedule) => Promise<string>, private audit: Pick<Audit, 'write'>) {}
  recover(): void {
    for (const job of this.store.list<Schedule>('schedules')) {
      if (job.state === 'sending') {
        job.state = 'uncertain'; job.error = '전송 도중 프로세스가 종료되었습니다. 채널 확인 후 필요하면 새로 예약하세요.';
        this.store.set('schedules', job.id, job);
        void this.audit.write(job.guildId, this.config.t('log.scheduleFailed', { id: job.id, error: job.error }));
      }
    }
  }
  draft(guildId: string, channelId: string, creatorId: string, content: string, runAt: number): Schedule {
    this.checkEnabled(guildId);
    if (!content.trim() || content.length > 3000 || runAt <= Date.now()) throw new UserError('메시지 내용과 예약 시각을 확인해 주세요.');
    const drafts = this.store.list<Schedule>('schedules').filter(j => j.state === 'draft' && j.guildId === guildId && j.creatorId === creatorId);
    for (const old of drafts) this.store.delete('schedules', old.id);
    const job: Schedule = { id: randomBytes(12).toString('hex'), guildId, channelId, creatorId, content: content.trim(), runAt, createdAt: Date.now(), state: 'draft', attempts: 0, nextAttempt: runAt };
    this.store.set('schedules', job.id, job); return job;
  }
  confirm(id: string, guildId: string, creatorId: string): Schedule {
    this.checkEnabled(guildId);
    const job = this.store.get<Schedule>('schedules', id);
    if (!job || job.guildId !== guildId || job.creatorId !== creatorId || job.state !== 'draft' || Date.now() - job.createdAt > 900000 || job.runAt <= Date.now()) throw new UserError(this.config.t('schedule.expired'));
    const count = this.list(guildId).filter(j => j.state === 'pending' || j.state === 'sending').length;
    if (count >= this.config.guild(guildId).schedules.maxPendingPerGuild) throw new UserError(this.config.t('schedule.limit'));
    job.state = 'pending'; this.store.set('schedules', id, job); return job;
  }
  cancel(id: string, guildId: string): void {
    const job = this.store.get<Schedule>('schedules', id);
    if (!job || job.guildId !== guildId || !['pending', 'draft'].includes(job.state)) throw new UserError(this.config.t('schedule.notFound'));
    job.state = 'cancelled'; this.store.set('schedules', id, job);
  }
  list(guildId: string): Schedule[] { return this.store.list<Schedule>('schedules').filter(j => j.guildId === guildId && j.state !== 'draft').sort((a, b) => b.createdAt - a.createdAt); }
  get(id: string): Schedule | undefined { return this.store.get<Schedule>('schedules', id); }
  private checkEnabled(guildId: string): void { if (!this.config.guild(guildId).schedules.enabled) throw new UserError(this.config.t('common.disabled')); }
  async tick(now = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const dueGuilds = new Set<string>();
      for (const job of this.store.list<Schedule>('schedules')) {
        if (job.state === 'draft' && now - job.createdAt > 900000) { this.store.delete('schedules', job.id); continue; }
        if (job.state !== 'pending' || job.nextAttempt > now) continue;
        const cfg = this.config.guild(job.guildId).schedules;
        if (cfg.enabled && now - (this.lastPoll.get(job.guildId) ?? 0) >= cfg.pollIntervalSeconds * 1000) dueGuilds.add(job.guildId);
      }
      for (const guildId of dueGuilds) this.lastPoll.set(guildId, now);
      const ordered = this.store.list<Schedule>('schedules').sort((a, b) => a.runAt - b.runAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      for (const saved of ordered) {
        // 앞선 await 동안 취소된 예약은 다시 읽어서 확인합니다.
        const job = this.get(saved.id);
        if (!job || !dueGuilds.has(job.guildId) || job.state !== 'pending' || job.nextAttempt > now) continue;
        job.state = 'sending'; job.attempts++; this.store.set('schedules', job.id, job);
        try {
          job.messageId = await this.deliver(job); job.state = 'sent'; delete job.error;
          this.store.set('schedules', job.id, job);
          await this.audit.write(job.guildId, this.config.t('log.scheduleSent', { id: job.id, channel: `<#${job.channelId}>` }));
        } catch (error) {
          job.error = errorText(error);
          const cfg = this.config.guild(job.guildId).schedules;
          if (error instanceof DeliveryError && error.kind === 'retry' && job.attempts < cfg.maxAttempts) { job.state = 'pending'; job.nextAttempt = now + cfg.retryDelaySeconds * 1000 * job.attempts; }
          else job.state = error instanceof DeliveryError && error.kind !== 'uncertain' ? 'failed' : 'uncertain';
          this.store.set('schedules', job.id, job);
          await this.audit.write(job.guildId, this.config.t('log.scheduleFailed', { id: job.id, error: `${job.state}: ${job.error}` }));
        }
      }
    } finally { this.running = false; }
  }
}

export async function validateScheduleChannel(member: GuildMember, channelId: string, config: Config) {
  const cfg = config.guild(member.guild.id).schedules;
  if (!cfg.enabled) throw new UserError(config.t('common.disabled'));
  if (!isManager(member, config)) throw new UserError(config.t('common.forbidden'));
  if (cfg.allowedChannelIds.length && !cfg.allowedChannelIds.includes(channelId)) throw new UserError('이 채널은 예약 허용 목록에 없어요.');
  const channel = await sendableChannel(member.guild, channelId, config);
  const sendPermission = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, sendPermission])) throw new UserError(config.t('common.forbidden'));
  return channel;
}
export function discordDelivery(client: Client, config: Config): (job: Schedule) => Promise<string> {
  return async job => {
    let channel;
    try {
      const guild = await client.guilds.fetch(job.guildId);
      const member = await guild.members.fetch({ user: job.creatorId, force: true });
      channel = await validateScheduleChannel(member, job.channelId, config);
    } catch (error) {
      const code = (error as { code?: number }).code;
      throw new DeliveryError(errorText(error), error instanceof UserError || [10003, 10007, 50001, 50013].includes(code ?? 0) ? 'permanent' : 'retry');
    }
    try {
      const message = await channel.send({ ...card(config, config.appearance.name, job.content), nonce: job.id, enforceNonce: true });
      return message.id;
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new DeliveryError(errorText(error), status === 429 ? 'retry' : status && status >= 400 && status < 500 ? 'permanent' : 'uncertain');
    }
  };
}
