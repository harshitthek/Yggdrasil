import { settingsRepository } from '../database/mongo/repositories/settingsRepository.js';
import {
  DEFAULT_AUTOMOD,
  DEFAULT_MODERATION_SETTINGS,
  DEFAULT_ACTIVITY_ROLES,
  ACTIVITY_TYPES
} from '../utils/constants.js';
import { LruCache } from '../utils/lruCache.js';
import ms from 'ms';

const DEFAULT_CACHE_TTL_MS = 30_000;
const VALID_RULES = new Set(Object.keys(DEFAULT_AUTOMOD.rules));
const VALID_ACTIONS = new Set(['delete', 'warn', 'timeout']);
const VALID_ACTIVITY_TYPES = new Set(Object.keys(ACTIVITY_TYPES));

function clone(value) {
  return structuredClone(value);
}

function mergeObject(defaults, value = {}) {
  const merged = { ...clone(defaults), ...value };

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
      merged[key] = mergeObject(defaultValue, value?.[key]);
    }
  }

  return merged;
}

export function normalizeGuildSettings(settings = {}) {
  const automod = mergeObject(DEFAULT_AUTOMOD, settings.automod ?? {});
  const moderation = mergeObject(DEFAULT_MODERATION_SETTINGS, settings.moderation ?? {});
  const activityRoles = mergeObject(DEFAULT_ACTIVITY_ROLES, settings.activityRoles ?? {});
  const twentyFourSeven = settings.twentyFourSeven ?? { enabled: false, voiceChannelId: null, textChannelId: null };

  automod.enabled = Boolean(settings.automod?.enabled ?? settings.automodEnabled ?? automod.enabled);

  const musicPanel =
    settings.musicChannelId && settings.musicMessageId
      ? { channelId: settings.musicChannelId, messageId: settings.musicMessageId }
      : null;

  return {
    ...settings,
    automod,
    moderation,
    activityRoles,
    twentyFourSeven,
    musicPanel,
    trustedAdminRoleIds: settings.trustedAdminRoleIds ?? [],
    featureToggles: {
      moderation: true,
      automod: automod.enabled,
      utility: true,
      ...(settings.featureToggles ?? {})
    }
  };
}

function assertRuleName(ruleName) {
  if (!VALID_RULES.has(ruleName)) {
    throw new Error(`Unsupported automod rule: ${ruleName}`);
  }
}

function assertAction(action) {
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`Unsupported automod action: ${action}`);
  }
}

function assertActivityType(activityType) {
  if (!VALID_ACTIVITY_TYPES.has(activityType)) {
    throw new Error(
      `Unsupported activity type: ${activityType}. Valid types: ${Array.from(VALID_ACTIVITY_TYPES).join(', ')}`
    );
  }
}

export function createSettingsService(
  repository = settingsRepository,
  { cacheTtlMs = DEFAULT_CACHE_TTL_MS, maxSize = 1000 } = {}
) {
  const cache = new LruCache(maxSize);

  function clearCache(guildId) {
    cache.delete(guildId);
  }

  async function getEffectiveSettings(guildId) {
    const cached = cache.get(guildId);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.settings;
    }

    const settings = normalizeGuildSettings(await repository.getOrCreate(guildId));
    cache.set(guildId, {
      settings,
      expiresAt: Date.now() + cacheTtlMs
    });

    return settings;
  }

  return {
    getSettings: getEffectiveSettings,
    getEffectiveSettings,
    clearCache,

    async setModLogChannel(guildId, channelId) {
      const settings = normalizeGuildSettings(await repository.setModLogChannel(guildId, channelId));
      clearCache(guildId);
      return settings;
    },

    async setMusicPanel(guildId, channelId, messageId) {
      const settings = normalizeGuildSettings(await repository.setMusicPanel(guildId, channelId, messageId));
      clearCache(guildId);
      return settings;
    },

    async addTrustedAdminRole(guildId, roleId) {
      const settings = normalizeGuildSettings(await repository.addTrustedAdminRole(guildId, roleId));
      clearCache(guildId);
      return settings;
    },

    async removeTrustedAdminRole(guildId, roleId) {
      const settings = normalizeGuildSettings(await repository.removeTrustedAdminRole(guildId, roleId));
      clearCache(guildId);
      return settings;
    },

    async setAutomodEnabled(guildId, enabled) {
      const settings = normalizeGuildSettings(await repository.setAutomodEnabled(guildId, Boolean(enabled)));
      clearCache(guildId);
      return settings;
    },

    async updateAutomodThreshold(guildId, ruleName, threshold) {
      assertRuleName(ruleName);
      if (!Number.isInteger(threshold) || threshold <= 0) {
        throw new Error('Automod threshold must be a positive integer.');
      }
      const settings = normalizeGuildSettings(await repository.updateAutomodRule(guildId, ruleName, { threshold }));
      clearCache(guildId);
      return settings;
    },

    async updateAutomodRule(guildId, ruleName, values) {
      assertRuleName(ruleName);
      const settings = normalizeGuildSettings(await repository.updateAutomodRule(guildId, ruleName, values));
      clearCache(guildId);
      return settings;
    },

    async updateAutomodPunishment(guildId, ruleName, { action, timeoutDuration }) {
      assertRuleName(ruleName);
      assertAction(action);

      if (action === 'timeout') {
        const parsed = ms(String(timeoutDuration ?? '').trim());
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error('Invalid timeout duration. Use formats like "10m", "2h", or "1d".');
        }
      }

      const settings = normalizeGuildSettings(
        await repository.updateAutomodPunishment(guildId, ruleName, {
          action,
          timeoutDuration
        })
      );
      clearCache(guildId);
      return settings;
    },

    async addBadWord(guildId, word) {
      const normalizedWord = String(word ?? '')
        .trim()
        .toLowerCase();

      if (!normalizedWord) {
        throw new Error('Bad word cannot be empty.');
      }

      const settings = normalizeGuildSettings(await repository.addBadWord(guildId, normalizedWord));
      clearCache(guildId);
      return settings;
    },

    async removeBadWord(guildId, word) {
      const settings = normalizeGuildSettings(
        await repository.removeBadWord(
          guildId,
          String(word ?? '')
            .trim()
            .toLowerCase()
        )
      );
      clearCache(guildId);
      return settings;
    },

    // ─── Activity Roles ───────────────────────────────────────────────────────

    async setActivityRole(guildId, activityType, { enabled, roleId }) {
      assertActivityType(activityType);
      const settings = normalizeGuildSettings(
        await repository.setActivityRole(guildId, activityType, { enabled, roleId })
      );
      clearCache(guildId);
      return settings;
    },

    async removeActivityRole(guildId, activityType) {
      assertActivityType(activityType);
      const settings = normalizeGuildSettings(await repository.removeActivityRole(guildId, activityType));
      clearCache(guildId);
      return settings;
    },

    // ─── 24/7 Voice ────────────────────────────────────────────────────────────

    async set247(guildId, { enabled, voiceChannelId, textChannelId }) {
      const updated = await repository.set247(guildId, { enabled, voiceChannelId, textChannelId });
      clearCache(guildId);
      return normalizeGuildSettings(updated);
    },

    async getAll247Guilds() {
      return repository.getAll247Guilds();
    }
  };
}

export const settingsService = createSettingsService();
