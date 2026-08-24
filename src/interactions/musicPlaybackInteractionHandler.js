import { buildErrorEmbed, buildSuccessEmbed, buildQueueEmbed, buildNeutralEmbed } from '../utils/embeds.js';
import { buildQueueComponents } from '../utils/components.js';
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

async function requireQueue(interaction, resolveQueue = getQueue, allowEmptyTrack = false) {
  const queue = resolveQueue(interaction);

  if (!queue || (!allowEmptyTrack && !queue.currentTrack)) {
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

function buildVolumeLabel(volume) {
  const nextVolume = Math.min(100, Math.max(0, volume));
  return `${nextVolume}%`;
}

export const prefix = 'music_';

export async function handle(interaction, { resolveQueue = getQueue } = {}) {
  if (!interaction.customId?.startsWith(prefix)) {
    return false;
  }

  if (!interaction?.isButton?.()) {
    return false;
  }

  const id = interaction.customId;

  if (id === 'music_pause') {
    const queue = await requireQueue(interaction, resolveQueue);
    if (!queue) return true;

    if (queue.node.isPaused()) {
      await safeRespond(
        interaction,
        {
          embeds: [buildNeutralEmbed('Already Paused', 'The music is already paused. Click **Resume** ▶️ to continue.')]
        },
        { ephemeral: true }
      );
      return true;
    }

    queue.node.setPaused(true);
    await safeRespond(
      interaction,
      {
        embeds: [buildSuccessEmbed('⏸️ Paused', 'Music has been paused.')]
      },
      { ephemeral: true }
    );
    return true;
  }

  if (id === 'music_resume') {
    const queue = await requireQueue(interaction, resolveQueue);
    if (!queue) return true;

    if (!queue.node.isPaused()) {
      await safeRespond(
        interaction,
        {
          embeds: [buildNeutralEmbed('Already Playing', 'The music is already playing!')]
        },
        { ephemeral: true }
      );
      return true;
    }

    queue.node.setPaused(false);
    await safeRespond(
      interaction,
      {
        embeds: [buildSuccessEmbed('▶️ Resumed', 'Music has been resumed.')]
      },
      { ephemeral: true }
    );
    return true;
  }

  if (id === 'music_skip') {
    const queue = await requireQueue(interaction, resolveQueue);
    if (!queue) return true;

    const skippedTitle = queue.currentTrack?.title || 'current track';
    queue.node.skip();

    await safeRespond(
      interaction,
      {
        embeds: [buildSuccessEmbed('⏭️ Skipped', `Skipped **${skippedTitle}**.`)]
      },
      { ephemeral: false }
    );
    return true;
  }

  if (id === 'music_previous') {
    const queue = await requireQueue(interaction, resolveQueue);
    if (!queue) return true;

    try {
      await queue.history.previous();
      await safeRespond(
        interaction,
        {
          embeds: [buildSuccessEmbed('⏮️ Previous', 'Playing the previous track.')]
        },
        { ephemeral: true }
      );
    } catch {
      await safeRespond(
        interaction,
        {
          embeds: [buildErrorEmbed('No Previous Track', 'There is no previous track in history.')]
        },
        { ephemeral: true }
      );
    }

    return true;
  }

  if (id === 'music_stop') {
    const queue = resolveQueue(interaction);
    if (!queue) {
      await safeRespond(
        interaction,
        {
          embeds: [buildErrorEmbed('No Active Session', 'Nothing is playing right now.')]
        },
        { ephemeral: true }
      );
      return true;
    }

    let is247 = queue.metadata?.is247;
    if (is247 === undefined && interaction.appContext?.settingsService) {
      const settings = await interaction.appContext.settingsService.getSettings(interaction.guildId).catch(() => null);
      is247 = Boolean(settings?.twentyFourSeven?.enabled);
    }
    is247 = Boolean(is247);

    if (is247) {
      queue.tracks.clear();
      queue.node.stop();
      await safeRespond(
        interaction,
        {
          embeds: [
            buildSuccessEmbed(
              '⏹️ Stopped',
              'Stopped the music and cleared the queue. Staying in voice channel (24/7 mode is active). 🎵'
            )
          ]
        },
        { ephemeral: false }
      );
      return true;
    }

    queue.delete();
    await safeRespond(
      interaction,
      {
        embeds: [buildSuccessEmbed('⏹️ Stopped', 'Stopped the music and cleared the queue. See you next time! 👋')]
      },
      { ephemeral: false }
    );
    return true;
  }

  if (id === 'music_shuffle') {
    const queue = await requireQueue(interaction, resolveQueue);
    if (!queue) return true;

    const count = queue.tracks?.data?.length ?? queue.tracks?.size ?? 0;

    if (count === 0) {
      await safeRespond(
        interaction,
        {
          embeds: [buildErrorEmbed('Nothing to Shuffle', 'The queue is empty.')]
        },
        { ephemeral: true }
      );
      return true;
    }

    try {
      queue.tracks.shuffle();
    } catch {}

    await safeRespond(
      interaction,
      {
        embeds: [buildSuccessEmbed('🔀 Shuffled', `Shuffled **${count}** tracks!`)]
      },
      { ephemeral: true }
    );
    return true;
  }

  if (id === 'music_queue') {
    const queue = await requireQueue(interaction, resolveQueue);
    if (!queue) return true;

    const count = queue.tracks?.data?.length ?? queue.tracks?.size ?? 0;

    await safeRespond(
      interaction,
      {
        embeds: [buildQueueEmbed(queue)],
        components: count > 0 ? buildQueueComponents() : []
      },
      { ephemeral: true }
    );
    return true;
  }

  if (id === 'music_volup') {
    const queue = await requireQueue(interaction, resolveQueue);
    if (!queue) return true;

    const newVol = Math.min(100, (queue.node.volume ?? 80) + 10);
    queue.node.setVolume(newVol);

    await safeRespond(
      interaction,
      {
        embeds: [buildSuccessEmbed('🔊 Volume Up', `Volume set to **${buildVolumeLabel(newVol)}**`)]
      },
      { ephemeral: true }
    );
    return true;
  }

  if (id === 'music_voldown') {
    const queue = await requireQueue(interaction, resolveQueue);
    if (!queue) return true;

    const newVol = Math.max(0, (queue.node.volume ?? 80) - 10);
    queue.node.setVolume(newVol);

    await safeRespond(
      interaction,
      {
        embeds: [buildSuccessEmbed('🔉 Volume Down', `Volume set to **${buildVolumeLabel(newVol)}**`)]
      },
      { ephemeral: true }
    );
    return true;
  }

  return false;
}

export const handleMusicPlaybackInteraction = handle;
