import { Readable } from 'node:stream';
import { AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel, type AudioPlayer, type VoiceConnection } from '@discordjs/voice';
import { ChannelType, PermissionFlagsBits, type GuildMember, type Message } from 'discord.js';
import type { Config, GuildConfig } from '../core/config.js';
import type { Audit } from '../core/audit.js';
import { UserError, errorText } from '../core/errors.js';

export interface SpeechProvider { synthesize(text: string, settings: GuildConfig['tts'], signal: AbortSignal): Promise<Buffer> }
/** 다른 TTS 서비스로 교체하려면 이 인터페이스를 구현하면 됩니다. */
export class GoogleSpeechProvider implements SpeechProvider {
  async synthesize(text: string, cfg: GuildConfig['tts'], signal: AbortSignal): Promise<Buffer> {
    const key = process.env.GOOGLE_TTS_API_KEY;
    if (!key) throw new Error('GOOGLE_TTS_API_KEY가 설정되지 않았습니다.');
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify({ input: { text }, voice: { languageCode: cfg.languageCode, name: cfg.voiceName }, audioConfig: { audioEncoding: 'MP3', speakingRate: cfg.speakingRate } }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    });
    if (!response.ok) throw new Error(`Google TTS HTTP ${response.status}`);
    const data = await response.json() as { audioContent?: string };
    if (!data.audioContent) throw new Error('Google TTS 응답에 음성이 없습니다.');
    return Buffer.from(data.audioContent, 'base64');
  }
}
export function cleanSpeech(text: string): string {
  return text.replace(/https?:\/\/\S+/g, ' 링크 ').replace(/<a?:\w+:\d+>/g, ' ').replace(/<[@#][!&]?\d+>/g, ' ').replace(/[`*_~|]/g, '').replace(/\s+/g, ' ').trim();
}
interface Session {
  channelId: string; connection: VoiceConnection; player: AudioPlayer; queue: string[];
  pumping: boolean; epoch: number; abort?: AbortController; idle?: ReturnType<typeof setTimeout>;
}
export class Tts {
  private sessions = new Map<string, Session>();
  private joining = new Set<string>();
  private cooldowns = new Map<string, number>();
  constructor(private config: Config, private provider: SpeechProvider, private audit: Audit) {}
  private check(member: GuildMember): void {
    const cfg = this.config.guild(member.guild.id).tts;
    if (!cfg.enabled) throw new UserError(this.config.t('common.disabled'));
    if (cfg.allowedRoleIds.length && !cfg.allowedRoleIds.some(id => member.roles.cache.has(id))) throw new UserError(this.config.t('common.forbidden'));
  }
  async join(member: GuildMember): Promise<string> {
    this.check(member);
    if (!process.env.GOOGLE_TTS_API_KEY) throw new UserError(this.config.t('tts.noKey'));
    const channel = member.voice.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new UserError(this.config.t('tts.joinFirst'));
    const existing = this.sessions.get(member.guild.id);
    if (existing) { if (existing.channelId !== channel.id) throw new UserError(this.config.t('tts.sameChannel')); return channel.id; }
    if (this.joining.has(member.guild.id)) throw new UserError('음성 채널에 연결 중이에요.');
    this.joining.add(member.guild.id);
    let connection: VoiceConnection | undefined;
    try {
      const me = await member.guild.members.fetchMe();
      if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new UserError('봇에 음성 채널 보기·연결·말하기 권한이 필요해요.');
      connection = joinVoiceChannel({ channelId: channel.id, guildId: member.guild.id, adapterCreator: member.guild.voiceAdapterCreator, selfDeaf: true });
      connection.on('error', error => { void this.audit.write(member.guild.id, `음성 연결 오류: ${errorText(error)}`); });
      await entersState(connection, VoiceConnectionStatus.Ready, 20000);
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
      player.on('error', error => { void this.audit.write(member.guild.id, `TTS 재생 오류: ${errorText(error)}`); });
      connection.subscribe(player);
      const session: Session = { channelId: channel.id, connection, player, queue: [], pumping: false, epoch: 0 };
      this.sessions.set(member.guild.id, session);
      connection.on(VoiceConnectionStatus.Disconnected, () => {
        void Promise.race([entersState(session.connection, VoiceConnectionStatus.Signalling, 5000), entersState(session.connection, VoiceConnectionStatus.Connecting, 5000)])
          .catch(() => { if (this.sessions.get(member.guild.id) === session) this.destroy(member.guild.id); });
      });
      this.armIdle(member.guild.id, session);
      return channel.id;
    } catch (error) { if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy(); throw error; }
    finally { this.joining.delete(member.guild.id); }
  }
  private current(member: GuildMember): Session {
    this.check(member);
    const session = this.sessions.get(member.guild.id);
    if (!session) throw new UserError(this.config.t('tts.notConnected'));
    if (member.voice.channelId !== session.channelId) throw new UserError(this.config.t('tts.sameChannel'));
    return session;
  }
  enqueue(member: GuildMember, input: string): number {
    const session = this.current(member), cfg = this.config.guild(member.guild.id).tts;
    const text = cleanSpeech(input);
    if (!text || text.length > cfg.maxCharacters) throw new UserError(this.config.t('tts.tooLong', { max: cfg.maxCharacters }));
    if (session.queue.length + Number(session.pumping) >= cfg.maxQueueSize) throw new UserError(this.config.t('tts.queueFull'));
    const now = Date.now(), key = `${member.guild.id}:${member.id}`;
    for (const [k, until] of this.cooldowns) if (until <= now) this.cooldowns.delete(k);
    if ((this.cooldowns.get(key) ?? 0) > now) throw new UserError(this.config.t('tts.cooldown'));
    this.cooldowns.set(key, now + cfg.cooldownSeconds * 1000);
    const ahead = session.queue.length + Number(session.pumping);
    session.queue.push(cfg.readAuthorName ? `${cleanSpeech(member.displayName)}: ${text}` : text);
    clearTimeout(session.idle);
    void this.pump(member.guild.id, session);
    return ahead;
  }
  async onMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || message.webhookId) return;
    const cfg = this.config.guild(message.guild.id).tts, session = this.sessions.get(message.guild.id);
    if (!cfg.enabled || !cfg.textChannelIds.includes(message.channelId) || !session || !message.content.trim()) return;
    const member = await message.guild.members.fetch({ user: message.author.id, force: true });
    if (member.voice.channelId !== session.channelId) return;
    try { this.enqueue(member, message.content); }
    catch (error) { if (!(error instanceof UserError)) throw error; /* 채팅에는 반복 오류 응답을 보내지 않습니다. /tts say는 오류를 표시합니다. */ }
  }
  stop(member: GuildMember): void {
    const session = this.current(member);
    session.epoch++; session.queue = []; session.abort?.abort(); session.player.stop(true);
    this.armIdle(member.guild.id, session);
  }
  leave(member: GuildMember): void { this.current(member); this.destroy(member.guild.id); }
  destroy(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    this.sessions.delete(guildId); clearTimeout(session.idle); session.epoch++; session.queue = []; session.abort?.abort(); session.player.stop(true);
    if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) session.connection.destroy();
  }
  destroyAll(): void { for (const id of this.sessions.keys()) this.destroy(id); }
  private armIdle(guildId: string, session: Session): void {
    clearTimeout(session.idle);
    session.idle = setTimeout(() => { if (this.sessions.get(guildId) === session) this.destroy(guildId); }, this.config.guild(guildId).tts.idleDisconnectSeconds * 1000);
    session.idle.unref();
  }
  private async pump(guildId: string, session: Session): Promise<void> {
    if (session.pumping) return;
    session.pumping = true;
    try {
      while (this.sessions.get(guildId) === session && session.queue.length) {
        const text = session.queue.shift()!, epoch = session.epoch;
        session.abort = new AbortController();
        try {
          const audio = await this.provider.synthesize(text, this.config.guild(guildId).tts, session.abort.signal);
          if (epoch !== session.epoch || this.sessions.get(guildId) !== session) continue;
          const resource = createAudioResource(Readable.from(audio), { inputType: StreamType.Arbitrary });
          await new Promise<void>((resolve, reject) => {
            const done = () => { cleanup(); resolve(); };
            const fail = (error: Error) => { cleanup(); session.player.stop(true); reject(error); };
            const timer = setTimeout(() => fail(new Error('TTS 재생 제한 시간 초과')), 300000);
            const cleanup = () => { clearTimeout(timer); session.player.off(AudioPlayerStatus.Idle, done); session.player.off('error', fail); };
            session.player.once(AudioPlayerStatus.Idle, done); session.player.once('error', fail);
            try { session.player.play(resource); } catch (error) { fail(error as Error); }
          });
        } catch (error) { if (epoch === session.epoch && this.sessions.get(guildId) === session) await this.audit.write(guildId, `${this.config.t('tts.providerError')} (${errorText(error)})`); }
      }
    } finally { session.pumping = false; if (this.sessions.get(guildId) === session) this.armIdle(guildId, session); }
  }
}
