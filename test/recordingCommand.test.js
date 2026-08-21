import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeRecord } from '../src/commands/utility/record.js';
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
