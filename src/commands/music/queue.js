import { SlashCommandBuilder } from 'discord.js';
import { getAppContext } from '../../context/appContext.js';
import { buildQueueEmbed, buildErrorEmbed } from '../../utils/embeds.js';
import { buildQueueComponents } from '../../utils/components.js';

export const name = 'queue';
export const aliases = ['q'];
export const allowNoPrefix = true;

export const data = new SlashCommandBuilder().setName('queue').setDescription('Show the current music queue.');

async function executeQueue(guildId, playerService, respond) {
  const queue = playerService?.getGuildQueue(guildId);

  if (!queue || !queue.currentTrack) {
    return respond({
      embeds: [buildErrorEmbed('No Active Session', 'Nothing is playing right now. Use `tree play` to start!')]
    });
  }

  const trackCount = queue.tracks?.data?.length ?? queue.tracks?.size ?? 0;

  return respond({
    embeds: [buildQueueEmbed(queue)],
    components: trackCount > 0 ? buildQueueComponents() : []
  });
}

export async function execute(interaction) {
  const appContext = getAppContext(interaction) ?? {};
  const playerService = appContext.playerService ?? null;
  await executeQueue(interaction.guild.id, playerService, async (payload) => {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  });
}

export async function executeMessage(context) {
  const playerService = context.appContext?.playerService ?? null;
  await executeQueue(context.guild.id, playerService, async (payload) => {
    await context.respond(payload);
  });
}
