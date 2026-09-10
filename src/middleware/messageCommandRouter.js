import { buildErrorEmbed } from '../utils/embeds.js';
import { normalizeCommandName } from '../utils/commandNames.js';
import { BOT } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { parseMessageCommand } from '../utils/messageParser.js';
import { getAppContext } from '../context/appContext.js';
import { handleMusicChannelMessage } from '../services/musicChannelService.js';
import { isQueueVoiceChannelMatch } from '../services/playerService.js';
import { canUseAdminCommand, canUseNoPrefixShortcuts } from './permissionGuard.js';
import { handleMessageCommandError } from './errorHandler.js';
import { replyToMessage } from '../utils/responses.js';

function getCommandAliases(command) {
  return [command.name, ...(command.aliases ?? [])].map(normalizeCommandName);
}

function getNoPrefixCommandNames(commands) {
  return new Set(
    [...commands.values()]
      .filter((command) => command.allowNoPrefix && typeof command.executeMessage === 'function')
      .map((command) => normalizeCommandName(command.name))
  );
}

function findMessageCommand(commands, commandName) {
  const normalizedCommandName = normalizeCommandName(commandName);

  return (
    [...commands.values()].find((command) => {
      if (typeof command.executeMessage !== 'function') {
        return false;
      }

      return getCommandAliases(command).includes(normalizedCommandName);
    }) ?? null
  );
}

async function getPrivilegeContext(message) {
  const appContext = getAppContext(message) ?? {};
  const runtimeConfig = appContext.runtimeConfig ?? {};
  const settingsService = appContext.settingsService ?? null;
  const settings =
    settingsService && message.guild?.id
      ? await settingsService.getEffectiveSettings(message.guild.id).catch(() => null)
      : null;

  return {
    userId: message.author.id,
    guildOwnerId: message.guild?.ownerId ?? null,
    botOwnerId: runtimeConfig.botOwnerId ?? null,
    member: message.member ?? null,
    trustedAdminRoleIds: [...(runtimeConfig.trustedAdminRoleIds ?? []), ...(settings?.trustedAdminRoleIds ?? [])]
  };
}

async function replyWithPermissionError(message) {
  await replyToMessage(message, {
    embeds: [buildErrorEmbed('Permission required', 'You do not have permission to use that command.')]
  });
}

async function canUseNoPrefix(message) {
  const appContext = getAppContext(message) ?? {};
  const runtimeConfig = appContext.runtimeConfig ?? {};
  const noPrefixService = appContext.noPrefixService ?? null;
  const noPrefixAllowed = noPrefixService
    ? await noPrefixService.canUseNoPrefix(message.author.id).catch(() => false)
    : false;

  return canUseNoPrefixShortcuts({
    userId: message.author.id,
    botOwnerId: runtimeConfig.botOwnerId ?? null,
    noPrefixAllowed
  });
}

function isBotOwner(message) {
  const appContext = getAppContext(message) ?? {};
  const botOwnerId = appContext.runtimeConfig?.botOwnerId;
  const userId = message.author.id;
  const clientOwner = message.client?.application?.owner;

  return Boolean(
    userId &&
    ((botOwnerId && userId === botOwnerId) ||
      clientOwner?.id === userId ||
      clientOwner?.ownerUserId === userId ||
      Boolean(clientOwner?.members?.has?.(userId)))
  );
}

export async function handleMessageCommand(message, { log = logger } = {}) {
  if (!message.guild || message.author.bot) {
    return false;
  }

  const appContext = getAppContext(message) ?? {};
  const settingsService = appContext.settingsService ?? null;
  const commands = appContext.commands ?? new Map();

  if (await handleMusicChannelMessage(message, { commands, settingsService, appContext, log })) {
    return true;
  }

  const prefixedCommand = parseMessageCommand(message.content, {
    prefix: BOT.prefix,
    allowNoPrefix: false
  });
  const noPrefixCommandNames = getNoPrefixCommandNames(commands);
  let parsedCommand = prefixedCommand;

  if (!parsedCommand) {
    if (noPrefixCommandNames.size === 0 || !(await canUseNoPrefix(message))) {
      return false;
    }

    parsedCommand = parseMessageCommand(message.content, {
      prefix: BOT.prefix,
      allowNoPrefix: true,
      noPrefixCommandNames
    });

    if (!parsedCommand) {
      return false;
    }
  }

  const command = findMessageCommand(commands, parsedCommand.commandName);

  if (!command) {
    if (parsedCommand.mode === 'prefix') {
      await replyToMessage(message, {
        embeds: [buildErrorEmbed('Command unavailable', 'That command is not available right now.')]
      });
    }

    return false;
  }

  if (typeof command.executeMessage !== 'function') {
    if (parsedCommand.mode === 'prefix') {
      await replyToMessage(message, {
        embeds: [buildErrorEmbed('Command unavailable', 'This command is only available as a slash command.')]
      });
    }

    return false;
  }

  if (command.requiresSameVoiceChannel) {
    const queue = appContext.playerService?.getGuildQueue(message.guild.id);
    if (!isQueueVoiceChannelMatch(queue, message.member?.voice?.channel)) {
      await replyToMessage(message, {
        embeds: [buildErrorEmbed('Wrong Voice Channel', 'Join my voice channel before using this command.')]
      });
      return true;
    }
  }

  const privilegeContext = await getPrivilegeContext(message);

  if (command.botOwnerOnly && !isBotOwner(message)) {
    await replyWithPermissionError(message);
    return true;
  }

  if (command.adminOnly && !canUseAdminCommand(privilegeContext)) {
    await replyWithPermissionError(message);
    return true;
  }

  try {
    await command.executeMessage({
      mode: parsedCommand.mode,
      commandName: command.name,
      args: parsedCommand.args,
      message,
      client: message.client,
      appContext,
      guild: message.guild,
      user: message.author,
      member: message.member,
      respond: (payload) => replyToMessage(message, payload)
    });
    return true;
  } catch (error) {
    log.error?.(`Message command failed: ${command.name}`, error);
    await handleMessageCommandError(message, error);
    return true;
  }
}
