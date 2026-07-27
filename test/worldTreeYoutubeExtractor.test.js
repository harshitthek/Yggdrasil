import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { WorldTreeYoutubeExtractor } from '../src/services/music/youtube/WorldTreeYoutubeExtractor.js';
import { YoutubeTrackMapper } from '../src/services/music/youtube/YoutubeTrackMapper.js';
import {
  YT_BRIDGE_FAILED,
  YT_EXTRACTOR_INACTIVE,
  YT_INVALID_QUERY,
  YT_METADATA_FAILED,
  YT_NO_STREAM
} from '../src/services/music/youtube/youtubeErrors.js';

function createExtractor({ innertube = {}, resolver } = {}) {
  const extractor = new WorldTreeYoutubeExtractor({
    player: {
      debug: () => {},
      nodes: { cache: new Map() }
    }
  });

  extractor.innertube = innertube;
  extractor.mapper = new YoutubeTrackMapper(extractor);
  extractor.resolver = resolver ?? {
    resolve: async () => Readable.from(['audio']),
    cleanup: async () => {}
  };
  extractor.active = true;

  return extractor;
}

test('WorldTreeYoutubeExtractor validates YouTube video and playlist URLs without claiming other providers', async () => {
  const extractor = createExtractor();

  assert.equal(await extractor.validate('https://www.youtube.com/watch?v=video-1'), true);
  assert.equal(await extractor.validate('https://www.youtube.com/playlist?list=playlist-1'), true);
  assert.equal(await extractor.validate('https://open.spotify.com/track/example'), false);
  assert.equal(await extractor.validate('https://youtu.be/video-1/extra'), false);
  assert.equal(await extractor.validate('https://www.youtube.com/results?search_query=music&list=playlist-1'), false);
});

test('WorldTreeYoutubeExtractor is preferred for provider bridge attempts without claiming other searches', async () => {
  const extractor = createExtractor();

  assert.equal(extractor.priority, 1);
  assert.equal(await extractor.validate('https://open.spotify.com/track/example'), false);
  assert.equal(await extractor.validate('a song title', 'autoSearch'), false);
});

test('WorldTreeYoutubeExtractor maps video metadata into an ExtractorInfo response', async () => {
  const extractor = createExtractor({
    innertube: {
      getBasicInfo: async (videoId) => ({ basic_info: { id: videoId, title: 'Example video' } })
    }
  });

  const result = await extractor.handle('https://www.youtube.com/watch?v=video-1', { requestedBy: { id: 'user-1' } });

  assert.equal(result.playlist, null);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].title, 'Example video');
  assert.equal(result.tracks[0].requestedBy.id, 'user-1');
});

test('WorldTreeYoutubeExtractor maps playlist metadata into an ExtractorInfo response', async () => {
  const extractor = createExtractor({
    innertube: {
      getPlaylist: async () => ({
        info: { title: 'Example playlist' },
        items: [{ id: 'video-1', duration: { seconds: 60 }, title: 'First track' }],
        has_continuation: false
      })
    }
  });

  const result = await extractor.handle('https://www.youtube.com/playlist?list=playlist-1');

  assert.equal(result.playlist.title, 'Example playlist');
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].playlist, result.playlist);
});

test('WorldTreeYoutubeExtractor bounds playlist pagination by item and page caps', async () => {
  const cappedItems = Array.from({ length: 600 }, (_, index) => ({
    id: `video-${index}`,
    duration: { seconds: 60 },
    title: `Track ${index}`
  }));
  let continuationCalls = 0;
  const extractor = createExtractor({
    innertube: {
      getPlaylist: async () => ({
        info: { title: 'Large playlist' },
        items: cappedItems,
        has_continuation: true,
        getContinuation: async () => {
          continuationCalls += 1;
          return null;
        }
      })
    }
  });

  const result = await extractor.handle('https://www.youtube.com/playlist?list=playlist-1');

  assert.equal(result.tracks.length, 500);
  assert.equal(continuationCalls, 0);
});

