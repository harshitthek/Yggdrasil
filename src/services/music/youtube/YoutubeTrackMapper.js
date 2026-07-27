import { Playlist, QueryType, Track, Util } from 'discord-player';

const UNKNOWN_TITLE = 'UNKNOWN TITLE';
const UNKNOWN_AUTHOR = 'UNKNOWN AUTHOR';

function getText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);

  if (value && typeof value.toString === 'function') {
    const text = value.toString();
    return typeof text === 'string' ? text.trim() : '';
  }

  return '';
}

function getThumbnailUrl(thumbnails) {
  if (!Array.isArray(thumbnails)) return '';

  return thumbnails.find((thumbnail) => typeof thumbnail?.url === 'string')?.url || '';
}

function getDuration(video, metadata) {
  const seconds = Number(video?.duration?.seconds ?? metadata?.duration);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Util.buildTimeCode(Util.parseMS(seconds * 1000));
  }

  const duration = getText(video?.duration?.text ?? video?.length_text);
  return /^\d+(?::\d{1,2}){1,2}$/.test(duration) ? duration : '0:00';
}

function getViewCount(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;

  const text = getText(value).replaceAll(',', '');
  const match = text.match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return 0;

  const amount = Number(match[1]);
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]?.toUpperCase()] || 1;
  return Number.isFinite(amount) ? Math.floor(amount * multiplier) : 0;
}

function buildVideoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function buildPlaylistUrl(playlistId) {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

function getVideoId(video, metadata) {
  return getText(video?.video_id ?? video?.id ?? metadata?.id);
}

function getAuthor(author) {
  return {
    name: getText(author?.name ?? author) || UNKNOWN_AUTHOR,
    url: getText(author?.url)
  };
}

/**
 * Converts youtubei.js metadata into discord-player models.
 *
 * The mapper is intentionally the only local YouTube module that constructs
 * Track and Playlist instances. It has no client, request, stream, or retry
 * responsibilities.
 */
export class YoutubeTrackMapper {
  /**
   * @param {import('discord-player').BaseExtractor} extractor Active extractor that owns the Player context.
   */
  constructor(extractor) {
    this.extractor = extractor;
    this.player = extractor?.context?.player ?? null;
  }

  /**
   * Build a Track from a youtubei.js Video, PlaylistVideo, or VideoInfo object.
   *
   * @param {object} video youtubei.js video metadata.
   * @param {{ playlist?: import('discord-player').Playlist, requestedBy?: import('discord.js').User | null }} [options]
   * @returns {import('discord-player').Track | null} Null when required video identity is unavailable.
   */
  buildTrack(video, { playlist, requestedBy = null } = {}) {
    if (!this.player || !video || typeof video !== 'object') return null;

    const metadata = video.basic_info && typeof video.basic_info === 'object' ? video.basic_info : video;
    const videoId = getVideoId(video, metadata);
    if (!videoId) return null;

    const author = getAuthor(video.author ?? metadata.author);
    const uploadDate = getText(video.published ?? metadata.publish_date ?? metadata.upload_date);
    const channel = {
      name: author.name,
      url: author.url
    };
    const thumbnail =
      video.best_thumbnail?.url ||
      getThumbnailUrl(video.thumbnails) ||
      getThumbnailUrl(metadata.thumbnail) ||
      getText(metadata.thumbnail);

    return new Track(this.player, {
      title: getText(video.title ?? metadata.title) || UNKNOWN_TITLE,
      author: author.name,
      url: buildVideoUrl(videoId),
      thumbnail,
      duration: getDuration(video, metadata),
      views: getViewCount(video.view_count ?? metadata.view_count),
      requestedBy,
      playlist,
      source: 'youtube',
      queryType: QueryType.YOUTUBE_VIDEO,
      live: Boolean(video.is_live ?? metadata.is_live),
      raw: {
        source: 'youtube',
        youtube: {
          videoId,
          uploadDate,
          channel,
          extractorIdentifier: this.extractor?.identifier ?? null
        }
      }
    });
  }

  /**
   * Build a Playlist and map its available youtubei.js playlist videos.
   *
   * The installed youtubei.js Playlist API exposes `items`; `videos` remains
   * accepted for compatibility with the installed upstream extractor.
   *
   * @param {object} source youtubei.js playlist metadata.
   * @param {{ playlistId?: string, url?: string, requestedBy?: import('discord.js').User | null }} [options]
   * @returns {import('discord-player').Playlist | null} Null when playlist identity is unavailable.
   */
  buildPlaylist(source, { playlistId, url, requestedBy = null } = {}) {
    if (!this.player || !source || typeof source !== 'object') return null;

    const info = source.info && typeof source.info === 'object' ? source.info : source;
    const id = getText(playlistId ?? source.id ?? info.id);
    if (!id) return null;

    const author = getAuthor(info.author ?? source.author);
    const playlist = new Playlist(this.player, {
      title: getText(info.title ?? source.title) || 'UNKNOWN PLAYLIST',
      description: getText(info.description ?? source.description),
      thumbnail: getThumbnailUrl(info.thumbnails ?? source.thumbnails),
      type: 'playlist',
      source: 'youtube',
      author,
      tracks: [],
      id,
      url: getText(url ?? source.share_url) || buildPlaylistUrl(id)
    });
    const videos = Array.isArray(source.items) ? source.items : Array.isArray(source.videos) ? source.videos : [];

    playlist.tracks = videos
      .map((video) => this.buildTrack(video, { playlist, requestedBy }))
      .filter((track) => track !== null);

    return playlist;
  }

  /**
   * Build the ExtractorInfo-compatible payload for a YouTube search response.
   *
   * @param {object[] | object} source youtubei.js Search results or a result collection.
   * @param {{ requestedBy?: import('discord.js').User | null }} [options]
   * @returns {{ playlist: null, tracks: import('discord-player').Track[] }} Empty tracks for malformed or empty input.
   */
  buildSearchResult(source, { requestedBy = null } = {}) {
    const results = Array.isArray(source) ? source : (source?.results ?? source?.videos);
    if (!Array.isArray(results)) return { playlist: null, tracks: [] };

    return {
      playlist: null,
      tracks: results.map((video) => this.buildTrack(video, { requestedBy })).filter((track) => track !== null)
    };
  }
}
