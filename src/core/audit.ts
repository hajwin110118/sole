import type { Client } from 'discord.js';
import type { Config } from './config.js';
import { card } from './ui.js';
import { errorText } from './errors.js';

export class Audit {
  constructor(private client: Client, private config: Config) {}
  async write(guildId: string, message: string): Promise<void> {
    console.info(`[${new Date().toISOString()}] [${guildId}] ${message}`);
    const id = this.config.guild(guildId).logChannelId;
    if (!id) return;
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(id);
      if (!channel?.isSendable()) throw new Error('로그 채널이 없거나 전송할 수 없습니다.');
      await channel.send(card(this.config, `${this.config.appearance.name} · 로그`, message));
    } catch (error) { console.error(`로그 채널 전송 실패: ${errorText(error)}`); }
  }
}
