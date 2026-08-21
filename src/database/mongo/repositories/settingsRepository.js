import { GuildSettings } from '../models/GuildSettings.js';
import { upsertOptions } from '../queryOptions.js';

function buildNestedSet(prefix, values) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [`${prefix}.${key}`, value])
  );
}

export function createSettingsRepository(model = GuildSettings) {
  return {
    async getOrCreate(guildId) {
      return model.findOneAndUpdate({ guildId }, { $setOnInsert: { guildId } }, upsertOptions()).lean();
    },

    async setModLogChannel(guildId, channelId) {
      return model.findOneAndUpdate({ guildId }, { $set: { modLogChannelId: channelId } }, upsertOptions()).lean();
    },

    async setMusicPanel(guildId, channelId, messageId) {
      return model
        .findOneAndUpdate(
          { guildId },
          { $set: { musicChannelId: channelId, musicMessageId: messageId } },
          upsertOptions()
        )
        .lean();
    },

    async setTrustedAdminRoles(guildId, roleIds) {
      return model.findOneAndUpdate({ guildId }, { $set: { trustedAdminRoleIds: roleIds } }, upsertOptions()).lean();
    },

    async addTrustedAdminRole(guildId, roleId) {
      return model
        .findOneAndUpdate({ guildId }, { $addToSet: { trustedAdminRoleIds: roleId } }, upsertOptions())
        .lean();
    },

    async removeTrustedAdminRole(guildId, roleId) {
      return model.findOneAndUpdate({ guildId }, { $pull: { trustedAdminRoleIds: roleId } }, upsertOptions()).lean();
    },

    async setAutomodEnabled(guildId, enabled) {
      return model
        .findOneAndUpdate(
          { guildId },
          { $set: { automodEnabled: enabled, 'automod.enabled': enabled, 'featureToggles.automod': enabled } },
          upsertOptions()
        )
        .lean();
    },

    async updateAutomodRule(guildId, ruleName, values) {
      return model
        .findOneAndUpdate({ guildId }, { $set: buildNestedSet(`automod.rules.${ruleName}`, values) }, upsertOptions())
        .lean();
    },

    async updateAutomodPunishment(guildId, ruleName, punishment) {
      return model
        .findOneAndUpdate(
          { guildId },
          { $set: buildNestedSet(`automod.rules.${ruleName}.punishment`, punishment) },
          upsertOptions()
        )
        .lean();
    },

    async addBadWord(guildId, word) {
      return model
        .findOneAndUpdate(
          { guildId },
          { $addToSet: { 'automod.rules.badWords.words': word.toLowerCase() } },
          upsertOptions()
        )
        .lean();
    },

    async removeBadWord(guildId, word) {
      return model
        .findOneAndUpdate(
          { guildId },
          { $pull: { 'automod.rules.badWords.words': word.toLowerCase() } },
          upsertOptions()
        )
        .lean();
    },

    // ─── 24/7 Voice ────────────────────────────────────────────────────────────

    async set247(guildId, { enabled, voiceChannelId, textChannelId }) {
      return model
        .findOneAndUpdate(
          { guildId },
          {
            $set: {
              'twentyFourSeven.enabled': Boolean(enabled),
              'twentyFourSeven.voiceChannelId': voiceChannelId ?? null,
              'twentyFourSeven.textChannelId': textChannelId ?? null
            }
          },
          upsertOptions()
        )
        .lean();
    },

    async getAll247Guilds() {
      return model.find({ 'twentyFourSeven.enabled': true, 'twentyFourSeven.voiceChannelId': { $ne: null } }).lean();
    },

    // ─── Activity Roles ───────────────────────────────────────────────────────

    async setActivityRole(guildId, activityType, { enabled, roleId }) {
      return model
        .findOneAndUpdate(
          { guildId },
          { $set: buildNestedSet(`activityRoles.${activityType}`, { enabled, roleId }) },
          upsertOptions()
        )
        .lean();
    },

    async removeActivityRole(guildId, activityType) {
      return model
        .findOneAndUpdate(
          { guildId },
          {
            $set: { [`activityRoles.${activityType}.enabled`]: false, [`activityRoles.${activityType}.roleId`]: null }
          },
          upsertOptions()
        )
        .lean();
    }
  };
}

export const settingsRepository = createSettingsRepository();
