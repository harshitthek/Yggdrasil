import { SlashCommandBuilder } from 'discord.js';
import { getAppContext } from '../../context/appContext.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds.js';

export const name = 'shuffle';
export const aliases = ['mix'];
export const allowNoPrefix = true;
export const requiresSameVoiceChannel = true;

export const data = new SlashCommandBuilder().setName('shuffle').setDescription('Shuffles the current music queue.');

async function executeShuffle(guildId, playerService, respond) {
  const queue = playerService?.getGuildQueue(guildId);

  if (!queue || !queue.currentTrack) {
    return respond({
      embeds: [buildErrorEmbed('No Active Session', 'Nothing is playing right now.')]
    });
  }

  const upcomingCount = queue.tracks?.data?.length ?? queue.tracks?.size ?? 0;

  if (upcomingCount === 0) {
    return respond({
      embeds: [buildErrorEmbed('Nothing to Shuffle', 'There are no upcoming tracks to shuffle.')]
    });
  }

  try {
    queue.tracks.shuffle();
  } catch {
    return respond({
      embeds: [buildErrorEmbed('Shuffle Failed', 'Could not shuffle the queue at this time.')]
    });
  }

  return respond({
    embeds: [
      buildSuccessEmbed(
        '🔀 Queue Shuffled',
        `Shuffled **${upcomingCount}** upcoming track${upcomingCount === 1 ? '' : 's'}.`
      )
    ]
  });
}

export async function execute(interaction) {
  const guildId = interaction.guild.id;
  const appContext = getAppContext(interaction) ?? {};
  const playerService = appContext.playerService ?? null;

  await executeShuffle(guildId, playerService, async (payload) => {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  });
}

export async function executeMessage(context) {
  const guildId = context.guild.id;
  const playerService = context.appContext?.playerService ?? null;

  const respondFn = async (payload) => {
    await context.respond(payload);
  };

  await executeShuffle(guildId, playerService, respondFn);
}
