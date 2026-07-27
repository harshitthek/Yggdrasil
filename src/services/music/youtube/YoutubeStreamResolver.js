import { YT_DEPENDENCY_MISSING, YT_EXTRACTOR_INACTIVE, YT_NO_STREAM, YT_STREAM_FAILED } from './youtubeErrors.js';

const STREAM_STRATEGIES = Object.freeze([
  { name: 'peer', method: 'resolvePeer' },
  { name: 'adaptive', method: 'resolveAdaptive' },
  { name: 'sabr', method: 'resolveSabr' },
  { name: 'yt-dlp', method: 'resolveYtDlp' }
]);

function createResolverError(code, message, cause) {
  const error = cause ? new Error(message, { cause }) : new Error(message);
  error.code = code;
  return error;
}

function isRecoverable(error) {
  return Boolean(error && typeof error === 'object' && error.recoverable === true);
}

function isStreamable(value) {
  if (typeof value === 'string') return value.length > 0;
  if (value && typeof value.pipe === 'function') return true;

  return Boolean(value?.stream && typeof value.stream.pipe === 'function');
}

function isYoutubeTrack(track) {
  return track?.source === 'youtube' || track?.raw?.source === 'youtube';
}

/**
 * Resolves streams through a local YouTube adapter.
 *
 * The adapter owns the configured YouTube mechanisms: custom streams, peers,
 * Innertube adaptive streams, and yt-dlp. SABR remains an optional adapter
 * slot for a future explicitly approved implementation. This resolver owns
 * only strategy sequencing and the stable failure boundary.
 */
export class YoutubeStreamResolver {
  /**
   * @param {{
   *   resolveCustomStream?: (track: import('discord-player').Track) => Promise<import('discord-player').ExtractorStreamable | null | undefined>,
   *   resolvePeer?: (track: import('discord-player').Track) => Promise<import('discord-player').ExtractorStreamable | null | undefined>,
   *   resolveAdaptive?: (track: import('discord-player').Track) => Promise<import('discord-player').ExtractorStreamable | null | undefined>,
   *   resolveSabr?: (track: import('discord-player').Track) => Promise<import('discord-player').ExtractorStreamable | null | undefined>,
   *   resolveYtDlp?: (track: import('discord-player').Track) => Promise<import('discord-player').ExtractorStreamable | null | undefined>,
   *   cleanup?: () => Promise<void> | void
   * }} adapter Local YouTube stream adapter.
   * @param {{ debug?: (message: string) => void }} [options] Sanitized diagnostic callback.
   */
  constructor(adapter, { debug } = {}) {
    this.adapter = adapter ?? null;
    this.debug = typeof debug === 'function' ? debug : null;
    this.cleanedUp = false;
  }

  /**
   * Resolve a playable stream for a YouTube-owned track.
   *
   * Adapter methods must return a discord-player streamable value. To continue
   * after an adapter failure, the adapter must throw an Error with
   * `recoverable === true`; unexpected errors stop resolution immediately.
   *
   * @param {import('discord-player').Track} track YouTube track to resolve.
   * @returns {Promise<import('discord-player').ExtractorStreamable>}
   */
  async resolve(track) {
    if (this.cleanedUp) {
      throw createResolverError(YT_EXTRACTOR_INACTIVE, 'YouTube stream resolver is inactive.');
    }

    if (!isYoutubeTrack(track)) {
      throw createResolverError(YT_NO_STREAM, 'A YouTube-owned track is required for stream resolution.');
    }

    const adapter = this.adapter;
    if (!adapter || typeof adapter !== 'object') {
      throw createResolverError(YT_DEPENDENCY_MISSING, 'YouTube stream adapter is unavailable.');
    }

    if (typeof adapter.resolveCustomStream === 'function') {
      return this.#resolveCustomStream(adapter, track);
    }

    const strategies = STREAM_STRATEGIES.filter(({ method }) => typeof adapter[method] === 'function');
    if (strategies.length === 0) {
      throw createResolverError(YT_DEPENDENCY_MISSING, 'No YouTube stream strategies are available.');
    }

    let lastRecoverableError = null;
    let receivedEmptyResult = false;

    for (const strategy of strategies) {
      try {
        const stream = await adapter[strategy.method](track);
        if (isStreamable(stream)) return stream;

        receivedEmptyResult = true;
        this.#debug(`YouTube stream strategy returned no stream: ${strategy.name}`);
      } catch (error) {
        if (!isRecoverable(error)) {
          throw createResolverError(YT_STREAM_FAILED, `YouTube stream strategy failed: ${strategy.name}`, error);
        }

        lastRecoverableError = error;
        this.#debug(`YouTube stream strategy failed recoverably: ${strategy.name}`);
      }
    }

    if (lastRecoverableError) {
      throw createResolverError(
        YT_STREAM_FAILED,
        'YouTube stream resolution failed after all available strategies.',
        lastRecoverableError
      );
    }

    if (receivedEmptyResult) {
      throw createResolverError(YT_NO_STREAM, 'No playable YouTube stream was returned.');
    }

    throw createResolverError(YT_STREAM_FAILED, 'YouTube stream resolution did not complete.');
  }

  /**
   * Release adapter-owned resources and prevent further resolution.
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.cleanedUp) return;

    const adapter = this.adapter;
    this.cleanedUp = true;
    this.adapter = null;
    this.debug = null;

    if (typeof adapter?.cleanup === 'function') {
      await adapter.cleanup();
    }
  }

  async #resolveCustomStream(adapter, track) {
    try {
      const stream = await adapter.resolveCustomStream(track);
      if (isStreamable(stream)) return stream;

      throw createResolverError(YT_NO_STREAM, 'Custom YouTube stream strategy returned no stream.');
    } catch (error) {
      if (error?.code === YT_NO_STREAM) throw error;

      throw createResolverError(YT_STREAM_FAILED, 'Custom YouTube stream strategy failed.', error);
    }
  }

  #debug(message) {
    try {
      this.debug?.(message);
    } catch {
      // Diagnostics must not change stream resolution behavior.
    }
  }
}
