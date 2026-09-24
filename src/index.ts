import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
import { Config, requiredEnv } from './core/config.js';
import { Store } from './core/store.js';
import { Audit } from './core/audit.js';
import { logError } from './core/errors.js';
import { Tickets } from './features/tickets.js';
import { Tts, GoogleSpeechProvider } from './features/tts.js';
import { Moderation } from './features/moderation.js';
import { Schedules, discordDelivery } from './features/schedules.js';
import { welcomeMember } from './features/welcome.js';
import { route } from './commands/router.js';

const config = new Config();
const token = requiredEnv('DISCORD_TOKEN');
const store = new Store(process.env.BOT_DATABASE_PATH || 'data/sole.sqlite');
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
  makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 0 }),
  allowedMentions: { parse: [] },
});
const audit = new Audit(client, config);
const tickets = new Tickets(client, config, store, audit);
const tts = new Tts(config, new GoogleSpeechProvider(), audit);
const moderation = new Moderation(client, config, store, audit);
const schedules = new Schedules(config, store, discordDelivery(client, config), audit);
const services = { client, config, tickets, tts, moderation, schedules };
let timer: ReturnType<typeof setInterval> | undefined;
let stopping = false;
const tasks = new Set<Promise<unknown>>();
function run(scope: string, work: () => Promise<unknown>): void {
  if (stopping) return;
  const task = work().catch(error => logError(scope, error));
  tasks.add(task); void task.finally(() => tasks.delete(task));
}
client.once(Events.ClientReady, ready => run('시작', async () => {
  console.info(`${ready.user.tag} 로그인 완료 · ${ready.guilds.cache.size}개 서버`);
  schedules.recover(); await tickets.recover();
  timer = setInterval(() => { run('예약 처리', () => schedules.tick()); run('메시지 정리', () => moderation.tick()); }, 1000);
  run('예약 복구', () => schedules.tick()); run('메시지 정리 복구', () => moderation.tick());
}));
client.on(Events.InteractionCreate, interaction => run('상호작용', () => route(interaction, services)));
client.on(Events.GuildMemberAdd, member => run('환영 인사', () => welcomeMember(member, config, audit)));
client.on(Events.MessageCreate, message => run('메시지', async () => {
  if (message.author.bot || message.webhookId || !message.guild) return;
  if (await moderation.handle(message)) return;
  await tts.onMessage(message);
}));
client.on(Events.Error, error => logError('Discord 클라이언트', error));
client.on(Events.Warn, warning => console.warn(warning));
async function shutdown(signal: string): Promise<void> {
  if (stopping) return; stopping = true;
  console.info(`${signal}: 진행 중 작업을 저장하고 종료합니다.`);
  clearInterval(timer); tts.destroyAll();
  const deadline = setTimeout(() => process.exit(1), 25000); deadline.unref();
  await Promise.allSettled([...tasks]);
  client.destroy(); store.close(); clearTimeout(deadline);
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('unhandledRejection', error => { logError('처리되지 않은 Promise 오류', error); });
client.login(token).catch(error => { logError('로그인 실패', error); store.close(); client.destroy(); process.exitCode = 1; });
