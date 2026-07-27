import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { executePlay, resolveMusicSearchEngine } from '../src/commands/music/play.js';
import { createLocalYoutubeStreamGuard, getYoutubeExtractorRegistration } from '../src/services/musicService.js';
import { WorldTreeYoutubeExtractor } from '../src/services/music/youtube/WorldTreeYoutubeExtractor.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

test('local YouTube cutover keeps the upstream extractor selected while the flag is off', () => {
  const registration = getYoutubeExtractorRegistration(false);

  assert.notEqual(registration.extractor, WorldTreeYoutubeExtractor);
  assert.equal(registration.options.streamOptions.useClient, 'IOS');
  assert.equal(resolveMusicSearchEngine('https://www.youtube.com/watch?v=video-1'), 'auto');
});

test('local YouTube cutover registers and explicitly routes supported YouTube URLs when enabled', () => {
  const registration = getYoutubeExtractorRegistration(true);

  assert.equal(registration.extractor, WorldTreeYoutubeExtractor);
  assert.deepEqual(registration.options, {});
  assert.equal(
    resolveMusicSearchEngine('https://www.youtube.com/watch?v=video-1', { useLocalYoutubeExtractor: true }),
    'ext:WorldTreeYoutube'
  );
  assert.equal(
    resolveMusicSearchEngine('https://youtu.be/video-1', { useLocalYoutubeExtractor: true }),
    'ext:WorldTreeYoutube'
  );
  assert.equal(
    resolveMusicSearchEngine('https://www.youtube.com/playlist?list=playlist-1', { useLocalYoutubeExtractor: true }),
    'ext:WorldTreeYoutube'
  );
});

test('local YouTube cutover routes supported YouTube URL variants when enabled', () => {
  const urls = [
    'https://www.youtube.com/shorts/video-1',
    'https://www.youtube.com/live/video-1',
    'https://www.youtube.com/embed/video-1',
    'https://m.youtube.com/watch?v=video-1',
    'https://m.youtube.com/shorts/video-1',
    'https://m.youtube.com/live/video-1',
    'https://m.youtube.com/embed/video-1',
    'https://music.youtube.com/watch?v=video-1',
    'https://music.youtube.com/shorts/video-1',
    'https://music.youtube.com/live/video-1',
    'https://music.youtube.com/embed/video-1'
  ];

  for (const url of urls) {
    assert.equal(resolveMusicSearchEngine(url, { useLocalYoutubeExtractor: true }), 'ext:WorldTreeYoutube');
  }
});

test('local YouTube cutover preserves routing for non-YouTube URLs and text queries', () => {
  assert.equal(
    resolveMusicSearchEngine('https://open.spotify.com/track/example', { useLocalYoutubeExtractor: true }),
    'auto'
  );
  assert.equal(resolveMusicSearchEngine('a song title', { useLocalYoutubeExtractor: true }), 'autoSearch');
});

test('local YouTube cutover rejects unsupported URL shapes', () => {
  const urls = [
    'https://youtu.be/video-1/extra',
    'https://youtu.be/',
    'https://www.youtube.com/results?search_query=music&list=playlist-1',
    'https://music.youtube.com/results?search_query=music&list=playlist-1',
    'https://www.youtube.com/playlist',
    'https://www.youtube.com/shorts/video-1/extra'
  ];

  for (const url of urls) {
    assert.equal(resolveMusicSearchEngine(url, { useLocalYoutubeExtractor: true }), 'auto');
  }
});

test('executePlay forwards the local extractor route only for enabled YouTube URLs', async () => {
  let searchOptions;

  await executePlay(
    'https://www.youtube.com/watch?v=video-1',
    { id: 'voice-1', guild: { id: 'guild-1' } },
    { id: 'user-1' },
    {},
    {
      getPlayer: () => ({
        search: async (_query, options) => {
          searchOptions = options;
          return { hasTracks: () => false };
        }
      }),
      getGuildQueue: () => null
    },
    async () => {},
    { useLocalYoutubeExtractor: true }
  );

  assert.equal(searchOptions.searchEngine, 'ext:WorldTreeYoutube');
});

test('local YouTube stream guard delegates only local tracks and prevents generic fallback on failure', async () => {
  const localTrack = { extractor: { identifier: WorldTreeYoutubeExtractor.identifier } };
  const stream = { readable: true };
  const localExtractor = {
    stream: async (track) => {
      assert.equal(track, localTrack);
      return stream;
    }
  };
  const guard = createLocalYoutubeStreamGuard(true);
  const queue = {
    player: {
      extractors: {
        get: (identifier) => (identifier === WorldTreeYoutubeExtractor.identifier ? localExtractor : null)
      }
    }
  };

  assert.equal(await guard(localTrack, 'youtubeVideo', queue), stream);
  assert.equal(await guard({ extractor: { identifier: 'SpotifyExtractor' } }, 'spotifySong', queue), null);

  const failedGuard = createLocalYoutubeStreamGuard(true);
  await assert.rejects(
    failedGuard(localTrack, 'youtubeVideo', { player: { extractors: { get: () => null } } }),
    (error) => {
      return error.code === 'YT_DEPENDENCY_MISSING';
    }
  );
});

test('cutover retains both rollback dependencies for the staged migration', () => {
  assert.ok(packageJson.dependencies['discord-player-youtubei']);
  assert.ok(packageJson.dependencies['youtube-dl-exec']);
});
