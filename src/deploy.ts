import { REST, Routes } from 'discord.js';
import { commands } from './commands/definitions.js';
import { requiredEnv, Config } from './core/config.js';

new Config();
const token = requiredEnv('DISCORD_TOKEN'), clientId = requiredEnv('DISCORD_CLIENT_ID');
const guildId = process.env.DISCORD_GUILD_ID?.trim();
const rest = new REST({ version: '10' }).setToken(token);
// 이 앱의 해당 범위 명령어 목록을 교체합니다. 별도 앱의 명령어에는 영향을 주지 않습니다.
await rest.put(guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId), { body: commands.map(command => command.toJSON()) });
console.info(`${commands.length}개 명령어 등록 완료 (${guildId ? `서버 ${guildId}` : '전역'})`);