test('WorldTreeYoutubeExtractor stops playlist pagination at the page cap', async () => {
  const pages = Array.from({ length: 26 }, (_, index) => ({
    info: { title: 'Paged playlist' },
    items: [{ id: `video-${index}`, duration: { seconds: 60 }, title: `Track ${index}` }],
    has_continuation: index < 25
  }));
  let continuationCalls = 0;

  pages.forEach((page, index) => {
    page.getContinuation = async () => {
      continuationCalls += 1;
      return pages[index + 1];
    };
  });

  const extractor = createExtractor({
    innertube: { getPlaylist: async () => pages[0] }
  });

  const result = await extractor.handle('https://www.youtube.com/playlist?list=playlist-1');

  assert.equal(result.tracks.length, 25);
  assert.equal(continuationCalls, 24);
});

test('WorldTreeYoutubeExtractor diagnostics use its active Innertube client', async () => {
  const calls = [];
  const extractor = createExtractor({
    innertube: {
      session: { player: {} },
      search: async () => {
        calls.push('search');
        return { results: [{ id: 'video-1' }] };
      },
      getBasicInfo: async () => {
        calls.push('info');
        return {
          chooseFormat: () => ({
            decipher: async () => {
              calls.push('decipher');
              return 'https://stream.example/audio';
            }
          })
        };
      }
    }
  });

  await extractor.diagnose({ title: 'Example', author: 'Artist' }, { debug: () => {} });

  assert.deepEqual(calls, ['search', 'info', 'decipher']);
});

test('WorldTreeYoutubeExtractor delegates stream acquisition to YoutubeStreamResolver', async () => {
  const stream = Readable.from(['audio']);
  let resolvedTrack;
  const extractor = createExtractor({
    resolver: {
      resolve: async (track) => {
        resolvedTrack = track;
        return stream;
      },
      cleanup: async () => {}
    }
  });
  const track = { source: 'youtube', raw: { source: 'youtube' } };

  assert.equal(await extractor.stream(track), stream);
  assert.equal(resolvedTrack, track);
});

test('WorldTreeYoutubeExtractor bridges through a locally mapped YouTube result', async () => {
  const stream = Readable.from(['audio']);
  let bridgeTrack;
  const extractor = createExtractor({
    innertube: {
      search: async () => ({ results: [{ video_id: 'video-1', title: 'Bridge result' }] })
    },
    resolver: {
      resolve: async (track) => {
        bridgeTrack = track;
        return stream;
      },
      cleanup: async () => {}
    }
  });

  const result = await extractor.bridge(
    { title: 'Source track', author: 'Source artist', requestedBy: { id: 'user-1' } },
    { createBridgeQuery: () => 'Source track Source artist' }
  );

  assert.equal(result, stream);
  assert.equal(bridgeTrack.source, 'youtube');
  assert.equal(bridgeTrack.requestedBy.id, 'user-1');
});

test('WorldTreeYoutubeExtractor preserves stable errors and rejects use after deactivation', async () => {
  let cleanupCalls = 0;
  const extractor = createExtractor({
    innertube: {
      getBasicInfo: async () => {
        throw new Error('Upstream failure');
      }
    },
    resolver: {
      resolve: async () => {
        const error = new Error('No stream');
        error.code = YT_NO_STREAM;
        throw error;
      },
      cleanup: async () => {
        cleanupCalls += 1;
      }
    }
  });

  await assert.rejects(extractor.handle('invalid query'), (error) => error.code === YT_INVALID_QUERY);
  await assert.rejects(
    extractor.handle('https://www.youtube.com/watch?v=video-1'),
    (error) => error.code === YT_METADATA_FAILED
  );
  await assert.rejects(
    extractor.stream({ source: 'youtube', raw: { source: 'youtube' } }),
    (error) => error.code === YT_NO_STREAM
  );
  await assert.rejects(
    extractor.bridge({ title: 'No result', author: 'Artist' }, { createBridgeQuery: () => 'query' }),
    (error) => error.code === YT_BRIDGE_FAILED
  );

  await extractor.deactivate();

  assert.equal(cleanupCalls, 1);
  await assert.rejects(extractor.stream({ source: 'youtube', raw: { source: 'youtube' } }), (error) => {
    return error.code === YT_EXTRACTOR_INACTIVE;
  });
});
