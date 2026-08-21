/**
 * @file One-shot registration of every interaction handler with the prefix
 * registry.
 *
 * Each interaction handler exports `{prefix, handle}` (see
 * `src/interactions/registry.js`). This module imports all seven handler
 * modules as namespaces and registers them in a single function so that the
 * dispatch walk preserves the original `commandRouter.js` chain order.
 *
 * Each handler self-guards via `customId.startsWith(prefix)`, so the
 * overlap between `music_` (musicPlayback) and `music_settings`
 * (musicSettings) is safe regardless of registration order. We still
 * register `musicSettings` BEFORE `musicPlayback` to mirror the legacy
 * chain in `commandRouter.js` where the more specific settings branch was
 * tested first.
 *
 * @module interactions/registerAllHandlers
 */

import { registerHandler, _resetRegistryForTesting } from './registry.js';

import * as help from './helpInteractionHandler.js';
import * as musicFilter from './musicFilterInteractionHandler.js';
import * as musicPlayback from './musicPlaybackInteractionHandler.js';
import * as musicSettings from './musicSettingsInteractionHandler.js';
import * as ping from './pingInteractionHandler.js';
import * as queue from './queueInteractionHandler.js';
import * as recording from './recordingInteractionHandler.js';
import * as search from './searchInteractionHandler.js';
import * as settingsButton from './settingsButtonInteractionHandler.js';

/**
 * Register every interaction handler with the registry.
 *
 * Safe to call multiple times: each `registerHandler` simply overwrites the
 * existing entry for a given prefix. Callers that want strict idempotency
 * should still gate via `ensureHandlersRegistered()` in commandRouter.js.
 *
 * @returns {void}
 */
export function registerAllInteractionHandlers() {
  registerHandler(ping);
  registerHandler(queue);
  registerHandler(settingsButton);
  registerHandler(musicSettings);
  registerHandler(musicPlayback);
  registerHandler(musicFilter);
  registerHandler(search);
  registerHandler(help);
  registerHandler(recording);
}

/**
 * Clear every handler from the registry. Intended for tests only.
 *
 * Mirrors `_resetRegistryForTesting` from `registry.js` so tests that import
 * this module can reset state without reaching into the registry directly.
 *
 * @returns {void}
 */
export function _resetRegistrationsForTesting() {
  _resetRegistryForTesting();
}
