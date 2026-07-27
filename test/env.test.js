import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readCommandRegistrationEnv, readRuntimeEnv } from '../src/config/env.js';

test('readRuntimeEnv returns trimmed runtime configuration values', () => {
  const env = readRuntimeEnv({
    DISCORD_TOKEN: ' token ',
    MONGO_URI: ' mongodb://localhost/world-tree ',
    NODE_ENV: 'test'
  });

  assert.deepEqual(env, {
    discordToken: 'token',
    mongoUri: 'mongodb://localhost/world-tree',
    clientId: null,
    devGuildId: null,
    guildId: null,
    botOwnerId: null,
    dashboardUrl: null,
    dashboardOrigin: null,
    apiOrigin: null,
    discordClientSecret: null,
    sessionSecret: null,
    trustedAdminRoleIds: [],
    enableApi: false,
    useLocalYoutubeExtractor: false,
    apiPort: 3000,
    rateLimit: {
      globalMax: 120,
      authMax: 20,
      timeWindow: '1 minute'
    },
    nodeEnv: 'test',
    isProduction: false,
    mongoServerSelectionTimeoutMs: 10000
  });
});

test('readRuntimeEnv does not require command registration-only values', () => {
  const env = readRuntimeEnv({
    DISCORD_TOKEN: 'token',
    MONGO_URI: 'mongodb://localhost/world-tree'
  });

  assert.equal(env.clientId, null);
  assert.equal(env.devGuildId, null);
  assert.equal(env.guildId, null);
});

test('readCommandRegistrationEnv accepts DEV_GUILD_ID', () => {
  const env = readCommandRegistrationEnv({
    DISCORD_TOKEN: 'token',
    CLIENT_ID: 'client-id',
    DEV_GUILD_ID: 'dev-guild-id'
  });

  assert.equal(env.discordToken, 'token');
  assert.equal(env.clientId, 'client-id');
  assert.equal(env.devGuildId, 'dev-guild-id');
  assert.equal(env.guildId, null);
  assert.equal(env.mongoUri, null);
});

test('readCommandRegistrationEnv falls back to GUILD_ID for backward compatibility', () => {
  const env = readCommandRegistrationEnv({
    DISCORD_TOKEN: 'token',
    CLIENT_ID: 'client-id',
    GUILD_ID: 'guild-id'
  });

  assert.equal(env.discordToken, 'token');
  assert.equal(env.clientId, 'client-id');
  assert.equal(env.devGuildId, 'guild-id');
  assert.equal(env.guildId, 'guild-id');
  assert.equal(env.mongoUri, null);
});

test('readCommandRegistrationEnv prefers DEV_GUILD_ID over GUILD_ID', () => {
  const env = readCommandRegistrationEnv({
    DISCORD_TOKEN: 'token',
    CLIENT_ID: 'client-id',
    DEV_GUILD_ID: 'dev-guild-id',
    GUILD_ID: 'guild-id'
  });

  assert.equal(env.devGuildId, 'dev-guild-id');
  assert.equal(env.guildId, 'guild-id');
});

test('readCommandRegistrationEnv does not require guild ID in production', () => {
  const env = readCommandRegistrationEnv({
    DISCORD_TOKEN: 'token',
    CLIENT_ID: 'client-id',
    NODE_ENV: 'production'
  });

  assert.equal(env.discordToken, 'token');
  assert.equal(env.clientId, 'client-id');
  assert.equal(env.isProduction, true);
  assert.equal(env.devGuildId, null);
});

test('readRuntimeEnv reports runtime-specific missing environment variables', () => {
  assert.throws(
    () => readRuntimeEnv({ DISCORD_TOKEN: '', NODE_ENV: 'development' }),
    /Missing required environment variables: DISCORD_TOKEN, MONGO_URI/
  );
});

test('readCommandRegistrationEnv reports registration-specific missing environment variables', () => {
  assert.throws(
    () => readCommandRegistrationEnv({ DISCORD_TOKEN: 'token' }),
    /Missing required environment variables: CLIENT_ID/
  );
});

test('readCommandRegistrationEnv requires DEV_GUILD_ID in non-production', () => {
  assert.throws(
    () => readCommandRegistrationEnv({ DISCORD_TOKEN: 'token', CLIENT_ID: 'client-id' }),
    /Missing required environment variable: DEV_GUILD_ID/
  );
});

