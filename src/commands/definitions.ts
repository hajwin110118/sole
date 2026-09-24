import { ChannelType, InteractionContextType, SlashCommandBuilder } from 'discord.js';

const base = (name: string, description: string) => new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild);
export const commands = [
  base('command', 'SOLE 기능과 상호작용 패널을 확인합니다.'),
  base('welcome', '환영 인사를 관리합니다.')
    .addSubcommand(sub => sub.setName('preview').setDescription('현재 설정으로 환영 인사를 미리 봅니다.')),
  base('ticket', '문의 티켓을 이용합니다.')
    .addSubcommand(sub => sub.setName('open').setDescription('비공개 문의를 생성합니다.'))
    .addSubcommand(sub => sub.setName('panel').setDescription('이 채널에 문의 안내 패널을 게시합니다.'))
    .addSubcommand(sub => sub.setName('close').setDescription('현재 문의 티켓을 종료합니다.')),
  base('tts', '음성 채널에서 메시지를 읽습니다.')
    .addSubcommand(sub => sub.setName('join').setDescription('현재 음성 채널에 봇을 부릅니다.'))
    .addSubcommand(sub => sub.setName('say').setDescription('음성으로 읽을 내용을 입력합니다.').addStringOption(option => option.setName('text').setDescription('읽을 내용 (생략하면 입력 창 열기)').setMaxLength(1000)))
    .addSubcommand(sub => sub.setName('stop').setDescription('재생을 중지하고 대기열을 비웁니다.'))
    .addSubcommand(sub => sub.setName('leave').setDescription('음성 채널에서 봇을 내보냅니다.')),
  base('schedule', '특정 채널에 메시지를 예약합니다. (관리자)')
    .addSubcommand(sub => sub.setName('create').setDescription('날짜와 내용을 입력해 전송을 예약합니다.').addChannelOption(option => option.setName('channel').setDescription('메시지를 전송할 채널').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread)))
    .addSubcommand(sub => sub.setName('list').setDescription('최근 예약과 처리 상태를 확인합니다.'))
    .addSubcommand(sub => sub.setName('cancel').setDescription('예약을 취소합니다.').addStringOption(option => option.setName('id').setDescription('예약 ID').setRequired(true))),
  base('moderation', '자동 차단과 메시지 정리 상태를 확인합니다. (관리자)')
    .addSubcommand(sub => sub.setName('status').setDescription('최근 자동 차단 작업의 결과와 누락 내역을 표시합니다.')),
  base('settings', '현재 설정을 확인합니다. (관리자)')
    .addSubcommand(sub => sub.setName('show').setDescription('현재 서버에 적용된 설정을 확인합니다.'))
    .addSubcommand(sub => sub.setName('reload').setDescription('JSON 설정을 다시 불러옵니다. (봇 소유자)')),
];
