import { buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { buildFilterComponents } from '../utils/components.js';
import { replyToInteraction } from '../utils/responses.js';

function getQueue(interaction) {
  return interaction.appContext?.playerService?.getGuildQueue(interaction.guildId);
}

async function safeRespond(interaction, payload, options = { ephemeral: true }) {
  try {
    return await replyToInteraction(interaction, payload, options);
  } catch {
    /* interaction already handled or token expired */
  }
}

async function requireQueue(interaction, resolveQueue = getQueue) {
  const queue = resolveQueue(interaction);

  if (!queue || !queue.currentTrack) {
    await safeRespond(interaction, {
      embeds: [buildErrorEmbed('No Active Session', 'Nothing is playing right now. Use `tree play` to start.')]
    }, { ephemeral: true });
    return null;
  }

  return queue;
}

const FILTER_LABELS = {
  bassboost: 'Bass Boost',
  nightcore: 'Nightcore',
  vaporwave: 'Vaporwave',
  '8d': '8D Audio'
};

const FILTER_TARGETS = {
  bassboost: 'bassboost',
  nightcore: 'nightcore',
  vaporwave: 'vaporwave',
  '8d': '8D'
};

export const prefix = 'filter_';

export async function handle(interaction, { resolveQueue = getQueue } = {}) {
  if (!interaction.customId?.startsWith(prefix)) {
    return false;
  }

  if (!interaction?.isButton?.()) {
    return false;
  }

  const queue = await requireQueue(interaction, resolveQueue);
  if (!queue) {
    return true;
  }

  const filterName = interaction.customId.replace('filter_', '');

  if (filterName === 'clear') {
    await interaction.deferUpdate();
    await queue.filters.ffmpeg.setFilters(false);
    await interaction.editReply({
      embeds: [buildSuccessEmbed('🗑️ Filters Cleared', 'All audio filters have been removed.')],
      components: buildFilterComponents()
    });
    return true;
  }

  const dpFilterName = FILTER_TARGETS[filterName];

  if (!dpFilterName) {
    return false;
  }

  await interaction.deferUpdate();
  await queue.filters.ffmpeg.toggle([dpFilterName]);
  await interaction.editReply({
    embeds: [
      buildSuccessEmbed(
        `🎛️ ${FILTER_LABELS[filterName] ?? dpFilterName}`,
        `**${FILTER_LABELS[filterName] ?? dpFilterName}** filter has been toggled.`
      )
    ],
    components: buildFilterComponents()
  });

  return true;
}

export const handleMusicFilterInteraction = handle;
