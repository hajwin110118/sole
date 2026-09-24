import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, TextDisplayBuilder, type RepliableInteraction } from 'discord.js';
import type { Config } from './config.js';

export function button(id: string, label: string, style: ButtonStyle = ButtonStyle.Secondary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}
export function card(config: Config, title: string, body: string, options: { buttons?: ButtonBuilder[]; imageUrl?: string; error?: boolean } = {}) {
  const container = new ContainerBuilder().setAccentColor(parseInt((options.error ? config.appearance.errorColor : config.appearance.accentColor).slice(1), 16))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${body}`.slice(0, 3900)));
  if (options.imageUrl) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(options.imageUrl)));
  if (options.buttons?.length) container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(options.buttons));
  return { components: [container], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] as ('users' | 'roles' | 'everyone')[] } };
}
export async function respond(interaction: RepliableInteraction, payload: ReturnType<typeof card>): Promise<void> {
  if (interaction.deferred) await interaction.editReply(payload);
  else if (interaction.replied) await interaction.followUp({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
  else await interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
}
