import { ActivityType, Events } from 'discord.js';

import { getAppContext } from '../context/appContext.js';
import { reconnect247Guilds } from '../services/musicService.js';
import { BOT } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  client.user.setActivity(BOT.activity, { type: ActivityType.Watching });
  logger.info(`Logged in as ${client.user.tag}.`);

  const appContext = getAppContext(client);
  if (appContext) {
    await reconnect247Guilds(client, appContext);
  }
}
