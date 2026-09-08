import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { recordingService, getFfmpegPath } from '../src/services/recordingService.js';

test('getFfmpegPath returns a valid string', () => {
  const path = getFfmpegPath();
  assert.equal(typeof path, 'string');
  assert.ok(path.length > 0);
});

test('recordingService returns null/false for unknown guild', () => {
  assert.equal(recordingService.isRecording('unknown-guild-id'), false);
  assert.equal(recordingService.getRecording('unknown-guild-id'), null);
});

test('recordingService startRecording throws if already recording in guild', async () => {
  const guildId = 'guild-dup-test';
  recordingService.activeRecordings.set(guildId, { guildId });

  try {
    await assert.rejects(
      async () => {
        await recordingService.startRecording({
          guild: { id: guildId, name: 'Test' },
          voiceChannel: { id: 'vc-1', name: 'Voice' },
          owner: { id: 'owner-1' },
          textChannel: { id: 'tc-1' }
        });
      },
      { message: 'A voice recording is already active in this server.' }
    );
  } finally {
    recordingService.activeRecordings.delete(guildId);
  }
});

test('recordingService startRecording throws if no connection/receiver can be created', async () => {
  const guildId = 'guild-no-conn';
  await assert.rejects(
    async () => {
      await recordingService.startRecording({
        guild: { id: guildId, name: 'Test' },
        voiceChannel: null,
        owner: { id: 'owner-1' },
        textChannel: { id: 'tc-1' },
        voiceConnection: null
      });
    },
    { message: 'The bot is not connected to a voice channel in this server.' }
  );
});

test('recordingService stopRecording throws if no active session', async () => {
  await assert.rejects(
    async () => {
      await recordingService.stopRecording('non-existent-guild');
    },
    { message: 'No active recording found for this server.' }
  );
});

test('recordingService stopRecording returns existing session if isStopping is true', async () => {
  const guildId = 'guild-already-stopping';
  const mockSession = { guildId, isStopping: true };
  recordingService.activeRecordings.set(guildId, mockSession);

  try {
    const result = await recordingService.stopRecording(guildId);
    assert.equal(result, mockSession);
  } finally {
    recordingService.activeRecordings.delete(guildId);
  }
});

test('recordingService stopRecording throws friendly error when 0 bytes were detected', async () => {
  const guildId = 'guild-zero-bytes';
  const testPcmPath = `./storage/recordings/test_empty_${Date.now()}.pcm`;
  writeFileSync(testPcmPath, Buffer.alloc(0));

  const mockSession = {
    guildId,
    guildName: 'Test Guild',
    voiceChannelId: 'vc-1',
    voiceChannelName: 'Voice',
    ownerId: 'owner-1',
    owner: { client: { guilds: { cache: new Map() } } },
    startTime: Date.now() - 5000,
    pcmPath: testPcmPath,
    mp3Path: `./storage/recordings/test_empty_${Date.now()}.mp3`,
    pcmStream: { end: (cb) => cb() },
    receiver: { speaking: { off: () => {} } },
    speakingSubscriptions: new Map(),
    bytesWritten: 0,
    isStopping: false
  };

  recordingService.activeRecordings.set(guildId, mockSession);

  try {
    await assert.rejects(
      async () => {
        await recordingService.stopRecording(guildId);
      },
      { message: /No audio was detected during the recording session/ }
    );
  } finally {
    recordingService.activeRecordings.delete(guildId);
    if (existsSync(testPcmPath)) unlinkSync(testPcmPath);
  }
});
