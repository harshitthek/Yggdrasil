import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute, executeRecord, isOwner, botOwnerOnly } from '../src/commands/utility/record.js';
import { recordingService } from '../src/services/recordingService.js';

test('record command rejects non-owner users', async () => {
  let response = null;
  await executeRecord({
    action: 'start',
    user: { id: 'random-user' },
    appContext: { config: { botOwnerId: 'owner-123' } },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.equal(response.ephemeral, true);
  assert.equal(response.embeds[0].data.title, '❌ Owner Restricted');
});

test('record command stop returns error when no recording is active', async () => {
  let response = null;
  await executeRecord({
    action: 'stop',
    user: { id: 'owner-123' },
    textChannel: { guild: { id: 'guild-empty', name: 'Test Guild' } },
    appContext: { config: { botOwnerId: 'owner-123' } },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.equal(response.embeds[0].data.title, '❌ No Active Recording');
});

test('record command status shows inactive when not recording', async () => {
  let response = null;
  await executeRecord({
    action: 'status',
    user: { id: 'owner-123' },
    textChannel: { guild: { id: 'guild-status', name: 'Test Guild' } },
    appContext: { config: { botOwnerId: 'owner-123' } },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.equal(response.embeds[0].data.title, '🎙️ Recording Inactive');
});

test('recordingService tracks recording state by guild', () => {
  assert.equal(recordingService.isRecording('guild-nonexistent'), false);
  assert.equal(recordingService.getRecording('guild-nonexistent'), null);
});

test('record command allows owner via client application fallback', async () => {
  let response = null;
  await executeRecord({
    action: 'status',
    user: { id: 'app-owner-456' },
    textChannel: { guild: { id: 'guild-status', name: 'Test Guild' } },
    appContext: {
      config: { botOwnerId: null },
      client: { application: { owner: { id: 'app-owner-456' } } }
    },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.equal(response.embeds[0].data.title, '🎙️ Recording Inactive');
});

test('record command start requires voice channel', async () => {
  let response = null;
  await executeRecord({
    action: 'start',
    user: { id: 'owner-123' },
    voiceChannel: null,
    textChannel: { guild: { id: 'guild-test', name: 'Test Guild' } },
    appContext: { config: { botOwnerId: 'owner-123' } },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.equal(response.embeds[0].data.title, '❌ Voice Channel Required');
});

test('record command start rejects invalid duration', async () => {
  let response = null;
  await executeRecord({
    action: 'start',
    durationStr: '999d',
    user: { id: 'owner-123' },
    voiceChannel: { id: 'vc-1', name: 'Voice Channel', guild: { id: 'guild-test', name: 'Test Guild' } },
    appContext: { config: { botOwnerId: 'owner-123' } },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.equal(response.embeds[0].data.title, '❌ Invalid Duration');
});

test('record command rejects execution outside of a guild', async () => {
  let response = null;
  await executeRecord({
    action: 'start',
    user: { id: 'owner-123' },
    voiceChannel: null,
    textChannel: null,
    appContext: { config: { botOwnerId: 'owner-123' } },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.equal(response.ephemeral, true);
  assert.equal(response.embeds[0].data.title, '❌ Guild Required');
});

test('record command start rejects if recording is already active', async () => {
  const guildId = 'guild-already-active';
  recordingService.activeRecordings.set(guildId, {
    guildId,
    guildName: 'Test Guild',
    voiceChannelName: 'voice-1',
    startTime: Date.now(),
    durationMs: 3600000
  });

  try {
    let response = null;
    await executeRecord({
      action: 'start',
      user: { id: 'owner-123' },
      voiceChannel: { id: 'vc-1', name: 'voice-1', guild: { id: guildId, name: 'Test Guild' } },
      appContext: { config: { botOwnerId: 'owner-123' } },
      respond: async (payload) => {
        response = payload;
      }
    });

    assert.equal(response.embeds[0].data.title, '❌ Already Recording');
  } finally {
    recordingService.activeRecordings.delete(guildId);
  }
});

test('record command status returns active details when recording is running', async () => {
  const guildId = 'guild-status-active';
  recordingService.activeRecordings.set(guildId, {
    guildId,
    guildName: 'Test Guild',
    voiceChannelName: 'general-voice',
    startTime: Date.now() - 65000,
    durationMs: 3600000
  });

  try {
    let response = null;
    await executeRecord({
      action: 'status',
      user: { id: 'owner-123' },
      textChannel: { guild: { id: guildId, name: 'Test Guild' } },
      appContext: { config: { botOwnerId: 'owner-123' } },
      respond: async (payload) => {
        response = payload;
      }
    });

    assert.equal(response.embeds[0].data.title, '🎙️ Active Voice Recording');
    assert.match(response.embeds[0].data.description, /general-voice/);
    assert.match(response.embeds[0].data.description, /Elapsed:/);
  } finally {
    recordingService.activeRecordings.delete(guildId);
  }
});

test('record command stop reports success when stopRecording succeeds', async () => {
  const guildId = 'guild-stop-ok';
  recordingService.activeRecordings.set(guildId, {
    guildId,
    isStopping: false
  });

  const origStop = recordingService.stopRecording;
  recordingService.stopRecording = async () => ({
    durationSeconds: 150,
    fileSizeMb: '2.45'
  });

  try {
    const responses = [];
    await executeRecord({
      action: 'stop',
      user: { id: 'owner-123' },
      textChannel: { guild: { id: guildId, name: 'Test Guild' } },
      appContext: { config: { botOwnerId: 'owner-123' } },
      respond: async (payload) => {
        responses.push(payload);
      }
    });

    assert.equal(responses.length, 2);
    assert.equal(responses[0].embeds[0].data.title, '⏳ Processing Audio...');
    assert.equal(responses[1].embeds[0].data.title, '✅ Recording Saved & Delivered');
    assert.match(responses[1].embeds[0].data.description, /2\.5 minutes/);
    assert.match(responses[1].embeds[0].data.description, /2\.45 MB/);
  } finally {
    recordingService.stopRecording = origStop;
    recordingService.activeRecordings.delete(guildId);
  }
});

test('record command stop handles stopRecording failure gracefully', async () => {
  const guildId = 'guild-stop-err';
  recordingService.activeRecordings.set(guildId, { guildId });

  const origStop = recordingService.stopRecording;
  recordingService.stopRecording = async () => {
    throw new Error('FFmpeg encoding failed');
  };

  try {
    const responses = [];
    await executeRecord({
      action: 'stop',
      user: { id: 'owner-123' },
      textChannel: { guild: { id: guildId, name: 'Test Guild' } },
      appContext: { config: { botOwnerId: 'owner-123' } },
      respond: async (payload) => {
        responses.push(payload);
      }
    });

    assert.equal(responses.length, 2);
    assert.equal(responses[1].embeds[0].data.title, '❌ Recording Failed');
    assert.match(responses[1].embeds[0].data.description, /FFmpeg encoding failed/);
  } finally {
    recordingService.stopRecording = origStop;
    recordingService.activeRecordings.delete(guildId);
  }
});

test('record command exports botOwnerOnly flag', () => {
  assert.equal(botOwnerOnly, true);
});

test('isOwner recognizes Discord Team owner and team members', () => {
  const teamOwner = {
    id: 'team-123',
    ownerUserId: 'team-owner-user',
    members: new Map([
      ['team-owner-user', { id: 'team-owner-user' }],
      ['team-member-user', { id: 'team-member-user' }]
    ])
  };
  const client = { application: { owner: teamOwner } };

  assert.equal(isOwner('team-owner-user', {}, client), true);
  assert.equal(isOwner('team-member-user', {}, client), true);
  assert.equal(isOwner('stranger-user', {}, client), false);
});

test('record execute immediately defers interaction and delegates execution', async () => {
  const calls = [];
  const interaction = {
    deferred: false,
    replied: false,
    user: { id: 'owner-123' },
    member: { voice: { channel: null } },
    channel: { guild: { id: 'guild-exec', name: 'Test Guild' } },
    options: {
      getSubcommand: () => 'status',
      getString: () => null
    },
    appContext: { config: { botOwnerId: 'owner-123' } },
    deferReply: async (options) => {
      interaction.deferred = true;
      calls.push(['deferReply', options]);
    },
    editReply: async (payload) => {
      calls.push(['editReply', payload]);
    },
    reply: async (payload) => {
      calls.push(['reply', payload]);
    }
  };

  await execute(interaction);

  assert.equal(calls[0][0], 'deferReply');
  assert.equal(calls[1][0], 'editReply');
  assert.equal(calls[1][1].embeds[0].data.title, '🎙️ Recording Inactive');
});

test('record execute handles expired interaction (10062) gracefully', async () => {
  const interaction = {
    deferred: false,
    replied: false,
    user: { id: 'owner-123' },
    appContext: { config: { botOwnerId: 'owner-123' } },
    deferReply: async () => {
      const err = new Error('Unknown interaction');
      err.code = 10062;
      throw err;
    }
  };

  // Should not throw
  await assert.doesNotReject(async () => {
    await execute(interaction);
  });
});
