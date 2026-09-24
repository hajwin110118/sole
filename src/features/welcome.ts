import { escapeMarkdown, type GuildMember } from 'discord.js';
import { interpolate, type Config } from '../core/config.js';
import { card } from '../core/ui.js';
import { sendableChannel } from '../core/permissions.js';
import type { Audit } from '../core/audit.js';
import { errorText } from '../core/errors.js';

export function welcomeCard(member: GuildMember, config: Config) {
  const settings = config.guild(member.guild.id).welcome;
  const variables = { user: `<@${member.id}>`, username: escapeMarkdown(member.displayName), server: escapeMarkdown(member.guild.name), memberCount: member.guild.memberCount };
  const payload = card(config, interpolate(settings.title, variables), interpolate(settings.body, variables), { imageUrl: settings.imageUrl });
  return { ...payload, allowedMentions: { users: [member.id], parse: [] as ('users' | 'roles' | 'everyone')[] } };
}
export async function welcomeMember(member: GuildMember, config: Config, audit: Audit): Promise<void> {
  const settings = config.guild(member.guild.id).welcome;
  if (!settings.enabled) return;
  try { await (await sendableChannel(member.guild, settings.channelId, config)).send(welcomeCard(member, config)); }
  catch (error) { await audit.write(member.guild.id, `환영 메시지 실패: ${errorText(error)}`); }
  for (const id of settings.autoRoleIds) {
    try {
      const role = await member.guild.roles.fetch(id);
      if (!role?.editable || role.managed || role.id === member.guild.id) throw new Error(`부여할 수 없는 역할: ${id}`);
      await member.roles.add(role, '입장 자동 역할');
    } catch (error) { await audit.write(member.guild.id, `자동 역할 부여 실패: ${errorText(error)}`); }
  }
}
