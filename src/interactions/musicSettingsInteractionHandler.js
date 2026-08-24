import { buildNeutralEmbed, buildErrorEmbed } from '../utils/embeds.js';
import { buildSettingsComponents } from '../utils/components.js';
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

function buildPlaybackSettingsCopy(queue) {
  const loopLabels = { 0: 'Off', 1: 'Track', 2: 'Queue', 3: 'Autoplay' };
  const loopMode = loopLabels[queue.repeatMode] ?? 'Off';
  const volume = queue.node.volume ?? 80;

  return [
    `**Loop Mode:** ${loopMode}`,
    `**Volume:** ${volume}%`,
    '',
    'Use the buttons below to switch loop mode, toggle autoplay, or open filters.'
  ].join('\n');
}

export const prefix = 'music_settings';

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

  await safeRespond(
    interaction,
    {
      embeds: [buildNeutralEmbed('⚙️ Playback Settings', buildPlaybackSettingsCopy(queue))],
      components: buildSettingsComponents(queue)
    },
    { ephemeral: true }
  );

  return true;
}

export const handleMusicSettingsInteraction = handle;
