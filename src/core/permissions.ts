import { PermissionFlagsBits, type GuildMember, type GuildTextBasedChannel, type Guild, type RepliableInteraction } from 'discord.js';
import type { Config } from './config.js';
import { UserError } from './errors.js';

export function isManager(member: GuildMember, config: Config): boolean {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || config.guild(member.guild.id).managerRoleIds.some(id => member.roles.cache.has(id));
}
export async function memberFor(interaction: RepliableInteraction): Promise<GuildMember> {
  if (!interaction.guild) throw new UserError('서버 안에서만 사용할 수 있어요.');
  return interaction.guild.members.fetch({ user: interaction.user.id, force: true });
}
export async function requireManager(interaction: RepliableInteraction, config: Config): Promise<GuildMember> {
  const member = await memberFor(interaction);
  if (!isManager(member, config)) throw new UserError(config.t('common.forbidden'));
  return member;
}
export async function sendableChannel(guild: Guild, id: string, config: Config) {
  const channel = await guild.channels.fetch(id);
  if (!channel?.isTextBased() || !channel.isSendable()) throw new UserError(config.t('common.channelMissing'));
  const me = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(me);
  const send = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, send]) || (channel.isThread() && (channel.archived || channel.locked))) throw new UserError(config.t('common.channelMissing'));
  return channel;
}
