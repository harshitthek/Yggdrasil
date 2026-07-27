import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { YoutubeStreamResolver } from '../src/services/music/youtube/YoutubeStreamResolver.js';
import {
  YT_DEPENDENCY_MISSING,
  YT_EXTRACTOR_INACTIVE,
  YT_NO_STREAM,
  YT_STREAM_FAILED
} from '../src/services/music/youtube/youtubeErrors.js';

const youtubeTrack = {
  source: 'youtube',
  raw: { source: 'youtube' },
  title: 'Example track',
  url: 'https://www.youtube.com/watch?v=example'
};

test('YoutubeStreamResolver returns a successful stream from the injected adapter', async () => {
  const stream = Readable.from(['audio']);
  const resolver = new YoutubeStreamResolver({
    resolveAdaptive: async (track) => {
      assert.equal(track, youtubeTrack);
      return stream;
    }
  });

  assert.equal(await resolver.resolve(youtubeTrack), stream);
});

test('YoutubeStreamResolver advances through the installed upstream fallback order after recoverable failures', async () => {
  const calls = [];
  const stream = Readable.from(['audio']);
  const recoverableError = new Error('Peer unavailable');
  recoverableError.recoverable = true;
  const resolver = new YoutubeStreamResolver({
    resolvePeer: async () => {
      calls.push('peer');
      throw recoverableError;
    },
    resolveAdaptive: async () => {
      calls.push('adaptive');
      return stream;
    },
    resolveSabr: async () => {
      calls.push('sabr');
      return Readable.from(['unexpected']);
    }
  });

  assert.equal(await resolver.resolve(youtubeTrack), stream);
  assert.deepEqual(calls, ['peer', 'adaptive']);
});

test('YoutubeStreamResolver stops immediately on a non-recoverable adapter failure', async () => {
  const calls = [];
  const upstreamError = new Error('Invalid stream request');
  const resolver = new YoutubeStreamResolver({
    resolvePeer: async () => {
      calls.push('peer');
      throw upstreamError;
    },
    resolveAdaptive: async () => {
      calls.push('adaptive');
      return Readable.from(['unexpected']);
    }
  });

  await assert.rejects(resolver.resolve(youtubeTrack), (error) => {
    assert.equal(error.code, YT_STREAM_FAILED);
    assert.equal(error.cause, upstreamError);
    return true;
  });
  assert.deepEqual(calls, ['peer']);
});

test('YoutubeStreamResolver reports stable codes and does not mutate the track', async () => {
  const track = { ...youtubeTrack, raw: { ...youtubeTrack.raw } };
  const before = structuredClone(track);
  const resolver = new YoutubeStreamResolver({
    resolveAdaptive: async () => null
  });

  await assert.rejects(resolver.resolve(track), (error) => error.code === YT_NO_STREAM);
  await assert.rejects(new YoutubeStreamResolver().resolve(track), (error) => error.code === YT_DEPENDENCY_MISSING);
  assert.deepEqual(track, before);
});

test('YoutubeStreamResolver delegates cleanup once and becomes inactive', async () => {
  let cleanupCalls = 0;
  const resolver = new YoutubeStreamResolver({
    resolveAdaptive: async () => Readable.from(['audio']),
    cleanup: async () => {
      cleanupCalls += 1;
    }
  });

  await resolver.cleanup();
  await resolver.cleanup();

  assert.equal(cleanupCalls, 1);
  await assert.rejects(resolver.resolve(youtubeTrack), (error) => error.code === YT_EXTRACTOR_INACTIVE);
});
