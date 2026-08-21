import { Events } from 'discord.js';

import { createActivityRoleService } from '../services/activityRoleService.js';
import { logger } from '../utils/logger.js';

export const name = Events.VoiceStateUpdate;

// Cache the service instance so we don't re-create it on every voice state event.
let cachedService = null;

function getService(settingsService) {
  if (!cachedService) {
    cachedService = createActivityRoleService({ settingsService, log: logger });
  }
  return cachedService;
}

export async function execute(oldState, newState, client, appContext = null) {
  const settingsService = appContext?.settingsService;

  if (!settingsService) {
    logger.warn('VoiceStateUpdate event fired but settingsService is not available on client.');
    return;
  }

  const service = getService(settingsService);
  await service.handleVoiceStateUpdate(oldState, newState);

  // Auto-heal 24/7 voice connection if the bot itself was disconnected
  if (client?.user && oldState.id === client.user.id && oldState.channelId && !newState.channelId) {
    const guildId = oldState.guild.id;
    try {
      const settings = await settingsService.getSettings(guildId);
      if (settings?.twentyFourSeven?.enabled && settings?.twentyFourSeven?.voiceChannelId) {
        logger.warn(
          `[24/7 Auto-Healing] Bot disconnected from voice in guild "${oldState.guild.name}". Reconnecting in 3s...`
        );
        setTimeout(async () => {
          const { reconnect247Guilds } = await import('../services/musicService.js');
          await reconnect247Guilds(client, appContext, { quiet: true });
        }, 3000);
      }
    } catch (err) {
      logger.error(`[24/7 Auto-Healing] Error handling voice disconnect in guild ${guildId}:`, err);
    }
  }
}
