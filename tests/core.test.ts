import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, deepMerge, interpolate } from '../src/core/config.js';
import { Store } from '../src/core/store.js';
import { card, button } from '../src/core/ui.js';
import { commands } from '../src/commands/definitions.js';
import { ticketModal, ttsModal, scheduleModal } from '../src/commands/router.js';
import { ComponentType, MessageFlags } from 'discord.js';

test('서버 설정은 깊게 병합하고 배열은 교체한다', () => {
  const base = { tickets: { enabled: false, roles: ['old'] }, zone: 'Asia/Seoul' };
  const merged = deepMerge(base, { tickets: { enabled: true, roles: ['new'] } });
  assert.deepEqual(merged, { tickets: { enabled: true, roles: ['new'] }, zone: 'Asia/Seoul' });
  assert.equal(base.tickets.enabled, false);
  assert.throws(() => deepMerge({}, JSON.parse('{"__proto__":{"polluted":true}}')));
});
test('템플릿에 삽입된 사용자 문자열을 다시 치환하지 않는다', () => {
  assert.equal(interpolate('{user} {count} {unknown}', { user: '{count}', count: 10 }), '{count} 10 {unknown}');
});
test('잘못된 설정 새로고침은 기존 설정을 보존한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sole-config-'));
  try {
    const path = join(directory, 'bot.json');
    writeFileSync(path, readFileSync('config/bot.json'));
    const config = new Config(path, 'config/messages.json');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    raw.defaults.moderation.enabled = true;
    writeFileSync(path, JSON.stringify(raw));
    assert.throws(() => config.reload(), /triggerChannelIds/);
    assert.equal(config.guild('unknown').moderation.enabled, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('서버별 설정 및 필수 문구 키 검증', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sole-config-'));
  try {
    const raw = JSON.parse(readFileSync('config/bot.json', 'utf8'));
    raw.guilds['123456789012345678'] = { timezone: 'UTC', tts: { enabled: true } };
    writeFileSync(join(directory, 'bot.json'), JSON.stringify(raw));
    const config = new Config(join(directory, 'bot.json'), 'config/messages.json');
    assert.equal(config.guild('123456789012345678').tts.enabled, true);
    assert.equal(config.guild('123456789012345678').tts.voiceName, 'ko-KR-Standard-A');
    assert.equal(config.guild('other').tts.enabled, false);
    const messages = JSON.parse(readFileSync('config/messages.json', 'utf8')); delete messages['ticket.created'];
    writeFileSync(join(directory, 'messages.json'), JSON.stringify(messages));
    assert.throws(() => new Config(join(directory, 'bot.json'), join(directory, 'messages.json')), /ticket.created/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('SQLite 저장은 연결을 닫고 다시 열어도 유지된다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sole-store-'));
  try {
    const path = join(directory, 'db.sqlite');
    const first = new Store(path); first.set('test', 'record', { state: 'pending' }); first.close();
    const second = new Store(path); assert.deepEqual(second.get('test', 'record'), { state: 'pending' });
    second.delete('test', 'record'); assert.equal(second.list('test').length, 0); second.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('V2 화면과 모달, 모든 슬래시 명령어가 API 형식으로 직렬화된다', () => {
  const config = new Config();
  const payload = card(config, '안내', '내용', { buttons: [button('test', '테스트')] });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.ok(!('content' in payload)); assert.ok(!('embeds' in payload));
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(payload.components[0]?.toJSON().type, ComponentType.Container);
  for (const command of commands) assert.ok(command.toJSON().name);
  for (const modal of [ticketModal(config), ttsModal(config, 'g'), scheduleModal(config, 'g', '123456789012345678')]) {
    assert.equal(modal.toJSON().components[0]?.type, ComponentType.Label);
  }
});
