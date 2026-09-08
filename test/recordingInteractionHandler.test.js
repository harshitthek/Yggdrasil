import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle, prefix } from '../src/interactions/recordingInteractionHandler.js';
import { recordingService } from '../src/services/recordingService.js';

test('recordingInteractionHandler prefix is rec_stop_', () => {
  assert.equal(prefix, 'rec_stop_');
});

test('recordingInteractionHandler ignores non-button interactions', async () => {
  const handled = await handle({
    isButton: () => false,
    customId: 'rec_stop_12345'
  });

  assert.equal(handled, false);
});

test('recordingInteractionHandler ignores buttons without rec_stop_ prefix', async () => {
  const handled = await handle({
    isButton: () => true,
    customId: 'music_pause'
  });

  assert.equal(handled, false);
});

test('recordingInteractionHandler replies with error when recording is already finished', async () => {
  let replyPayload = null;
  const handled = await handle({
    isButton: () => true,
    customId: 'rec_stop_guild_finished',
    reply: async (payload) => {
      replyPayload = payload;
    }
  });

  assert.equal(handled, true);
  assert.equal(replyPayload.ephemeral, true);
  assert.equal(replyPayload.embeds[0].data.title, '❌ Recording Finished');
});

test('recordingInteractionHandler stops active recording and follows up with success', async () => {
  const guildId = 'guild_active_btn';
  recordingService.activeRecordings.set(guildId, { guildId });

  const origStop = recordingService.stopRecording;
  recordingService.stopRecording = async () => ({
    durationSeconds: 180,
    fileSizeMb: '3.12'
  });

  try {
    let replyPayload = null;
    let followUpPayload = null;

    const handled = await handle({
      isButton: () => true,
      customId: `rec_stop_${guildId}`,
      reply: async (payload) => {
        replyPayload = payload;
      },
      followUp: async (payload) => {
        followUpPayload = payload;
      }
    });

    assert.equal(handled, true);
    assert.match(replyPayload.content, /Stopping and finalizing audio recording/);
    assert.equal(followUpPayload.ephemeral, true);
    assert.equal(followUpPayload.embeds[0].data.title, '✅ Recording Saved');
    assert.match(followUpPayload.embeds[0].data.description, /3\.0 minutes/);
  } finally {
    recordingService.stopRecording = origStop;
    recordingService.activeRecordings.delete(guildId);
  }
});

test('recordingInteractionHandler catches stop error and follows up with error embed', async () => {
  const guildId = 'guild_err_btn';
  recordingService.activeRecordings.set(guildId, { guildId });

  const origStop = recordingService.stopRecording;
  recordingService.stopRecording = async () => {
    throw new Error('Encoder crashed');
  };

  try {
    let followUpPayload = null;

    const handled = await handle({
      isButton: () => true,
      customId: `rec_stop_${guildId}`,
      reply: async () => {},
      followUp: async (payload) => {
        followUpPayload = payload;
      }
    });

    assert.equal(handled, true);
    assert.equal(followUpPayload.ephemeral, true);
    assert.equal(followUpPayload.embeds[0].data.title, '❌ Recording Stop Error');
    assert.match(followUpPayload.embeds[0].data.description, /Encoder crashed/);
  } finally {
    recordingService.stopRecording = origStop;
    recordingService.activeRecordings.delete(guildId);
  }
});
