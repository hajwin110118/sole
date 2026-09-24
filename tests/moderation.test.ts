import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits, ChannelType } from 'discord.js';
import { Config } from '../src/core/config.js';
import { Store } from '../src/core/store.js';
import { Moderation, exemptFromModeration, type CleanupJob } from '../src/features/moderation.js';

const audit = { write: async () => {} } as any;
function job(config: Config, targets?: CleanupJob['targets']): CleanupJob {
  return { id: 'guild:target', guildId: 'guild', userId: 'target', triggerChannelId: 'trap', state: 'cleanup', createdAt: 0, settings: config.guild('guild').moderation, deleted: 0, failures: 0, issues: [], nextRun: 0, targets };
}
test('서버 소유자, 예외 사용자·역할·관리자는 설정대로 제외한다', () => {
  const cfg = new Config().guild('guild').moderation;
  const member = (id: string, roles: string[] = [], admin = false): any => ({ id, guild: { ownerId: 'owner' }, roles: { cache: new Map(roles.map(r => [r, true])) }, permissions: { has: () => admin } });
  assert.ok(exemptFromModeration(member('owner'), cfg));
  assert.ok(exemptFromModeration(member('admin', [], true), cfg));
  assert.ok(exemptFromModeration(member('user'), { ...cfg, exemptUserIds: ['user'] }));
  assert.ok(exemptFromModeration(member('user', ['safe']), { ...cfg, exemptRoleIds: ['safe'] }));
  assert.equal(exemptFromModeration(member('admin', [], true), { ...cfg, exemptAdministrators: false }), false);
  assert.equal(exemptFromModeration(member('ordinary'), cfg), false);
});
test('오래된 메시지를 페이지 순회해 삭제하고 재시작 후 커서에서 계속한다', async () => {
  const config = new Config(), store = new Store(':memory:');
  try {
    let deleted = 0;
    const first = new Collection<string, any>();
    for (let index = 0; index < 100; index++) {
      const id = (1000000000000000000n - BigInt(index)).toString();
      first.set(id, { id, author: { id: index % 2 === 0 ? 'target' : 'other' }, createdTimestamp: 0, delete: async () => { deleted++; } });
    }
    const before = '999999999999999901';
    const final = new Collection<string, any>([['999999999999999900', { author: { id: 'target' }, delete: async () => { deleted++; } }]]);
    const channel: any = { id: 'channel', isTextBased: () => true, permissionsFor: () => ({ has: () => true }), messages: { fetch: async (options: any) => {
      assert.equal(options.cache, false); return options.before === before ? final : first;
    } } };
    const guild = { channels: { fetch: async () => channel }, members: { fetchMe: async () => ({}) } };
    const client: any = { guilds: { fetch: async () => guild } };
    const task = job(config, [{ id: 'channel', done: false, attempts: 0 }]); store.set('cleanup', task.id, task);
    await new Moderation(client, config, store, audit).tick(1000);
    assert.equal(deleted, 50); assert.equal(store.get<CleanupJob>('cleanup', task.id)?.targets?.[0]?.before, before);
    const restarted = new Moderation(client, config, store, audit);
    await restarted.tick(2000); await restarted.tick(3000);
    assert.equal(deleted, 51); assert.equal(store.get<CleanupJob>('cleanup', task.id)?.state, 'done');
    assert.equal(store.get<CleanupJob>('cleanup', task.id)?.failures, 0);
  } finally { store.close(); }
});
test('접근 불가 채널을 기록하고 다른 채널의 삭제는 계속한다', async () => {
  const config = new Config(), store = new Store(':memory:');
  try {
    const guild = { members: { fetchMe: async () => ({}) }, channels: { fetch: async () => ({ isTextBased: () => true, permissionsFor: () => ({ has: () => false }) }) } };
    const moderation = new Moderation({ guilds: { fetch: async () => guild } } as any, config, store, audit);
    const task = job(config, [{ id: 'hidden', done: false, attempts: 0 }]); store.set('cleanup', task.id, task);
    for (const now of [1000, 2000, 3000, 4000]) await moderation.tick(now);
    const saved = store.get<CleanupJob>('cleanup', task.id)!;
    assert.equal(saved.state, 'done'); assert.equal(saved.failures, 1); assert.match(saved.issues[0]!, /hidden/);
  } finally { store.close(); }
});
test('비공개 보관 스레드는 관리 권한으로 전체 조회하며 타임스탬프로 페이지를 넘긴다', async () => {
  const config = new Config(), store = new Store(':memory:');
  try {
    let privatePages = 0;
    const parent: any = { id: 'parent', type: ChannelType.GuildText, isTextBased: () => true, permissionsFor: () => ({ has: () => true }), messages: { fetch: async () => new Collection() }, threads: { fetchArchived: async (options: any) => {
      if (options.type === 'public') return { threads: new Collection(), hasMore: false };
      assert.equal(options.fetchAll, true); privatePages++;
      if (privatePages === 1) return { threads: new Collection([['thread-1', { id: 'thread-1', archiveTimestamp: 1000 }]]), hasMore: true };
      assert.equal(options.before.getTime(), 1000); return { threads: new Collection([['thread-2', { id: 'thread-2', archiveTimestamp: 500 }]]), hasMore: false };
    } } };
    const guild = { members: { fetchMe: async () => ({}) }, channels: { fetch: async (id?: string) => id ? parent : new Collection([['parent', parent]]), fetchActiveThreads: async () => ({ threads: new Collection() }) } };
    const moderation = new Moderation({ guilds: { fetch: async () => guild } } as any, config, store, audit);
    const task = job(config); store.set('cleanup', task.id, task); await moderation.tick(1000);
    assert.equal(privatePages, 2);
    assert.deepEqual(store.get<CleanupJob>('cleanup', task.id)?.targets?.map(t => t.id), ['parent', 'thread-1', 'thread-2']);
  } finally { store.close(); }
});
test('금지 채널 중복 메시지로 차단 요청이 중복되지 않는다', async () => {
  const config = new Config(), store = new Store(':memory:');
  try {
    Object.assign(config.guild('guild').moderation, { enabled: true, triggerChannelIds: ['trap'] });
    let bans = 0, release!: () => void;
    const guild: any = { id: 'guild', ownerId: 'owner', members: {} };
    const member = { id: 'target', guild, roles: { cache: new Map() }, permissions: { has: () => false } };
    guild.members.fetch = async () => member; guild.members.fetchMe = async () => ({ permissions: { has: (permission: bigint) => permission === PermissionFlagsBits.BanMembers } });
    guild.members.ban = async (_id: string, options: any) => { bans++; assert.equal(options.deleteMessageSeconds, 604800); await new Promise<void>(resolve => { release = resolve; }); };
    const moderation = new Moderation({} as any, config, store, audit);
    const message: any = { guild, author: { id: 'target', bot: false }, channelId: 'trap', channel: { isThread: () => false } };
    const first = moderation.handle(message);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await moderation.handle(message), true); assert.equal(bans, 1); release(); await first;
  } finally { store.close(); }
});
