import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { Collection, MessageFlags } from 'discord.js';

import { handleChatInputCommand, handleComponentInteraction } from '../src/middleware/commandRouter.js';
import { getRegisteredPrefixes, _resetRegistryForTesting } from '../src/interactions/registry.js';
import { registerAllInteractionHandlers } from '../src/interactions/registerAllHandlers.js';
import { createPlayerService } from '../src/services/playerService.js';

function createInteraction({ commandName = 'missing', command } = {}) {
  const calls = [];
  const commands = new Collection();

  if (command) {
    commands.set(commandName, command);
  }

  return {
    interaction: {
      commandName,
      appContext: { commands },
      client: {},
      replied: false,
      deferred: false,
      reply: async (payload) => calls.push(['reply', payload]),
      followUp: async (payload) => calls.push(['followUp', payload]),
      editReply: async (payload) => calls.push(['editReply', payload])
    },
    calls
  };
}

function createComponentInteraction({
  customId = 'ping_refresh',
  isButton = true,
  isStringSelectMenu = false,
  appContext = {}
} = {}) {
  const calls = [];

  const interaction = {
    customId,
    isButton: () => isButton,
    isStringSelectMenu: () => isStringSelectMenu,
    user: { id: 'user-1' },
    guild: { id: 'guild-1', ownerId: 'owner-1' },
    member: { voice: { channel: null } },
    channel: { id: 'channel-1', send: async () => {} },
    client: {
      user: { id: 'bot-1', tag: 'bot-1#0001', username: 'bot-1', displayName: 'bot-1', displayAvatarURL: () => null }
    },
    replied: false,
    deferred: false,
    appContext: { playerService: createPlayerService(), ...appContext },
    reply: async (payload) => {
      calls.push(['reply', payload]);
    },
    followUp: async (payload) => {
      calls.push(['followUp', payload]);
    },
    editReply: async (payload) => {
      calls.push(['editReply', payload]);
    },
    update: async (payload) => {
      calls.push(['update', payload]);
    },
    deferReply: async () => {
      calls.push(['deferReply']);
    }
  };

  return { interaction, calls };
}

beforeEach(() => {
  _resetRegistryForTesting();
});

test('handleChatInputCommand executes a known command', async () => {
  let executed = false;
  const { interaction, calls } = createInteraction({
    commandName: 'ping',
    command: {
      execute: async () => {
        executed = true;
      }
    }
  });

  await handleChatInputCommand(interaction);

  assert.equal(executed, true);
  assert.deepEqual(calls, []);
});

test('handleChatInputCommand answers unknown commands ephemerally', async () => {
  const { interaction, calls } = createInteraction({ commandName: 'missing' });
  const warnings = [];

  await handleChatInputCommand(interaction, {
    log: {
      warn: (message) => warnings.push(message)
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'reply');
  assert.equal(calls[0][1].flags, MessageFlags.Ephemeral);
  assert.match(calls[0][1].embeds[0].data.description, /not available/i);
  assert.deepEqual(warnings, ['No command handler found for /missing.']);
});

test('registry contains all prefixes after registerAllInteractionHandlers', () => {
  registerAllInteractionHandlers();
  assert.deepEqual(getRegisteredPrefixes(), [
    'ping_',
    'queue_',
    'settings_',
    'music_settings',
    'music_',
    'filter_',
    'search_select_',
    'help:',
    'rec_stop_'
  ]);
});

test('handleComponentInteraction returns early for non-component interactions', async () => {
  const { interaction, calls } = createComponentInteraction({
    customId: 'ping_refresh',
    isButton: false,
    isStringSelectMenu: false
  });

  await handleComponentInteraction(interaction);

  assert.deepEqual(calls, []);
});

test('handleComponentInteraction dispatches to each registered handler prefix', async () => {
  registerAllInteractionHandlers();

  const cases = [
    { prefix: 'ping_', customId: 'ping_refresh', isButton: true, isStringSelectMenu: false },
    { prefix: 'queue_', customId: 'queue_clear', isButton: true, isStringSelectMenu: false },
    { prefix: 'music_settings', customId: 'music_settings_open', isButton: true, isStringSelectMenu: false },
    { prefix: 'music_', customId: 'music_pause', isButton: true, isStringSelectMenu: false },
    { prefix: 'filter_', customId: 'filter_bassboost', isButton: true, isStringSelectMenu: false },
    { prefix: 'search_select_', customId: 'search_select_user-1', isButton: false, isStringSelectMenu: true },
    { prefix: 'help:', customId: 'help:category:user-1', isButton: false, isStringSelectMenu: true }
  ];

  for (const { prefix, customId, isButton, isStringSelectMenu } of cases) {
    const { interaction, calls } = createComponentInteraction({
      customId,
      isButton,
      isStringSelectMenu
    });

    await handleComponentInteraction(interaction);

    assert.ok(
      calls.length >= 1,
      `expected handler for prefix "${prefix}" to record at least one call (got ${calls.length})`
    );
  }
});

test('handleComponentInteraction catches handler errors and replies with an error embed', async () => {
  const { registerHandler } = await import('../src/interactions/registry.js');
  registerHandler({
    prefix: 'boom_',
    handle: async () => {
      throw new Error('boom went wrong');
    }
  });

  const { interaction, calls } = createComponentInteraction({
    customId: 'boom_press',
    isButton: true,
    isStringSelectMenu: false
  });

  await handleComponentInteraction(interaction);

  assert.ok(calls.length >= 1, 'expected handleComponentInteraction to reply after an error');
  assert.equal(calls[0][0], 'reply');
  const description = calls[0][1].embeds[0].data.description;
  assert.match(description, /went wrong/i);
});

test('handleComponentInteraction rejects music controls from another voice channel', async () => {
  let replyPayload;

  await handleComponentInteraction({
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId: 'music_skip',
    guildId: 'guild-1',
    member: { voice: { channel: { id: 'voice-2' } } },
    appContext: {
      playerService: {
        getGuildQueue: () => ({ channel: { id: 'voice-1' } })
      }
    },
    reply: async (payload) => {
      replyPayload = payload;
    }
  });

  assert.match(replyPayload.embeds[0].data.title, /Wrong Voice Channel/);
});
