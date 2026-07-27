import { YT_DIAGNOSTIC_TIMEOUT } from './youtubeErrors.js';

const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 5_000;
const inFlightDiagnostics = new WeakMap();

function createTimeoutError() {
  const error = new Error('YouTube diagnostic timed out.');
  error.code = YT_DIAGNOSTIC_TIMEOUT;
  return error;
}

async function awaitWithTimeout(task, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(createTimeoutError()), timeoutMs);
  });

  try {
    await Promise.race([task, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Coordinate a debug-only diagnostic through the active local extractor.
 * youtubei.js@17.2.0 does not expose abort signals for this workflow, so a
 * timed-out task stays deduplicated until it actually settles.
 *
 * @param {import('discord-player').Track} track Track that failed playback.
 * @param {{diagnose?: (track: import('discord-player').Track, logger: {debug: (message: string) => void}) => Promise<void>} | null} extractor
 * Active local YouTube extractor.
 * @param {{debug: (message: string) => void, debugError: (message: string, error: unknown) => void}} logger
 * Debug-safe logging callbacks supplied by the music service.
 * @param {{timeoutMs?: number}} [options] Diagnostic limits.
 * @returns {Promise<void>}
 */
export async function runYoutubeDiagnostic(
  track,
  extractor,
  { debug, debugError },
  { timeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS } = {}
) {
  if (!extractor || typeof extractor.diagnose !== 'function') {
    debug('Local YouTube diagnostic skipped because the extractor is unavailable.');
    return;
  }

  const activeDiagnostic = inFlightDiagnostics.get(extractor);
  if (activeDiagnostic) {
    debug('Local YouTube diagnostic skipped because another diagnostic is still running.');
    return;
  }

  const task = Promise.resolve().then(() => extractor.diagnose(track, { debug }));
  inFlightDiagnostics.set(extractor, task);
  task.then(
    () => inFlightDiagnostics.delete(extractor),
    () => inFlightDiagnostics.delete(extractor)
  );

  try {
    await awaitWithTimeout(task, timeoutMs);
  } catch (error) {
    debugError('Local YouTube diagnostic failed:', error);
  }
}
