/**
 * @file Default queue/node options for discord-player v7.
 *
 * Every command that creates a GuildQueue (`play`, `join`, `247`) should
 * spread these defaults so that playback quality, leave behaviour, and
 * buffering are consistent regardless of which command initiated the session.
 *
 * @module config/queueDefaults
 */

export const QUEUE_DEFAULTS = Object.freeze({
  /** Leave voice when every human leaves the channel. */
  leaveOnEmpty: true,
  /** Grace period (ms) before leaving an empty channel. */
  leaveOnEmptyCooldown: 300_000,
  /** Leave voice when the queue runs out of tracks. */
  leaveOnEnd: true,
  /** Grace period (ms) before leaving after queue ends. */
  leaveOnEndCooldown: 300_000,
  /** Server-deafen the bot to reduce bandwidth and signal "not listening". */
  selfDeaf: true,
  /** Default playback volume (0-100). */
  volume: 80,
  /**
   * Maximum ms the player waits for the audio buffer to fill before giving
   * up. Higher value provides stable, jitter-free buffer headroom.
   */
  bufferingTimeout: 5_000
});

// discord-player 7 enables DAVE by default. Its pure JS MLS implementation can
// cause periodic event-loop latency spikes and micro-buffering. Use Discord's
// hardware-accelerated standard voice transport encryption for crystal clear playback.
export const VOICE_CONNECTION_OPTIONS = Object.freeze({
  daveEncryption: false
});
