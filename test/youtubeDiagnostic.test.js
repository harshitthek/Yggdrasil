import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runYoutubeDiagnostic } from '../src/services/music/youtube/YoutubeDiagnostic.js';
import { YT_DIAGNOSTIC_TIMEOUT } from '../src/services/music/youtube/youtubeErrors.js';

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

test('runYoutubeDiagnostic deduplicates active extractor diagnostics', async () => {
  const deferred = createDeferred();
  let calls = 0;
  const messages = [];
  const extractor = {
    diagnose: async () => {
      calls += 1;
      await deferred.promise;
    }
  };
  const logger = {
    debug: (message) => messages.push(message),
    debugError: () => {}
  };

  const first = runYoutubeDiagnostic({ title: 'Example', author: 'Artist' }, extractor, logger, { timeoutMs: 100 });
  await Promise.resolve();
  await runYoutubeDiagnostic({ title: 'Example', author: 'Artist' }, extractor, logger, { timeoutMs: 100 });
  deferred.resolve();
  await first;

  assert.equal(calls, 1);
  assert.ok(messages.some((message) => message.includes('another diagnostic is still running')));
});

test('runYoutubeDiagnostic times out once and keeps the unfinished task deduplicated', async () => {
  const deferred = createDeferred();
  let calls = 0;
  const errors = [];
  const extractor = {
    diagnose: async () => {
      calls += 1;
      await deferred.promise;
    }
  };
  const logger = {
    debug: () => {},
    debugError: (_message, error) => errors.push(error)
  };

  await runYoutubeDiagnostic({ title: 'Example', author: 'Artist' }, extractor, logger, { timeoutMs: 10 });
  await runYoutubeDiagnostic({ title: 'Example', author: 'Artist' }, extractor, logger, { timeoutMs: 10 });

  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, YT_DIAGNOSTIC_TIMEOUT);

  deferred.resolve();
  await Promise.resolve();
});
