import assert from 'node:assert/strict';
import { test } from 'node:test';

import { execute, executeMessage, executePlay, formatMusicErrorMessage } from '../src/commands/music/play.js';
import { executeMessage as execute247 } from '../src/commands/music/247.js';

test('play executeMessage requires a query', async () => {
  const context = {
    args: [],
    member: { voice: { channel: { id: '123' } } },
    message: { channel: {} },
    respond: async (payload) => {
      assert.equal(payload.embeds[0].data.title, '❌ Missing Query');
    }
  };

  await executeMessage(context);
});

test('play executeMessage requires voice channel', async () => {
  const context = {
    args: ['my', 'song'],
    member: { voice: { channel: null } },
    message: { channel: {} },
    user: { id: '1', username: 'test' },
    respond: async (payload) => {
      assert.equal(payload.embeds[0].data.title, '❌ Voice Channel Required');
    }
  };

  await executeMessage(context);
});

test('play defers slash responses before searching external providers', async () => {
  let deferred = false;
  let response;

  await execute({
    options: { getString: () => 'song' },
    member: { voice: { channel: { guild: { id: 'guild-1' } } } },
    channel: {},
    user: { id: 'user-1' },
    appContext: {
      playerService: {
        getPlayer: () => ({
          search: async () => {
            assert.equal(deferred, true);
            return { hasTracks: () => false };
          }
        })
      }
    },
    deferReply: async () => {
      if (deferred) throw new Error('InteractionAlreadyReplied');
      deferred = true;
    },
    editReply: async (payload) => {
      response = payload;
    }
  });

  assert.equal(deferred, true);
  assert.match(response.embeds[0].data.title, /No Results Found/);
});

test('play rejects a different voice channel before searching', async () => {
  let response;

  await executePlay(
    'song',
    { id: 'voice-2', guild: { id: 'guild-1' } },
    { id: 'user-1' },
    {},
    {
      getPlayer: () => ({
        search: async () => {
          throw new Error('search should not run');
        }
      }),
      getGuildQueue: () => ({ channel: { id: 'voice-1' } })
    },
    async (payload) => {
      response = payload;
    }
  );

  assert.match(response.embeds[0].data.title, /Wrong Voice Channel/);
});

test('play enables DAVE encryption when connecting', async () => {
  let connectionOptions;
  const queue = {
    metadata: {},
    connection: null,
    node: { volume: 80, play: async () => {} },
    tracks: { data: [] },
    connect: async (_channel, options) => {
      connectionOptions = options;
      queue.connection = {};
    },
    addTrack: () => {},
    isPlaying: () => false
  };

  await executePlay(
    'song',
    { id: 'voice-1', guild: { id: 'guild-1' } },
    { id: 'user-1' },
    {},
    {
      getPlayer: () => ({
        search: async () => ({ hasTracks: () => true, tracks: [{ title: 'Song' }], playlist: null }),
        nodes: { create: () => queue }
      }),
      getGuildQueue: () => null
    },
    async () => {}
  );

  assert.deepEqual(connectionOptions, { daveEncryption: true });
});

test('execute247 requires a voice channel', async () => {
  const context = {
    args: [],
    member: { voice: { channel: null } },
    message: { channel: {} },
    respond: async (payload) => {
      assert.equal(payload.embeds[0].data.title, '❌ Voice Channel Required');
    }
  };

  await execute247(context);
});

test('execute247 enables 24/7 mode for a newly created queue', async () => {
  const queue = {
    metadata: { channel: {}, is247: false },
    options: {},
    connection: {},
    connect: async () => {
      throw new Error('should not reconnect');
    }
  };
  let payload;

  await execute247({
    member: { voice: { channel: { guild: { id: 'guild-1' } } } },
    message: { channel: {} },
    appContext: {
      playerService: {
        getPlayer: () => ({ nodes: { create: () => queue } }),
        getGuildQueue: () => null
      }
    },
    respond: async (response) => {
      payload = response;
    }
  });

  assert.equal(queue.metadata.is247, true);
  assert.equal(queue.options.leaveOnEmpty, false);
  assert.equal(queue.options.leaveOnEnd, false);
  assert.match(payload.embeds[0].data.title, /Enabled/);
});

