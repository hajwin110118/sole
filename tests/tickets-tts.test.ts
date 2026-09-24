import test from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../src/core/config.js';
import { Store } from '../src/core/store.js';
import { Tickets, type Ticket } from '../src/features/tickets.js';
import { Tts, GoogleSpeechProvider, cleanSpeech } from '../src/features/tts.js';

const audit = { write: async () => {} } as any;
test('티켓은 문의자 또는 담당자만 종료할 수 있다', async () => {
  const config = new Config(), store = new Store(':memory:');
  try {
    config.guild('guild').tickets.supportRoleIds = ['support'];
    const ticket: Ticket = { id: 'ticket', guildId: 'guild', ownerId: 'owner', channelId: 'channel', state: 'open', createdAt: 0, subject: '테스트' };
    store.set('tickets', ticket.id, ticket);
    const tickets = new Tickets({} as any, config, store, audit);
    const member = (id: string, role = '', guildId = 'guild'): any => ({ id, guild: { id: guildId }, roles: { cache: new Map([[role, true]]) }, permissions: { has: () => false } });
    assert.equal(tickets.authorize('ticket', member('owner')).id, 'ticket');
    assert.equal(tickets.authorize('ticket', member('staff', 'support')).id, 'ticket');
    assert.throws(() => tickets.authorize('ticket', member('intruder')));
    assert.throws(() => tickets.authorize('ticket', member('owner', '', 'other-guild')));
  } finally { store.close(); }
});
test('티켓 재시작 복구는 생성된 채널 주제를 이용한다', async () => {
  const config = new Config(), store = new Store(':memory:');
  try {
    const { Collection, ChannelType } = await import('discord.js');
    const ticket: Ticket = { id: 'ticket', guildId: 'guild', ownerId: 'owner', channelId: '', state: 'opening', createdAt: 0, subject: '테스트' };
    store.set('tickets', ticket.id, ticket);
    const client: any = { guilds: { fetch: async () => ({ channels: { fetch: async () => new Collection([['created', { id: 'created', type: ChannelType.GuildText, topic: 'sole-ticket:ticket' }]]) } }) } };
    await new Tickets(client, config, store, audit).recover();
    assert.equal(store.get<Ticket>('tickets', 'ticket')?.channelId, 'created');
    assert.equal(store.get<Ticket>('tickets', 'ticket')?.state, 'open');
  } finally { store.close(); }
});
test('TTS 내용에서 URL·멘션·사용자 이모지와 마크다운을 제거한다', () => {
  assert.equal(cleanSpeech('**안녕** <@12345> https://example.com <:smile:12345> `테스트`'), '안녕 링크 테스트');
});
test('Google 합성 요청은 설정을 사용하며 비밀 키를 URL에 넣지 않는다', async context => {
  const oldKey = process.env.GOOGLE_TTS_API_KEY; process.env.GOOGLE_TTS_API_KEY = 'fake-test-key';
  try {
    context.mock.method(globalThis, 'fetch', async (url: string, options: any) => {
      assert.equal(url, 'https://texttospeech.googleapis.com/v1/text:synthesize');
      assert.equal(options.headers['X-Goog-Api-Key'], 'fake-test-key');
      const body = JSON.parse(options.body);
      assert.equal(body.input.text, '안녕하세요'); assert.equal(body.voice.name, 'ko-KR-Standard-A'); assert.equal(body.audioConfig.audioEncoding, 'MP3');
      return new Response(JSON.stringify({ audioContent: Buffer.from('audio').toString('base64') }), { status: 200 });
    });
    const audio = await new GoogleSpeechProvider().synthesize('안녕하세요', new Config().guild('guild').tts, new AbortController().signal);
    assert.equal(audio.toString(), 'audio');
  } finally { if (oldKey === undefined) delete process.env.GOOGLE_TTS_API_KEY; else process.env.GOOGLE_TTS_API_KEY = oldKey; }
});
test('중지 후 완료된 합성 결과는 재생하지 않으며 다른 음성 채널은 제어할 수 없다', async () => {
  const config = new Config(); config.guild('guild').tts.enabled = true;
  let release!: (audio: Buffer) => void, plays = 0;
  const provider = { synthesize: () => new Promise<Buffer>(resolve => { release = resolve; }) };
  const tts = new Tts(config, provider, audit);
  const session: any = { channelId: 'voice', connection: { state: { status: 'ready' }, destroy: () => {} }, player: { stop: () => {}, play: () => { plays++; } }, queue: [], pumping: false, epoch: 0 };
  (tts as any).sessions.set('guild', session);
  const member: any = { id: 'user', displayName: '사람', guild: { id: 'guild' }, voice: { channelId: 'voice' }, roles: { cache: new Map() } };
  try {
    assert.throws(() => tts.enqueue({ ...member, voice: { channelId: 'other' } }, '읽기'));
    assert.equal(tts.enqueue(member, '읽기'), 0);
    assert.throws(() => tts.enqueue(member, '다시 읽기'));
    tts.stop(member); release(Buffer.from('audio')); await new Promise(resolve => setImmediate(resolve));
    assert.equal(plays, 0); assert.equal(session.queue.length, 0);
  } finally { tts.destroyAll(); }
});
