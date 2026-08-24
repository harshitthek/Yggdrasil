import { buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
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
    await safeRespond(
      interaction,
      {
        embeds: [buildErrorEmbed('No Active Session', 'Nothing is playing right now. Use `tree play` to start.')]
      },
      { ephemeral: true }
    );
    return null;
  }

  return queue;
}

export const prefix = 'queue_';

export async function handle(interaction, { resolveQueue = getQueue } = {}) {
  if (!interaction.customId?.startsWith(prefix)) {
    return false;
  }

  if (!interaction?.isButton?.() || interaction.customId !== 'queue_clear') {
    return false;
  }

  const queue = await requireQueue(interaction, resolveQueue);
  if (!queue) {
    return true;
  }

  const clearedCount = queue.tracks.data.length;
  queue.tracks.clear();

  const details =
    clearedCount > 0
      ? `Cleared **${clearedCount}** queued track${clearedCount === 1 ? '' : 's'}. The current track will finish playing.`
      : 'The queue was already empty. The current track will finish playing.';

  await safeRespond(
    interaction,
    {
      embeds: [buildSuccessEmbed('🗑️ Queue Cleared', details)]
    },
    { ephemeral: true }
  );

  return true;
}

export const handleQueueClearInteraction = handle;
