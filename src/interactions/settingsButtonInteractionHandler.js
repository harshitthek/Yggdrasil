import { buildNeutralEmbed, buildSuccessEmbed, buildErrorEmbed } from '../utils/embeds.js';
import { buildSettingsComponents, buildFilterComponents } from '../utils/components.js';
import { replyToInteraction } from '../utils/responses.js';

/**
 * @file Interaction handler for the settings panel buttons.
 *
 * The settings panel (opened by clicking ⚙️ on the Now Playing embed)
 * renders five buttons with `settings_*` custom IDs:
 *
 *   - settings_loop_off    → repeat mode 0
 *   - settings_loop_track  → repeat mode 1
 *   - settings_loop_queue  → repeat mode 2
 *   - settings_autoplay    → toggle repeat mode 3
 *   - settings_filters     → show the filter panel
 *
 * This handler processes all five.
 */

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

function requireQueue(interaction, resolveQueue = getQueue) {
  const queue = resolveQueue(interaction);

  if (!queue || !queue.currentTrack) {
    return null;
  }

  return queue;
}

export const prefix = 'settings_';

export async function handle(interaction, { resolveQueue = getQueue } = {}) {
  if (!interaction.customId?.startsWith(prefix)) {
    return false;
  }

  if (!interaction?.isButton?.()) {
    return false;
  }

  const queue = requireQueue(interaction, resolveQueue);
  if (!queue) {
    await safeRespond(interaction, {
      embeds: [buildErrorEmbed('No Active Session', 'Nothing is playing right now. Use `tree play` to start.')]
    }, { ephemeral: true });
    return true;
  }

  const id = interaction.customId;

  // ─── Loop Mode Buttons ──────────────────────────────────────────────────
  if (id === 'settings_loop_off') {
    queue.setRepeatMode(0);
    try {
      await interaction.deferUpdate();
      await interaction.editReply({
        embeds: [buildNeutralEmbed('⚙️ Playback Settings', buildSettingsCopy(queue))],
        components: buildSettingsComponents(queue)
      });
    } catch {}
    return true;
  }

  if (id === 'settings_loop_track') {
    queue.setRepeatMode(1);
    try {
      await interaction.deferUpdate();
      await interaction.editReply({
        embeds: [buildNeutralEmbed('⚙️ Playback Settings', buildSettingsCopy(queue))],
        components: buildSettingsComponents(queue)
      });
    } catch {}
    return true;
  }

  if (id === 'settings_loop_queue') {
    queue.setRepeatMode(2);
    try {
      await interaction.deferUpdate();
      await interaction.editReply({
        embeds: [buildNeutralEmbed('⚙️ Playback Settings', buildSettingsCopy(queue))],
        components: buildSettingsComponents(queue)
      });
    } catch {}
    return true;
  }

  // ─── Autoplay Toggle ────────────────────────────────────────────────────
  if (id === 'settings_autoplay') {
    const newMode = queue.repeatMode === 3 ? 0 : 3;
    queue.setRepeatMode(newMode);
    try {
      await interaction.deferUpdate();
      await interaction.editReply({
        embeds: [buildNeutralEmbed('⚙️ Playback Settings', buildSettingsCopy(queue))],
        components: buildSettingsComponents(queue)
      });
    } catch {}
    return true;
  }

  // ─── Open Filters Panel ─────────────────────────────────────────────────
  if (id === 'settings_filters') {
    await safeRespond(interaction, {
      embeds: [buildSuccessEmbed('🎛️ Audio Filters', 'Select a filter to toggle, or clear all active filters.')],
      components: buildFilterComponents()
    }, { ephemeral: true });
    return true;
  }

  return false;
}

function buildSettingsCopy(queue) {
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

export const handleSettingsButtonInteraction = handle;
