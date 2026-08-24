import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveAudioEngine,
  setGuildEngineOverride,
  getAudioEngineDiagnostics
} from '../src/services/music/engine/audioEngineRouter.js';
import { isRustEngineAvailable, RustAudioSession } from '../src/services/music/engine/rustAudioEngine.js';
import { JsAudioEngine } from '../src/services/music/engine/jsAudioEngine.js';
import { AudioEngineType, AudioEngineStatus } from '../src/services/music/engine/engineTypes.js';
import { execute as executeEngineSlash, executeMessage as executeEngineMessage } from '../src/commands/music/engine.js';

// ─── Router & Diagnostics Tests ─────────────────────────────────────────────

test('isRustEngineAvailable returns boolean without throwing on uncompiled binary', () => {
  const available = isRustEngineAvailable();
  assert.equal(typeof available, 'boolean');
});

test('resolveAudioEngine resolves JS fallback when Rust is unavailable', () => {
  const resolved = resolveAudioEngine('guild-test-1', { preference: AudioEngineType.RUST });
  if (!isRustEngineAvailable()) {
    assert.equal(resolved.engineType, AudioEngineType.JS);
    assert.equal(resolved.status, AudioEngineStatus.FALLBACK);
    assert.equal(resolved.isAccelerated, false);
    assert.match(resolved.label, /Fallback/);
  }
});

test('resolveAudioEngine resolves standard JS when configured to JS', () => {
  const resolved = resolveAudioEngine('guild-test-2', { preference: AudioEngineType.JS });
  assert.equal(resolved.engineType, AudioEngineType.JS);
  assert.equal(resolved.isAccelerated, false);
  assert.equal(resolved.status, AudioEngineStatus.ACTIVE);
});

test('resolveAudioEngine handles case-insensitive preferences', () => {
  const resolved = resolveAudioEngine('guild-case-1', { preference: 'JS' });
  assert.equal(resolved.engineType, AudioEngineType.JS);
});

test('getAudioEngineDiagnostics reports channel status for both channels', () => {
  const diag = getAudioEngineDiagnostics('guild-test-3');
  assert.ok(diag.activeEngine);
  assert.ok(diag.label);
  assert.equal(diag.channelA.available, true);
  assert.match(diag.channelA.backend, /discord-player/);
  assert.equal(typeof diag.channelB.available, 'boolean');
  assert.match(diag.channelB.backend, /NAPI-RS/);
});

test('setGuildEngineOverride updates per-guild engine configuration and resets on AUTO', () => {
  setGuildEngineOverride('guild-override-1', AudioEngineType.JS);
  const resolved = resolveAudioEngine('guild-override-1');
  assert.equal(resolved.engineType, AudioEngineType.JS);

  setGuildEngineOverride('guild-override-1', AudioEngineType.AUTO);
  const resetResolved = resolveAudioEngine('guild-override-1');
  assert.ok(resetResolved.engineType);
});

// ─── JsAudioEngine Wrapper Tests ────────────────────────────────────────────

test('JsAudioEngine returns active availability and correct description', () => {
  const jsEngine = new JsAudioEngine({});
  assert.equal(jsEngine.isAvailable(), true);
  assert.match(jsEngine.getEngineName(), /discord-player/);
});

// ─── RustAudioSession Mock & Backpressure Tests ─────────────────────────────

test('RustAudioSession handles backpressure pausing and resuming stream correctly', () => {
  let paused = false;
  const mockStream = {
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    isPaused: () => paused
  };

  const mockBinding = {
    create_session: () => 42,
    push_chunk: (_sessionId, _chunk) => ({
      session_id: 42,
      queued_frames: 260,
      should_pause: true,
      should_resume: false
    }),
    pop_opus_frame: (_sessionId) => Buffer.from([0xf8, 0xff]),
    set_volume: () => {},
    set_filter: () => {},
    destroy_session: () => {}
  };

  // Instantiate session using manual injection for isolated unit testing
  const session = Object.create(RustAudioSession.prototype);
  session.binding = mockBinding;
  session.sessionId = 42;
  session.destroyed = false;

  // Push chunk that triggers high watermark (should pause stream)
  const status1 = session.pushChunk(new Uint8Array([1, 2, 3]), mockStream);
  assert.equal(status1.should_pause, true);
  assert.equal(mockStream.isPaused(), true);

  // Update mock binding to signal low watermark
  mockBinding.push_chunk = () => ({
    session_id: 42,
    queued_frames: 80,
    should_pause: false,
    should_resume: true
  });

  const status2 = session.pushChunk(new Uint8Array([4, 5, 6]), mockStream);
  assert.equal(status2.should_resume, true);
  assert.equal(mockStream.isPaused(), false);

  // Verify frame retrieval
  const frame = session.popOpusFrame();
  assert.ok(Buffer.isBuffer(frame));
  assert.equal(frame.length, 2);

  // Verify destruction cleans up and makes subsequent calls safe no-ops
  session.destroy();
  assert.equal(session.destroyed, true);
  assert.equal(session.pushChunk(new Uint8Array([1])), null);
  assert.equal(session.popOpusFrame(), null);
});

// ─── Engine Command Slash & Message Tests ───────────────────────────────────

test('engine message command displays dual-channel status embed', async () => {
  let response;
  await executeEngineMessage({
    args: ['status'],
    guild: { id: 'guild-status-1' },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.ok(response.embeds);
  assert.match(response.embeds[0].data.title, /Dual-Channel Audio Engine Status/);
  assert.ok(response.embeds[0].data.fields.length >= 3);
});

test('engine message command allows switching engine preference with permissions', async () => {
  let response;
  await executeEngineMessage({
    args: ['switch', 'js'],
    guild: { id: 'guild-switch-1' },
    member: { permissions: { has: () => true } },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.match(response.embeds[0].data.title, /Audio Engine Updated/);
});

test('engine message command rejects invalid engine option', async () => {
  let response;
  await executeEngineMessage({
    args: ['switch', 'invalid_engine'],
    guild: { id: 'guild-switch-2' },
    member: { permissions: { has: () => true } },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.match(response.embeds[0].data.title, /Invalid Engine/);
});

test('engine message command rejects switch if user lacks ManageGuild permission', async () => {
  let response;
  await executeEngineMessage({
    args: ['switch', 'js'],
    guild: { id: 'guild-switch-3' },
    member: { permissions: { has: () => false } },
    respond: async (payload) => {
      response = payload;
    }
  });

  assert.match(response.embeds[0].data.title, /Permission Denied/);
});

test('engine slash command executes status subcommand', async () => {
  let replied = null;
  const interaction = {
    options: {
      getSubcommand: () => 'status'
    },
    guild: { id: 'guild-slash-1' },
    reply: async (payload) => {
      replied = payload;
    }
  };

  await executeEngineSlash(interaction);
  assert.ok(replied.embeds);
  assert.match(replied.embeds[0].data.title, /Dual-Channel Audio Engine Status/);
});

test('engine slash command executes switch subcommand', async () => {
  let replied = null;
  const interaction = {
    options: {
      getSubcommand: () => 'switch',
      getString: () => 'js'
    },
    guild: { id: 'guild-slash-2' },
    member: { permissions: { has: () => true } },
    reply: async (payload) => {
      replied = payload;
    }
  };

  await executeEngineSlash(interaction);
  assert.ok(replied.embeds);
  assert.match(replied.embeds[0].data.title, /Audio Engine Updated/);
});
