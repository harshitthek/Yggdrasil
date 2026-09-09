export function createAppContext({
  client = null,
  config = {},
  settingsService = null,
  noPrefixService = null,
  logger = null,
  commands = null,
  playerService = null
} = {}) {
  return {
    client,
    config,
    runtimeConfig: config,
    settingsService,
    noPrefixService,
    logger,
    commands,
    playerService
  };
}

export function getAppContext(source) {
  return source?.appContext ?? source?.client?.appContext ?? null;
}
