import { BaseExtractor, QueryType } from 'discord-player';
import Innertube, { YTNodes } from 'youtubei.js';

import { YoutubeStreamResolver } from './YoutubeStreamResolver.js';
import { YoutubeTrackMapper } from './YoutubeTrackMapper.js';
import {
  YT_BRIDGE_FAILED,
  YT_DEPENDENCY_MISSING,
  YT_EXTRACTOR_INACTIVE,
  YT_INVALID_QUERY,
  YT_METADATA_FAILED,
  YT_NO_STREAM,
  YT_PLAYLIST_FAILED,
  YT_SEARCH_FAILED,
  YT_STREAM_FAILED
} from './youtubeErrors.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const SEARCH_QUERY_TYPES = new Set([QueryType.YOUTUBE, QueryType.YOUTUBE_SEARCH]);
const MAX_PLAYLIST_PAGES = 25;
const MAX_PLAYLIST_ITEMS = 500;

function createExtractorError(code, message, cause, { recoverable = false } = {}) {
  const error = cause ? new Error(message, { cause }) : new Error(message);
  error.code = code;
  if (recoverable) error.recoverable = true;
  return error;
}

function parseYoutubeUrl(query) {
  if (typeof query !== 'string') return null;

  try {
    const url = new URL(query);
    const host = url.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const path = url.pathname.split('/').filter(Boolean);
      return path.length === 1 ? { type: 'video', videoId: path[0] } : null;
    }

    if (!YOUTUBE_HOSTS.has(host)) return null;

    const path = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/playlist') {
      const playlistId = url.searchParams.get('list');
      return playlistId ? { type: 'playlist', playlistId } : null;
    }

    if (url.pathname === '/watch') {
      const playlistId = url.searchParams.get('list');
      if (playlistId) return { type: 'playlist', playlistId };

      const videoId = url.searchParams.get('v');
      return videoId ? { type: 'video', videoId } : null;
    }

    if (['shorts', 'live', 'embed'].includes(path[0])) {
      return path.length === 2 ? { type: 'video', videoId: path[1] } : null;
    }
  } catch {
    return null;
  }

  return null;
}

function isSearchQueryType(type) {
  return SEARCH_QUERY_TYPES.has(type) || type === `ext:${WorldTreeYoutubeExtractor.identifier}`;
}

function isYoutubeVideo(node) {
  if (typeof node?.is === 'function') return node.is(YTNodes.Video);
  return Boolean(node?.video_id);
}

function isPlaylistVideo(node) {
  if (typeof node?.is === 'function') return node.is(YTNodes.PlaylistVideo);
  return Boolean(node?.id && node?.duration);
}

/**
 * Local YouTube extractor for discord-player.
 *
 * This class owns lifecycle and orchestration. Metadata construction and stream
 * fallback behavior remain in YoutubeTrackMapper and YoutubeStreamResolver.
 */
export class WorldTreeYoutubeExtractor extends BaseExtractor {
  static identifier = 'WorldTreeYoutube';

  // Prefer the local YouTube bridge over default metadata-provider bridges.
  // validate() remains strict, so this does not claim non-YouTube searches.
  priority = 1;