test('readRuntimeEnv rejects invalid MongoDB timeout values', () => {
  assert.throws(
    () =>
      readRuntimeEnv({
        DISCORD_TOKEN: 'token',
        MONGO_URI: 'mongodb://localhost/world-tree',
        MONGO_SERVER_SELECTION_TIMEOUT_MS: 'slow'
      }),
    /MONGO_SERVER_SELECTION_TIMEOUT_MS must be a positive integer/
  );
});

test('readRuntimeEnv requires dashboard auth secrets when API is enabled', () => {
  assert.throws(
    () =>
      readRuntimeEnv({
        DISCORD_TOKEN: 'token',
        MONGO_URI: 'mongodb://localhost/world-tree',
        ENABLE_API: 'true'
      }),
    /Missing required environment variables: CLIENT_ID, SESSION_SECRET, DISCORD_CLIENT_SECRET, DASHBOARD_ORIGIN, API_ORIGIN/
  );
});

test('readRuntimeEnv rejects short session secrets', () => {
  assert.throws(
    () =>
      readRuntimeEnv({
        DISCORD_TOKEN: 'token',
        MONGO_URI: 'mongodb://localhost/world-tree',
        ENABLE_API: 'true',
        CLIENT_ID: 'discord-client-id',
        SESSION_SECRET: 'short',
        DISCORD_CLIENT_SECRET: 'discord-secret',
        DASHBOARD_ORIGIN: 'http://localhost:5173',
        API_ORIGIN: 'http://localhost:3000'
      }),
    /SESSION_SECRET must be at least 32 characters/
  );
});

test('readRuntimeEnv returns trimmed dashboard auth configuration', () => {
  const env = readRuntimeEnv({
    DISCORD_TOKEN: 'token',
    MONGO_URI: 'mongodb://localhost/world-tree',
    ENABLE_API: 'true',
    CLIENT_ID: ' discord-client-id ',
    SESSION_SECRET: ' 12345678901234567890123456789012 ',
    DISCORD_CLIENT_SECRET: ' discord-secret ',
    DASHBOARD_ORIGIN: ' http://localhost:5173/ ',
    API_ORIGIN: ' http://localhost:3000/ '
  });

  assert.equal(env.clientId, 'discord-client-id');
  assert.equal(env.sessionSecret, '12345678901234567890123456789012');
  assert.equal(env.discordClientSecret, 'discord-secret');
  assert.equal(env.dashboardOrigin, 'http://localhost:5173');
  assert.equal(env.apiOrigin, 'http://localhost:3000');
});

test('readRuntimeEnv reads API rate limit configuration', () => {
  const env = readRuntimeEnv({
    DISCORD_TOKEN: 'token',
    MONGO_URI: 'mongodb://localhost/world-tree',
    API_RATE_LIMIT_MAX: ' 240 ',
    AUTH_RATE_LIMIT_MAX: ' 30 ',
    RATE_LIMIT_WINDOW: ' 2 minutes '
  });

  assert.deepEqual(env.rateLimit, {
    globalMax: 240,
    authMax: 30,
    timeWindow: '2 minutes'
  });
});

test('readRuntimeEnv enables the local YouTube extractor only for the literal true flag', () => {
  const baseEnv = {
    DISCORD_TOKEN: 'token',
    MONGO_URI: 'mongodb://localhost/world-tree'
  };

  assert.equal(readRuntimeEnv({ ...baseEnv, USE_LOCAL_YOUTUBE_EXTRACTOR: 'true' }).useLocalYoutubeExtractor, true);
  assert.equal(readRuntimeEnv({ ...baseEnv, USE_LOCAL_YOUTUBE_EXTRACTOR: 'TRUE' }).useLocalYoutubeExtractor, false);
  assert.equal(readRuntimeEnv(baseEnv).useLocalYoutubeExtractor, false);
});

test('readRuntimeEnv rejects invalid rate limit values', () => {
  assert.throws(
    () =>
      readRuntimeEnv({
        DISCORD_TOKEN: 'token',
        MONGO_URI: 'mongodb://localhost/world-tree',
        API_RATE_LIMIT_MAX: '0'
      }),
    /API_RATE_LIMIT_MAX must be a positive integer/
  );
});
