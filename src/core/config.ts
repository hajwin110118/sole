import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { messageKeys } from './message-keys.js';

const id = z.string().regex(/^\d{17,20}$/);
const optionalId = z.union([id, z.literal('')]);
const ids = z.array(id);
const text = (max: number) => z.string().min(1).max(max);
const guildSchema = z.object({
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, '유효한 IANA 시간대가 필요합니다.'),
  managerRoleIds: ids,
  logChannelId: optionalId,
  welcome: z.object({ enabled: z.boolean(), channelId: optionalId, title: text(200), body: text(2500), imageUrl: z.union([z.url().refine(value => value.startsWith('https://')), z.literal('')]), autoRoleIds: ids }).strict(),
  tickets: z.object({ enabled: z.boolean(), categoryId: optionalId, supportRoleIds: ids, channelName: text(100), panelTitle: text(200), panelBody: text(2500), openLabel: text(80), intro: text(1000), maxOpenPerUser: z.number().int().min(1).max(10), closeDeletesChannel: z.boolean() }).strict(),
  tts: z.object({ enabled: z.boolean(), textChannelIds: ids, allowedRoleIds: ids, languageCode: text(30), voiceName: text(100), speakingRate: z.number().min(0.25).max(4), maxCharacters: z.number().int().min(1).max(1000), maxQueueSize: z.number().int().min(1).max(100), cooldownSeconds: z.number().min(0).max(60), idleDisconnectSeconds: z.number().int().min(30).max(3600), readAuthorName: z.boolean() }).strict(),
  moderation: z.object({ enabled: z.boolean(), triggerChannelIds: ids, includeChildThreads: z.boolean(), exemptRoleIds: ids, exemptUserIds: ids, exemptAdministrators: z.boolean(), reason: text(400), deleteMessageSeconds: z.number().int().min(0).max(604800), scanHistory: z.boolean(), includeArchivedThreads: z.boolean(), pageDelayMs: z.number().int().min(0).max(10000) }).strict(),
  schedules: z.object({ enabled: z.boolean(), allowedChannelIds: ids, maxPendingPerGuild: z.number().int().min(1).max(10000), pollIntervalSeconds: z.number().int().min(1).max(300), maxAttempts: z.number().int().min(1).max(10), retryDelaySeconds: z.number().int().min(5).max(3600) }).strict(),
}).strict();

const rootSchema = z.object({
  appearance: z.object({ name: text(60), accentColor: z.string().regex(/^#[\da-fA-F]{6}$/), errorColor: z.string().regex(/^#[\da-fA-F]{6}$/) }).strict(),
  defaults: guildSchema,
  guilds: z.record(id, z.record(z.string(), z.unknown())),
}).strict();
export type GuildConfig = z.infer<typeof guildSchema>;

export function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('허용되지 않는 설정 키');
    const previous = result[key];
    result[key] = value && typeof value === 'object' && !Array.isArray(value) && previous && typeof previous === 'object' && !Array.isArray(previous)
      ? deepMerge(previous as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return result;
}

export class Config {
  private state!: z.infer<typeof rootSchema>;
  private guildSettings = new Map<string, GuildConfig>();
  private messages: Record<string, string> = {};
  constructor(private configPath = process.env.BOT_CONFIG_PATH || 'config/bot.json', private messagesPath = process.env.BOT_MESSAGES_PATH || 'config/messages.json') { this.reload(); }
  reload(): void {
    const state = rootSchema.parse(JSON.parse(readFileSync(resolve(this.configPath), 'utf8')));
    const messages = z.record(z.string(), text(3500)).parse(JSON.parse(readFileSync(resolve(this.messagesPath), 'utf8')));
    for (const key of messageKeys) {
      if (!messages[key]) throw new Error(`문구 키가 누락되었습니다: ${key}`);
      const limit = key.includes('modalTitle') ? 45 : key.startsWith('button.') ? 80 : key.endsWith('Label') ? 45 : undefined;
      if (limit && messages[key].length > limit) throw new Error(`${key}는 ${limit}자 이하여야 합니다.`);
    }
    for (const key of Object.keys(this.messages)) if (!(key in messages)) throw new Error(`문구 키가 누락되었습니다: ${key}`);
    const guildSettings = new Map<string, GuildConfig>();
    for (const [guildId, override] of Object.entries(state.guilds)) guildSettings.set(guildId, guildSchema.parse(deepMerge(state.defaults, override)));
    for (const settings of [state.defaults, ...guildSettings.values()]) {
      if (settings.welcome.enabled && !settings.welcome.channelId) throw new Error('welcome.channelId가 필요합니다.');
      if (settings.tickets.enabled && !settings.tickets.categoryId) throw new Error('tickets.categoryId가 필요합니다.');
      if (settings.moderation.enabled && !settings.moderation.triggerChannelIds.length) throw new Error('moderation.triggerChannelIds가 필요합니다.');
    }
    this.state = state; this.messages = messages; this.guildSettings = guildSettings;
  }
  get appearance() { return this.state.appearance; }
  guild(guildId: string): GuildConfig { return this.guildSettings.get(guildId) ?? this.state.defaults; }
  t(key: string, variables: Record<string, string | number> = {}): string {
    const template = this.messages[key];
    if (!template) throw new Error(`문구 키가 누락되었습니다: ${key}`);
    return interpolate(template, variables);
  }
}

export function interpolate(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(variables[key] ?? match));
}

export function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`.env에 ${key}를 설정해 주세요.`);
  return value;
}
