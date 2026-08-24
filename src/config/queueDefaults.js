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
   * up. Lower values reduce the perceived "delay before music starts";
   * higher values help on slow connections. 3 s is a good middle ground.
   */
  bufferingTimeout: 3_000
});

// discord-player 7 enables DAVE by default. Its current voice stack can end
// outgoing audio immediately after a DAVE transition, so keep Discord's normal
// voice encryption enabled for end-to-end voice channel protocol compliance.
export const VOICE_CONNECTION_OPTIONS = Object.freeze({
  daveEncryption: true
});
