import { GatewayIntentBits, Options } from 'discord.js';

// Message content powers prefix commands and automod. Guild members supports
// moderation/userinfo member fetches and role-aware permission checks.
//
// GuildPresences is a privileged intent required for activity roles
// (Spotify, streaming, gaming detection). It must also be enabled in
// the Discord Developer Portal under Bot → Privileged Gateway Intents.
export const CLIENT_INTENTS = Object.freeze([
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildPresences
]);

export const CLIENT_PARTIALS = Object.freeze([]);

/**
 * Memory-optimized cache limits (0 features removed).
 * Caps unbounded Map allocations in Discord.js v14 for low-RAM hosts (1 GB instances).
 */
export const CLIENT_CACHE_OPTIONS = Options.cacheWithLimits({
  // Keep last 25 messages per channel (sufficient for context/automod, prevents caching thousands of messages)
  MessageManager: 25,
  // Cache active users without unbounded heap growth
  UserManager: 100,
  // Sweep/skip unused stage & thread member tracking
  StageInstanceManager: 0,
  ThreadMemberManager: 0,
  ReactionManager: 0
});

/**
 * Periodic cache sweepers to prevent memory bloat over 48h+ runtimes.
 */
export const CLIENT_SWEEPER_OPTIONS = {
  messages: {
    interval: 300, // Sweep every 5 minutes
    lifetime: 1800 // Evict messages older than 30 minutes
  },
  threads: {
    interval: 3600, // Sweep every hour
    lifetime: 14400 // Evict archived threads older than 4 hours
  }
};
