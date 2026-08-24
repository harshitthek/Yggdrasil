import { AudioEngineType, AudioEngineStatus } from './engineTypes.js';
import { isRustEngineAvailable } from './rustAudioEngine.js';

// Guild-specific engine overrides
const guildEngineOverrides = new Map();

/**
 * Resolves the active audio engine for a given guild.
 *
 * @param {string} guildId
 * @param {object} [options]
 * @returns {object} { engineType, isAccelerated, status }
 */
export function resolveAudioEngine(guildId = null, options = {}) {
  const configuredPreference =
    options.preference || guildEngineOverrides.get(guildId) || process.env.AUDIO_ENGINE || AudioEngineType.AUTO;

  const rustAvailable = isRustEngineAvailable();

  if (configuredPreference === AudioEngineType.RUST) {
    if (rustAvailable) {
      return {
        engineType: AudioEngineType.RUST,
        isAccelerated: true,
        status: AudioEngineStatus.ACTIVE,
        label: 'Rust SIMD Engine (Native NAPI-RS)'
      };
    } else {
      return {
        engineType: AudioEngineType.JS,
        isAccelerated: false,
        status: AudioEngineStatus.FALLBACK,
        label: 'JavaScript Baseline (Rust Binary Unavailable - Safe Fallback)'
      };
    }
  }

  if (configuredPreference === AudioEngineType.AUTO) {
    if (rustAvailable) {
      return {
        engineType: AudioEngineType.RUST,
        isAccelerated: true,
        status: AudioEngineStatus.ACTIVE,
        label: 'Rust SIMD Engine (Auto-Selected)'
      };
    }
  }

  return {
    engineType: AudioEngineType.JS,
    isAccelerated: false,
    status: AudioEngineStatus.ACTIVE,
    label: 'JavaScript Engine (Standard / FFmpeg)'
  };
}

/**
 * Sets a runtime guild engine override.
 *
 * @param {string} guildId
 * @param {string} engineType 'js' | 'rust' | 'auto'
 */
export function setGuildEngineOverride(guildId, engineType) {
  if (engineType === AudioEngineType.AUTO) {
    guildEngineOverrides.delete(guildId);
  } else {
    guildEngineOverrides.set(guildId, engineType);
  }
}

/**
 * Retrieves full diagnostics and health across both channels.
 */
export function getAudioEngineDiagnostics(guildId = null) {
  const active = resolveAudioEngine(guildId);
  const rustAvailable = isRustEngineAvailable();

  return {
    activeEngine: active.engineType,
    label: active.label,
    isAccelerated: active.isAccelerated,
    status: active.status,
    channelA: {
      name: 'JavaScript Engine',
      available: true,
      backend: 'discord-player / @discord-voip / ffmpeg'
    },
    channelB: {
      name: 'Rust SIMD Engine',
      available: rustAvailable,
      backend: 'NAPI-RS / Symphonia / Rubato / audiopus'
    }
  };
}
