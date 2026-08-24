/**
 * @file Discord interaction router.
 *
 * Despite the historical filename `commandRouter.js`, this module dispatches
 * Discord component/select-menu interactions to the appropriate handler. As
 * of the Phase 2 cleanup, direct imports of the seven interaction handler
 * modules have been replaced with a prefix-keyed registry; see
 * `src/interactions/registry.js` for the dispatcher and
 * `src/interactions/registerAllHandlers.js` for the one-shot registration.
 *
 * The file name is retained per project decision — it is functionally the
 * interaction router.
 *
 * @module middleware/commandRouter
 */
import { PermissionsBitField } from 'discord.js';

import { buildErrorEmbed } from '../utils/embeds.js';
import { normalizeCommandName } from '../utils/commandNames.js';
import { logger } from '../utils/logger.js';
import { replyToInteraction } from '../utils/responses.js';
import { getAppContext } from '../context/appContext.js';
import { handleInteractionError } from './errorHandler.js';
import { canUseAdminCommand, canRunModerationAction } from './permissionGuard.js';
import { isQueueVoiceChannelMatch } from '../services/playerService.js';
import { dispatch } from '../interactions/registry.js';
import { registerAllInteractionHandlers } from '../interactions/registerAllHandlers.js';

let registered = false;

function isMusicControl(customId) {
  return /^(music_|settings_|filter_|queue_)/.test(customId ?? '');
}

function ensureHandlersRegistered() {
  if (registered) return;
  registerAllInteractionHandlers();
  registered = true;
}

// Register at module load. Guarded so repeated imports / hot reloads are safe.
ensureHandlersRegistered();

async function handleUnknownCommand(interaction, log) {
  log.warn(`No command handler found for /${interaction.commandName}.`);
  await replyToInteraction(
    interaction,
    { embeds: [buildErrorEmbed('Command unavailable', 'That command is not available right now.')] },
    { ephemeral: true }
  );
}

// ─── Component Interaction Handler ──────────────────────────────────────────

export async function handleComponentInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) {
    return;
  }

  try {
    ensureHandlersRegistered();

    if (isMusicControl(interaction.customId)) {
      const queue = interaction.appContext?.playerService?.getGuildQueue(interaction.guildId);
      if (!isQueueVoiceChannelMatch(queue, interaction.member?.voice?.channel)) {
        await replyToInteraction(
          interaction,
          { embeds: [buildErrorEmbed('Wrong Voice Channel', 'Join my voice channel before using music controls.')] },
          { ephemeral: true }
        );
        return;
      }
    }

    await dispatch(interaction);
  } catch (error) {
    logger.error('Component interaction error.', error);
    try {
      await replyToInteraction(
        interaction,
        { embeds: [buildErrorEmbed('Error', 'Something went wrong. Please try again.')] },
        { ephemeral: true }
      );
    } catch {
      /* interaction expired */
    }
  }
}

// ─── Slash Command Handler ──────────────────────────────────────────────────

export async function handleChatInputCommand(interaction, { log = logger } = {}) {
  const appContext = getAppContext(interaction) ?? {};
  const commands = appContext.commands ?? new Map();
  const runtimeConfig = appContext.runtimeConfig ?? {};
  const settingsService = appContext.settingsService ?? null;
  const command = commands.get(normalizeCommandName(interaction.commandName));

  if (!command) {
    await handleUnknownCommand(interaction, log);
    return;
  }

  if (command.requiresSameVoiceChannel) {
    const queue = appContext.playerService?.getGuildQueue(interaction.guild?.id);
    if (!isQueueVoiceChannelMatch(queue, interaction.member?.voice?.channel)) {
      await replyToInteraction(
        interaction,
        { embeds: [buildErrorEmbed('Wrong Voice Channel', 'Join my voice channel before using this command.')] },
        { ephemeral: true }
      );
      return;
    }
  }

  const settings =
    settingsService && interaction.guild?.id
      ? await settingsService.getEffectiveSettings(interaction.guild.id).catch(() => null)
      : null;

  if (command.botOwnerOnly && interaction.user.id !== runtimeConfig.botOwnerId) {
    await replyToInteraction(
      interaction,
      { embeds: [buildErrorEmbed('Permission required', 'Only the configured bot owner can use that command.')] },
      { ephemeral: true }
    );
    return;
  }

  if (
    command.adminOnly &&
    !canUseAdminCommand({
      userId: interaction.user.id,
      guildOwnerId: interaction.guild?.ownerId ?? null,
      botOwnerId: runtimeConfig.botOwnerId ?? null,
      member: interaction.member,
      trustedAdminRoleIds: [...(runtimeConfig.trustedAdminRoleIds ?? []), ...(settings?.trustedAdminRoleIds ?? [])]
    })
  ) {
    await replyToInteraction(
      interaction,
      { embeds: [buildErrorEmbed('Permission required', 'You do not have permission to use that command.')] },
      { ephemeral: true }
    );
    return;
  }

  if (
    command.modOnly &&
    !canRunModerationAction(
      interaction.member,
      command.data?.default_member_permissions ?? PermissionsBitField.Flags.ModerateMembers
    ) &&
    !canUseAdminCommand({
      userId: interaction.user.id,
      guildOwnerId: interaction.guild?.ownerId ?? null,
      botOwnerId: runtimeConfig.botOwnerId ?? null,
      member: interaction.member,
      trustedAdminRoleIds: [...(runtimeConfig.trustedAdminRoleIds ?? []), ...(settings?.trustedAdminRoleIds ?? [])]
    })
  ) {
    await replyToInteraction(
      interaction,
      {
        embeds: [buildErrorEmbed('Permission required', 'You do not have permission to use that moderation command.')]
      },
      { ephemeral: true }
    );
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}