test('formatMusicErrorMessage handles non-Error thrown values', () => {
  assert.equal(formatMusicErrorMessage('provider failed'), 'provider failed');
  assert.equal(formatMusicErrorMessage({ code: 'E_PROVIDER' }), 'Unknown error');
  assert.equal(formatMusicErrorMessage(new Error('stream failed')), 'stream failed');
  assert.equal(formatMusicErrorMessage('x'.repeat(200)).length, 150);
});

test('reconnect247Guilds reconnects to voice channels from database settings', async () => {
  const { reconnect247Guilds } = await import('../src/services/musicService.js');

  let connectedChannel = null;
  const mockQueue = {
    connection: null,
    connect: async (channel) => {
      connectedChannel = channel;
      mockQueue.connection = {};
    }
  };

  const mockGuild = {
    id: 'guild-1',
    name: 'Test Guild',
    channels: {
      cache: new Map([
        [
          'voice-123',
          {
            id: 'voice-123',
            name: 'General Voice',
            isVoiceBased: () => true
          }
        ]
      ])
    }
  };

  const mockClient = {
    guilds: {
      cache: new Map([['guild-1', mockGuild]])
    }
  };

  const mockAppContext = {
    settingsService: {
      getAll247Guilds: async () => [
        {
          guildId: 'guild-1',
          twentyFourSeven: {
            enabled: true,
            voiceChannelId: 'voice-123',
            textChannelId: 'text-123'
          }
        }
      ]
    },
    playerService: {
      getPlayer: () => ({
        nodes: {
          get: () => null,
          create: () => mockQueue
        }
      })
    }
  };

  await reconnect247Guilds(mockClient, mockAppContext);
  assert.equal(connectedChannel?.id, 'voice-123');
});

test('stop command does not delete queue and disables leaveOnEnd in 24/7 mode', async () => {
  const { executeMessage: executeStop } = await import('../src/commands/music/stop.js');
  let deleted = false;
  let stopped = false;
  const mockQueue = {
    metadata: { is247: true },
    options: { leaveOnEnd: true, leaveOnEmpty: true },
    tracks: { clear: () => {} },
    node: {
      stop: () => {
        stopped = true;
      }
    },
    delete: () => {
      deleted = true;
    }
  };

  let response;
  await executeStop({
    guild: { id: 'guild-1' },
    appContext: {
      playerService: {
        getGuildQueue: () => mockQueue
      }
    },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.equal(stopped, true);
  assert.equal(deleted, false);
  assert.equal(mockQueue.options.leaveOnEnd, false);
  assert.equal(mockQueue.options.leaveOnEmpty, false);
  assert.match(response.embeds[0].data.title, /Stopped/);
  assert.match(response.embeds[0].data.description, /24\/7 mode is active/);
});

test('leave command disconnects and disables 24/7 mode in database', async () => {
  const { executeMessage: executeLeave } = await import('../src/commands/music/leave.js');
  let updated247 = null;
  let deleted = false;
  const mockQueue = {
    metadata: { is247: true },
    delete: () => {
      deleted = true;
    }
  };

  let response;
  await executeLeave({
    guild: { id: 'guild-1', members: { me: { voice: { channelId: 'voice-123' } } } },
    member: { voice: { channel: { id: 'voice-123' } } },
    appContext: {
      playerService: {
        getGuildQueue: () => mockQueue
      },
      settingsService: {
        getSettings: async () => ({ twentyFourSeven: { enabled: true } }),
        set247: async (_guildId, options) => {
          updated247 = options;
        }
      }
    },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.equal(deleted, true);
  assert.equal(updated247?.enabled, false);
  assert.match(response.embeds[0].data.title, /Left Voice Channel/);
  assert.match(response.embeds[0].data.description, /disabled 24\/7 mode/);
});

test('start247Watchdog and stop247Watchdog manage timer cleanly', async () => {
  const { start247Watchdog, stop247Watchdog } = await import('../src/services/musicService.js');

  const timer = start247Watchdog({ isReady: () => false }, {}, 1000);
  assert.ok(timer);
  stop247Watchdog();
});