  /**
   * Activate the extractor and initialize its local YouTube collaborators.
   *
   * @returns {Promise<void>}
   */
  async activate() {
    if (this.active) return;

    try {
      this.innertube = await Innertube.create({ retrieve_player: true });
      this.mapper = new YoutubeTrackMapper(this);
      this.resolver = new YoutubeStreamResolver(this.#createStreamAdapter(), {
        debug: (message) => this.#debug(message)
      });
      this.protocols = ['yt', 'youtube'];
      this.active = true;
      this.#debug('activated');
    } catch (error) {
      this.#resetState();
      throw createExtractorError(YT_EXTRACTOR_INACTIVE, 'Unable to activate the YouTube extractor.', error);
    }
  }

  /**
   * Release resolver-owned resources and make the extractor unavailable.
   *
   * @returns {Promise<void>}
   */
  async deactivate() {
    if (!this.active && !this.resolver) return;

    try {
      await this.resolver?.cleanup();
      this.#debug('deactivated');
    } finally {
      this.#resetState();
    }
  }

  /**
   * Determine whether this extractor owns a YouTube URL or explicit YouTube search.
   *
   * @param {string} query Query passed by discord-player.
   * @param {import('discord-player').SearchQueryType | null} [type] Resolved query type.
   * @returns {Promise<boolean>}
   */
  async validate(query, type = null) {
    if (parseYoutubeUrl(query)) {
      this.#debug('accepted YouTube URL query');
      return true;
    }

    const accepted = typeof query === 'string' && query.trim().length > 0 && isSearchQueryType(type);
    this.#debug(accepted ? 'accepted explicit YouTube search query' : 'rejected non-YouTube query');
    return accepted;
  }

  /**
   * Resolve YouTube metadata into the ExtractorInfo shape expected by discord-player.
   *
   * @param {string} query Query passed by discord-player.
   * @param {import('discord-player').ExtractorSearchContext} [context] Search context.
   * @returns {Promise<import('discord-player').ExtractorInfo>}
   */
  async handle(query, context = {}) {
    this.#assertActive();

    const parsedQuery = parseYoutubeUrl(query);
    if (parsedQuery?.type === 'playlist') {
      return this.#handlePlaylist(parsedQuery.playlistId, context.requestedBy ?? null);
    }

    if (parsedQuery?.type === 'video') {
      return this.#handleVideo(parsedQuery.videoId, context.requestedBy ?? null);
    }

    if (!isSearchQueryType(context.type) || typeof query !== 'string' || !query.trim()) {
      throw createExtractorError(YT_INVALID_QUERY, 'The query is not a supported YouTube request.');
    }

    return this.#handleSearch(query, context.requestedBy ?? null);
  }

  /**
   * Resolve an audio stream only after discord-player requests playback.
   *
   * @param {import('discord-player').Track} track YouTube track to stream.
   * @returns {Promise<import('discord-player').ExtractorStreamable>}
   */
  async stream(track) {
    this.#assertActive();
    this.#debug('stream resolution requested');

    try {
      const stream = await this.resolver.resolve(track);
      this.#debug('stream resolution completed');
      return stream;
    } catch (error) {
      if (error?.code) throw error;

      throw createExtractorError(YT_STREAM_FAILED, 'YouTube stream resolution failed.', error);
    }
  }

  /**
   * Bridge a metadata-only provider through a locally resolved YouTube result.
   *
   * @param {import('discord-player').Track} track Source-provider track.
   * @param {import('discord-player').BaseExtractor | null} sourceExtractor Source extractor.
   * @returns {Promise<import('discord-player').ExtractorStreamable | null>}
   */
  async bridge(track, sourceExtractor) {
    this.#assertActive();
    this.#debug('bridge requested');

    try {
      const query = sourceExtractor?.createBridgeQuery?.(track) ?? this.createBridgeQuery(track);
      if (typeof query !== 'string' || !query.trim()) {
        throw createExtractorError(YT_INVALID_QUERY, 'The bridge query is invalid.');
      }

      const response = await this.#searchTracks(query, track?.requestedBy ?? null);
      const bridgeTrack = response.tracks[0];
      if (!bridgeTrack) {
        throw createExtractorError(YT_NO_STREAM, 'No YouTube result is available for bridging.');
      }

      return await this.stream(bridgeTrack);
    } catch (error) {
      if (error?.code === YT_EXTRACTOR_INACTIVE) throw error;

      throw createExtractorError(YT_BRIDGE_FAILED, 'YouTube bridge resolution failed.', error);
    }
  }

  /**
   * Run a debug-only diagnostic with this extractor's active Innertube client.
   * The caller owns timeout and in-flight coordination so this method remains
   * limited to the actual diagnostic work.
   *
   * @param {import('discord-player').Track} track Track that failed playback.
   * @param {{debug: (message: string) => void}} logger Debug-safe logger.
   * @returns {Promise<void>}
   */
  async diagnose(track, { debug }) {
    this.#assertActive();
    debug(`Running local YouTube diagnostic for track: ${track.title}...`);

    const search = await this.innertube.search(`${track.title} ${track.author}`, { type: 'video' });
    const videoId = search.results?.[0]?.id ?? search.results?.[0]?.video_id;
    if (!videoId) {
      debug('Local diagnostic search found no results.');
      return;
    }

    debug(`Local diagnostic search successful. Video ID: ${videoId}`);
    const info = await this.innertube.getBasicInfo(videoId);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });

    debug('Local diagnostic format selected. Attempting decipher...');
    const decipheredUrl = await format.decipher(this.innertube.session.player);
    debug(`Local diagnostic decipher successful. URL length: ${decipheredUrl?.length}`);
  }

  async #handleVideo(videoId, requestedBy) {
    try {
      this.#debug('resolving YouTube video metadata');
      const metadata = await this.innertube.getBasicInfo(videoId);
      const track = this.mapper.buildTrack(metadata, { requestedBy });
      if (!track) {
        throw createExtractorError(YT_METADATA_FAILED, 'YouTube video metadata is incomplete.');
      }

      return this.createResponse(null, [track]);
    } catch (error) {
      if (error?.code === YT_METADATA_FAILED) throw error;

      throw createExtractorError(YT_METADATA_FAILED, 'Unable to resolve YouTube video metadata.', error);
    }
  }

  async #handlePlaylist(playlistId, requestedBy) {
    try {
      this.#debug('resolving YouTube playlist metadata');
      const playlist = await this.innertube.getPlaylist(playlistId);
      const items = [];
      let page = playlist;
      let pageCount = 0;

      while (page && pageCount < MAX_PLAYLIST_PAGES && items.length < MAX_PLAYLIST_ITEMS) {
        pageCount += 1;
        const remainingItems = MAX_PLAYLIST_ITEMS - items.length;
        items.push(...(page.items ?? []).filter(isPlaylistVideo).slice(0, remainingItems));

        if (items.length === MAX_PLAYLIST_ITEMS || pageCount === MAX_PLAYLIST_PAGES) {
          break;
        }

        page = page.has_continuation ? await page.getContinuation() : null;
      }

      const mappedPlaylist = this.mapper.buildPlaylist({ info: playlist.info, items }, { playlistId, requestedBy });
      if (!mappedPlaylist) {
        throw createExtractorError(YT_PLAYLIST_FAILED, 'YouTube playlist metadata is incomplete.');
      }

      return this.createResponse(mappedPlaylist, mappedPlaylist.tracks);
    } catch (error) {
      if (error?.code === YT_PLAYLIST_FAILED) throw error;

      throw createExtractorError(YT_PLAYLIST_FAILED, 'Unable to resolve YouTube playlist metadata.', error);
    }
  }

  async #handleSearch(query, requestedBy) {
    try {
      this.#debug('resolving YouTube search metadata');
      const response = await this.#searchTracks(query, requestedBy);
      return this.createResponse(response.playlist, response.tracks);
    } catch (error) {
      if (error?.code === YT_SEARCH_FAILED) throw error;

      throw createExtractorError(YT_SEARCH_FAILED, 'Unable to resolve YouTube search metadata.', error);
    }
  }

  async #searchTracks(query, requestedBy) {
    const search = await this.innertube.search(query);
    return this.mapper.buildSearchResult((search.results ?? []).filter(isYoutubeVideo), { requestedBy });
  }

  #createStreamAdapter() {
    const adapter = {
      resolveAdaptive: (track) => this.#resolveAdaptiveStream(track),
      resolveYtDlp: (track) => this.#resolveYtDlpStream(track),
      cleanup: () => this.#cleanupStreams()
    };

    if (typeof this.options?.createStream === 'function') {
      adapter.resolveCustomStream = (track) => this.options.createStream(track, this);
    } else if (Array.isArray(this.options?.peer) && this.options.peer.length > 0) {
      adapter.resolvePeer = (track) => this.#resolvePeerStream(track);
    }

    return adapter;
  }

  async #resolveAdaptiveStream(track) {
    try {
      const videoId = parseYoutubeUrl(track?.url)?.videoId;
      if (!videoId) {
        throw createExtractorError(YT_NO_STREAM, 'The YouTube track does not contain a playable video ID.');
      }

      const stream = await this.innertube.getStreamingData(videoId, {
        type: 'audio',
        quality: 'best'
      });
      if (typeof stream?.url !== 'string' || stream.url.length === 0) {
        throw createExtractorError(YT_NO_STREAM, 'YouTube did not provide a playable audio stream.');
      }

      return stream.url;
    } catch (error) {
      if (error?.recoverable) throw error;

      throw createExtractorError(YT_NO_STREAM, 'Adaptive YouTube stream resolution failed.', error, {
        recoverable: true
      });
    }
  }

  async #resolvePeerStream(track) {
    const peers = this.options.peer;
    const peer = peers[Math.floor(Math.random() * peers.length)];

    try {
      const videoId = parseYoutubeUrl(track?.url)?.videoId;
      if (!videoId) {
        throw createExtractorError(YT_NO_STREAM, 'The YouTube track does not contain a playable video ID.');
      }

      const url = peer.parseUrl(videoId);
      const headers = typeof peer.headers === 'function' ? await peer.headers(url) : peer.headers;
      const response = await fetch(url, { headers });
      if (!response.ok || !response.body) {
        throw createExtractorError(YT_NO_STREAM, 'Peer did not return a playable stream.');
      }

      const stream = (await import('node:stream')).Readable.fromWeb(response.body);
      this.#trackStream(stream);
      return stream;
    } catch (error) {
      if (error?.recoverable) throw error;

      throw createExtractorError(YT_NO_STREAM, 'Peer YouTube stream resolution failed.', error, { recoverable: true });
    }
  }

  async #resolveYtDlpStream(track) {
    let youtubeDl;

    try {
      ({ default: youtubeDl } = await import('youtube-dl-exec'));
    } catch (error) {
      throw createExtractorError(YT_DEPENDENCY_MISSING, 'yt-dlp stream support is unavailable.', error, {
        recoverable: true
      });
    }

    try {
      const process = youtubeDl.exec(track.url, {
        format: track.live ? 'best[height<=360]' : 'bestaudio',
        output: '-',
        noWarnings: true,
        noProgress: true
      });
      const stream = process.stdout;
      if (!stream) {
        throw createExtractorError(YT_NO_STREAM, 'yt-dlp did not return a playable stream.');
      }

      this.processes ??= new Set();
      this.processes.add(process);
      process.catch((error) => stream.destroy(error)).finally(() => this.processes.delete(process));
      this.#trackStream(stream);
      return stream;
    } catch (error) {
      if (error?.recoverable) throw error;

      throw createExtractorError(YT_NO_STREAM, 'yt-dlp stream resolution failed.', error, { recoverable: true });
    }
  }

  #trackStream(stream) {
    this.streams ??= new Set();
    this.streams.add(stream);
    const release = () => this.streams?.delete(stream);
    stream.once('close', release);
    stream.once('end', release);
    stream.once('error', release);
  }

  async #cleanupStreams() {
    for (const stream of this.streams ?? []) {
      stream.destroy?.();
    }
    this.streams?.clear();

    for (const process of this.processes ?? []) {
      try {
        if (!process.killed) process.kill();
      } catch {
        // Process cleanup must not prevent extractor deactivation.
      }
    }
    this.processes?.clear();
  }

  #assertActive() {
    if (!this.active || !this.innertube || !this.mapper || !this.resolver) {
      throw createExtractorError(YT_EXTRACTOR_INACTIVE, 'The YouTube extractor is inactive.');
    }
  }

  #resetState() {
    this.active = false;
    this.innertube = null;
    this.mapper = null;
    this.resolver = null;
    this.protocols = [];
    this.streams = null;
    this.processes = null;
  }

  #debug(message) {
    try {
      this.debug(`[WorldTreeYoutube] ${message}`);
    } catch {
      // Debug output must never alter extractor behavior.
    }
  }
}
