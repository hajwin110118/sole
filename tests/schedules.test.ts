import test from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../src/core/config.js';
import { Store } from '../src/core/store.js';
import { Schedules, DeliveryError, parseScheduleTime, type Schedule } from '../src/features/schedules.js';
import { route } from '../src/commands/router.js';

const audit = { write: async () => {} };
function setup(deliver: (job: Schedule) => Promise<string>) {
  const store = new Store(':memory:'), config = new Config();
  return { store, config, schedules: new Schedules(config, store, deliver, audit) };
}
function pending(schedules: Schedules, content = '공지') {
  const job = schedules.draft('guild', 'channel', 'owner', content, Date.now() + 60000);
  schedules.confirm(job.id, 'guild', 'owner'); return job;
}
test('한국 시각을 UTC로 변환하고 잘못된 날짜·과거·DST를 거부한다', () => {
  assert.equal(parseScheduleTime('2030-01-01 09:00', 'Asia/Seoul', 0), Date.parse('2030-01-01T00:00:00Z'));
  for (const input of ['2030-02-30 12:00', '2030-01-01 24:00', '2030-1-1 09:00', '2000-01-01 00:00']) assert.throws(() => parseScheduleTime(input, 'Asia/Seoul'));
  assert.throws(() => parseScheduleTime('2030-03-10 02:30', 'America/New_York', 0));
  assert.throws(() => parseScheduleTime('2030-11-03 01:30', 'America/New_York', 0));
});
test('예약 확정은 작성자·서버·초안 만료와 중복 확정을 검사한다', () => {
  const { store, schedules } = setup(async () => 'message');
  try {
    const job = schedules.draft('guild', 'channel', 'owner', '공지', Date.now() + 60000);
    assert.throws(() => schedules.confirm(job.id, 'other-guild', 'owner'));
    assert.throws(() => schedules.confirm(job.id, 'guild', 'other-user'));
    schedules.confirm(job.id, 'guild', 'owner'); assert.throws(() => schedules.confirm(job.id, 'guild', 'owner'));
    assert.throws(() => schedules.cancel(job.id, 'other-guild'));
    const expired = schedules.draft('guild', 'channel', 'owner', '만료', Date.now() + 60000);
    expired.createdAt -= 900001; store.set('schedules', expired.id, expired);
    assert.throws(() => schedules.confirm(expired.id, 'guild', 'owner'));
  } finally { store.close(); }
});
test('오프라인 중 지난 예약도 복구 후 한 번만 전송한다', async () => {
  let sent = 0;
  const { store, schedules, config } = setup(async () => { sent++; return 'message-id'; });
  try {
    const job = pending(schedules);
    const restarted = new Schedules(config, store, async () => { sent++; return 'message-id'; }, audit);
    restarted.recover(); await restarted.tick(job.runAt + 3600000); await restarted.tick(job.runAt + 7200000);
    assert.equal(sent, 1); assert.equal(restarted.get(job.id)?.state, 'sent'); assert.equal(restarted.get(job.id)?.messageId, 'message-id');
  } finally { store.close(); }
});
test('동시 tick은 중복 전송하지 않고 전송 중인 예약은 취소할 수 없다', async () => {
  let release!: (id: string) => void, calls = 0;
  const { store, schedules } = setup(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  try {
    const job = pending(schedules), tick = schedules.tick(job.runAt + 1);
    await schedules.tick(job.runAt + 2);
    assert.equal(calls, 1); assert.throws(() => schedules.cancel(job.id, 'guild'));
    release('msg'); await tick; assert.equal(schedules.get(job.id)?.state, 'sent');
  } finally { store.close(); }
});
test('앞선 전송을 기다리는 동안 취소된 다음 예약은 보내지 않는다', async () => {
  let release!: (id: string) => void, calls = 0;
  const { store, schedules } = setup(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  try {
    const first = pending(schedules), second = pending(schedules, '두 번째');
    const secondSaved = schedules.get(second.id)!;
    secondSaved.runAt = first.runAt + 1000; secondSaved.nextAttempt = secondSaved.runAt; store.set('schedules', secondSaved.id, secondSaved);
    const tick = schedules.tick(secondSaved.runAt + 1);
    schedules.cancel(second.id, 'guild'); release('msg'); await tick;
    assert.equal(calls, 1); assert.equal(schedules.get(second.id)?.state, 'cancelled');
  } finally { store.close(); }
});
test('확실한 일시 오류만 재시도하고 제한 횟수 뒤 실패 처리한다', async () => {
  let calls = 0;
  const { store, schedules } = setup(async () => { calls++; throw new DeliveryError('전송 전 일시 오류', 'retry'); });
  try {
    const job = pending(schedules);
    for (const delta of [1, 61000, 182000, 500000]) await schedules.tick(job.runAt + delta);
    assert.equal(calls, 3); assert.equal(schedules.get(job.id)?.state, 'failed');
  } finally { store.close(); }
});
test('전송 결과 불명확 및 재시작 중 전송 레코드는 자동 재전송하지 않는다', async () => {
  let calls = 0;
  const { store, schedules } = setup(async () => { calls++; throw new Error('connection reset'); });
  try {
    const job = pending(schedules); await schedules.tick(job.runAt + 1); await schedules.tick(job.runAt + 100000);
    assert.equal(schedules.get(job.id)?.state, 'uncertain'); assert.equal(calls, 1);
    const interrupted = pending(schedules); interrupted.state = 'sending'; store.set('schedules', interrupted.id, interrupted);
    schedules.recover(); await schedules.tick(interrupted.runAt + 200000);
    assert.equal(schedules.get(interrupted.id)?.state, 'uncertain'); assert.equal(calls, 1);
  } finally { store.close(); }
});
test('영구 권한 오류는 즉시 실패 처리한다', async () => {
  const { store, schedules } = setup(async () => { throw new DeliveryError('권한 없음', 'permanent'); });
  try { const job = pending(schedules); await schedules.tick(job.runAt + 1); assert.equal(schedules.get(job.id)?.state, 'failed'); }
  finally { store.close(); }
});
test('권한 없는 사용자가 오래된 예약 취소 버튼을 눌러도 예약을 변경하지 않는다', async () => {
  const { store, schedules, config } = setup(async () => 'msg');
  try {
    const job = pending(schedules), replies: unknown[] = [];
    const member = { id: 'intruder', guild: { id: 'guild' }, permissions: { has: () => false }, roles: { cache: new Map() } };
    const interaction: any = { guildId: 'guild', guild: { members: { fetch: async () => member } }, user: { id: 'intruder' }, customId: `schedule:cancel:${job.id}`, deferred: false, replied: false,
      isRepliable: () => true, isChatInputCommand: () => false, isButton: () => true,
      deferReply: async () => { interaction.deferred = true; }, editReply: async (payload: unknown) => { replies.push(payload); } };
    await route(interaction, { config, schedules } as any);
    assert.equal(schedules.get(job.id)?.state, 'pending'); assert.equal(replies.length, 1);
  } finally { store.close(); }
});
