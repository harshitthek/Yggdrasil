import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { logger } from '../../../utils/logger.js';

const require = createRequire(import.meta.url);

let nativeBinding = null;
let nativeLoadAttempted = false;

/**
 * Three-Tier Native Binary Loader
 * Attempts:
 * 1. Local compiled .node in native/worldtree-audio/
 * 2. npm package / prebuilt binary
 * 3. Returns null (seamless fallback to JS engine)
 */
export function getNativeAudioBinding() {
  if (nativeLoadAttempted) {
    return nativeBinding;
  }

  nativeLoadAttempted = true;

  const candidatePaths = [
    resolve(process.cwd(), 'native/worldtree-audio/worldtree_audio.node'),
    resolve(process.cwd(), 'native/worldtree-audio/index.node'),
    resolve(process.cwd(), `native/worldtree-audio/worldtree_audio.${process.platform}-${process.arch}.node`)
  ];

  for (const path of candidatePaths) {
    try {
      nativeBinding = require(path);
      if (nativeBinding?.is_native_available?.()) {
        logger.info(`[RustAudioEngine] Successfully loaded native Rust audio engine from: ${path}`);
        return nativeBinding;
      }
    } catch {
      // Path did not exist or failed to load
    }
  }

  try {
    nativeBinding = require('@worldtree/audio-native');
    if (nativeBinding?.is_native_available?.()) {
      logger.info('[RustAudioEngine] Successfully loaded @worldtree/audio-native module');
      return nativeBinding;
    }
  } catch {
    // Module not installed
  }

  nativeBinding = null;
  return null;
}

export function isRustEngineAvailable() {
  const binding = getNativeAudioBinding();
  return Boolean(binding && typeof binding.create_session === 'function');
}

/**
 * Native Audio Engine Session Wrapper
 */
export class RustAudioSession {
  constructor(bitrateBps = 96000, options = {}) {
    const binding = getNativeAudioBinding();
    if (!binding) {
      throw new Error('Rust audio engine native addon is not available on this platform.');
    }

    this.binding = binding;
    this.sessionId = binding.create_session(bitrateBps);
    this.options = options;
    this.destroyed = false;
  }

  /**
   * Pushes an encoded chunk into the Rust native pipeline.
   * Handles stream backpressure via high/low watermarks.
   *
   * @param {Uint8Array|Buffer} chunk
   * @param {import('node:stream').Readable} [inputStream]
   * @returns {object} Backpressure status
   */
  pushChunk(chunk, inputStream = null) {
    if (this.destroyed) return null;
    const status = this.binding.push_chunk(this.sessionId, chunk);

    if (inputStream) {
      if (status.should_pause && !inputStream.isPaused()) {
        inputStream.pause();
      } else if (status.should_resume && inputStream.isPaused()) {
        inputStream.resume();
      }
    }

    return status;
  }

  /**
   * Retrieves a 20ms Opus frame for Discord RTP transmission.
   * @returns {Buffer|null}
   */
  popOpusFrame() {
    if (this.destroyed) return null;
    return this.binding.pop_opus_frame(this.sessionId);
  }

  setVolume(volume) {
    if (this.destroyed) return;
    this.binding.set_volume(this.sessionId, volume);
  }

  setFilter(filterName, enabled, value = null) {
    if (this.destroyed) return;
    this.binding.set_filter(this.sessionId, filterName, enabled, value);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.binding.destroy_session(this.sessionId);
    } catch {
      // Ignore cleanup error
    }
  }
}
