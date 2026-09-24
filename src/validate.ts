import { spawnSync } from 'node:child_process';
import { generateDependencyReport } from '@discordjs/voice';
import { Config } from './core/config.js';
import { commands } from './commands/definitions.js';
import { ticketModal, ttsModal, scheduleModal } from './commands/router.js';
import { card } from './core/ui.js';

const config = new Config();
for (const command of commands) command.toJSON();
ticketModal(config).toJSON(); ttsModal(config, 'validation').toJSON(); scheduleModal(config, 'validation', '123456789012345678').toJSON();
card(config, '설정 검증', 'Components V2').components[0]!.toJSON();
console.info('설정, 명령어, Components V2 및 모달 직렬화 검사 통과');
console.info(`DISCORD_TOKEN: ${process.env.DISCORD_TOKEN ? '설정됨' : '미설정 (실행 전에 필요)'}`);
console.info(`DISCORD_CLIENT_ID: ${process.env.DISCORD_CLIENT_ID ? '설정됨' : '미설정 (명령어 등록 전에 필요)'}`);
console.info(`GOOGLE_TTS_API_KEY: ${process.env.GOOGLE_TTS_API_KEY ? '설정됨' : '미설정 (TTS 사용 시 필요)'}`);
console.info(`FFmpeg: ${spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 ? '설치됨' : '미설치 (TTS 사용 시 필요)'}`);
console.info(generateDependencyReport());
