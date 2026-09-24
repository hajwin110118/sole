import { PermissionFlagsBits, ChannelType, type Client, type GuildMember, type Message, type Guild, type GuildTextBasedChannel } from 'discord.js';
import type { Config, GuildConfig } from '../core/config.js';
import type { Store } from '../core/store.js';
import type { Audit } from '../core/audit.js';
import { errorText } from '../core/errors.js';

type ModerationConfig = GuildConfig['moderation'];
interface Target { id: string; before?: string; done: boolean; attempts: number }
export interface CleanupJob {
  id: string; guildId: string; userId: string; triggerChannelId: string;
  state: 'ban_pending' | 'cleanup' | 'done' | 'failed'; createdAt: number;
  settings: ModerationConfig; targets?: Target[]; deleted: number; failures: number;
  issues: string[]; nextRun: number;
}
export function exemptFromModeration(member: GuildMember, cfg: ModerationConfig): boolean {
  return member.id === member.guild.ownerId || cfg.exemptUserIds.includes(member.id)
    || cfg.exemptRoleIds.some(id => member.roles.cache.has(id))
    || (cfg.exemptAdministrators && member.permissions.has(PermissionFlagsBits.Administrator));
}
export class Moderation {
  private running = false;
  private banning = new Set<string>();
  constructor(private client: Client, private config: Config, private store: Store, private audit: Audit) {}
  list(guildId: string): CleanupJob[] { return this.store.list<CleanupJob>('cleanup').filter(j => j.guildId === guildId).sort((a, b) => b.createdAt - a.createdAt); }
  private save(job: CleanupJob): void { this.store.set('cleanup', job.id, job); }
  private issue(job: CleanupJob, description: string): void { job.failures++; if (job.issues.length < 200) job.issues.push(description); }
  async handle(message: Message): Promise<boolean> {
    if (!message.guild || message.author.bot || message.webhookId) return false;
    const cfg = this.config.guild(message.guild.id).moderation;
    const parentId = message.channel.isThread() ? message.channel.parentId : null;
    if (!cfg.enabled || !(cfg.triggerChannelIds.includes(message.channelId) || (cfg.includeChildThreads && parentId && cfg.triggerChannelIds.includes(parentId)))) return false;
    const member = await message.guild.members.fetch({ user: message.author.id, force: true });
    if (exemptFromModeration(member, cfg)) return false;
    const id = `${message.guild.id}:${member.id}`;
    const existing = this.store.get<CleanupJob>('cleanup', id);
    if (existing && ['ban_pending', 'cleanup'].includes(existing.state)) return true;
    const job: CleanupJob = { id, guildId: message.guild.id, userId: member.id, triggerChannelId: message.channelId, state: 'ban_pending', settings: structuredClone(cfg), createdAt: Date.now(), deleted: 0, failures: 0, issues: [], nextRun: 0 };
    this.save(job);
    await this.ban(job, message.guild);
    return true;
  }
  private async ban(job: CleanupJob, guild: Guild): Promise<void> {
    if (this.banning.has(job.id)) return;
    this.banning.add(job.id);
    try {
      const me = await guild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.BanMembers)) throw new Error('봇에 멤버 차단 권한이 없습니다.');
      // 차단은 서버 퇴장도 포함하므로 kick 후 ban을 따로 호출하지 않습니다.
      await guild.members.ban(job.userId, { deleteMessageSeconds: job.settings.deleteMessageSeconds, reason: job.settings.reason });
      job.state = job.settings.scanHistory ? 'cleanup' : 'done'; this.save(job);
      await this.audit.write(job.guildId, this.config.t('log.moderation', { userId: job.userId, channelId: job.triggerChannelId, jobId: job.id }));
    } catch (error) {
      job.state = 'failed'; this.issue(job, `차단 실패: ${errorText(error)}`); this.save(job);
      await this.audit.write(job.guildId, `자동 차단 실패 · ${job.userId}: ${errorText(error)}. 봇 역할 순서와 권한을 확인하세요.`);
    } finally { this.banning.delete(job.id); }
  }
  private async discover(guild: Guild, job: CleanupJob): Promise<Target[]> {
    const channels = await guild.channels.fetch();
    const me = await guild.members.fetchMe();
    const found = new Set<string>();
    for (const channel of channels.values()) if (channel?.isTextBased()) found.add(channel.id);
    try { for (const thread of (await guild.channels.fetchActiveThreads(false)).threads.values()) found.add(thread.id); }
    catch (error) { this.issue(job, `활성 스레드 조회: ${errorText(error)}`); }
    if (job.settings.includeArchivedThreads) {
      for (const channel of channels.values()) {
        if (!channel || !('threads' in channel)) continue;
        const types: ('public' | 'private')[] = channel.type === ChannelType.GuildText ? ['public', 'private'] : ['public'];
        for (const type of types) {
          const fetchAll = type === 'private' && Boolean(channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageThreads));
          if (type === 'private' && !fetchAll) this.issue(job, `비공개 스레드 전체 조회 불가 ${channel.id}: 스레드 관리 권한이 없어 참여한 스레드만 검사합니다.`);
          let before: Date | string | undefined;
          try {
            while (true) {
              const page = await channel.threads.fetchArchived({ type, fetchAll, limit: 100, before }, false);
              for (const thread of page.threads.values()) found.add(thread.id);
              if (!page.hasMore || !page.threads.size) break;
              if (type === 'private' && !fetchAll) {
                const oldestId = [...page.threads.keys()].reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
                if (before === oldestId) { this.issue(job, `비공개 스레드 페이지 순회 중단: ${channel.id}`); break; }
                before = oldestId; continue;
              }
              const timestamps = [...page.threads.values()].map(t => t.archiveTimestamp).filter((t): t is number => t !== null);
              const oldest = Math.min(...timestamps);
              if (!Number.isFinite(oldest) || (before instanceof Date && oldest >= before.getTime())) { this.issue(job, `스레드 페이지 순회 중단: ${channel.id}/${type}`); break; }
              before = new Date(oldest);
            }
          } catch (error) { this.issue(job, `보관 스레드 조회 ${channel.id}/${type}: ${errorText(error)}`); }
        }
      }
    }
    return [...found].map(id => ({ id, done: false, attempts: 0 }));
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of this.store.list<CleanupJob>('cleanup')) {
        if (!['ban_pending', 'cleanup'].includes(job.state) || job.nextRun > now) continue;
        try {
          const guild = await this.client.guilds.fetch(job.guildId);
          if (job.state === 'ban_pending') { await this.ban(job, guild); continue; }
          if (!job.targets) { job.targets = await this.discover(guild, job); this.save(job); }
          const target = job.targets.find(t => !t.done);
          if (!target) {
            job.state = 'done'; this.save(job);
            await this.audit.write(job.guildId, this.config.t('log.cleanup', { userId: job.userId, deleted: job.deleted, failures: job.failures }));
            continue;
          }
          try {
            const channel = await guild.channels.fetch(target.id);
            const me = await guild.members.fetchMe();
            if (!channel?.isTextBased() || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages])) throw new Error('채널 보기·메시지 기록 보기·메시지 관리 권한 없음');
            await this.cleanPage(channel, job, target);
            target.attempts = 0;
          } catch (error) {
            target.attempts++;
            if (target.attempts >= 3) { target.done = true; this.issue(job, `채널 ${target.id}: ${errorText(error)}`); }
          }
          job.nextRun = now + job.settings.pageDelayMs; this.save(job);
        } catch (error) {
          this.issue(job, errorText(error)); job.nextRun = now + 60000;
          // 서버에서 제거된 경우를 포함해 끝없는 재시도 방지
          if (job.failures >= 10) job.state = 'failed';
          this.save(job);
          await this.audit.write(job.guildId, `메시지 정리 작업 ${job.id}: ${errorText(error)}`);
        }
      }
    } finally { this.running = false; }
  }
  private async cleanPage(channel: GuildTextBasedChannel, job: CleanupJob, target: Target): Promise<void> {
    const page = await channel.messages.fetch({ limit: 100, before: target.before, cache: false });
    if (!page.size) { target.done = true; return; }
    for (const message of page.values()) {
      if (message.author.id !== job.userId) continue;
      try { await message.delete(); job.deleted++; }
      catch (error) { if ((error as { code?: number }).code !== 10008) this.issue(job, `메시지 ${channel.id}/${message.id}: ${errorText(error)}`); }
    }
    // Snowflake는 JS number 범위를 넘으므로 BigInt로 비교합니다.
    target.before = [...page.keys()].reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
    if (page.size < 100) target.done = true;
  }
}
