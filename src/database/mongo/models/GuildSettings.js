import mongoose from 'mongoose';

const punishmentSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['delete', 'warn', 'timeout'],
      default: 'delete'
    },
    timeoutDuration: {
      type: String,
      default: '10m'
    }
  },
  { _id: false }
);

const activityRoleConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    roleId: { type: String, default: null }
  },
  { _id: false }
);

const guildSettingsSchema = new mongoose.Schema(
  {
    guildId: {
      type: String,
      required: true,
      unique: true
    },
    modLogChannelId: {
      type: String,
      default: null
    },
    musicChannelId: {
      type: String,
      default: null
    },
    musicMessageId: {
      type: String,
      default: null
    },
    automodEnabled: {
      type: Boolean,
      default: false
    },
    automod: {
      enabled: { type: Boolean, default: false },
      logActions: { type: Boolean, default: true },
      ignoredChannelIds: { type: [String], default: [] },
      ignoredRoleIds: { type: [String], default: [] },
      rules: {
        badWords: {
          enabled: { type: Boolean, default: false },
          words: { type: [String], default: [] },
          punishment: { type: punishmentSchema, default: () => ({ action: 'warn', timeoutDuration: '10m' }) }
        },
        mentionSpam: {
          enabled: { type: Boolean, default: true },
          threshold: { type: Number, default: 5 },
          windowSeconds: { type: Number, default: 10 },
          punishment: { type: punishmentSchema, default: () => ({ action: 'warn', timeoutDuration: '10m' }) }
        },
        repeatSpam: {
          enabled: { type: Boolean, default: true },
          threshold: { type: Number, default: 4 },
          windowSeconds: { type: Number, default: 12 },
          punishment: { type: punishmentSchema, default: () => ({ action: 'delete', timeoutDuration: '10m' }) }
        },
        linkSpam: {
          enabled: { type: Boolean, default: false },
          allowList: { type: [String], default: [] },
          punishment: { type: punishmentSchema, default: () => ({ action: 'delete', timeoutDuration: '10m' }) }
        },
        capsSpam: {
          enabled: { type: Boolean, default: true },
          minLength: { type: Number, default: 16 },
          ratio: { type: Number, default: 0.75 },
          punishment: { type: punishmentSchema, default: () => ({ action: 'delete', timeoutDuration: '10m' }) }
        }
      }
    },
    moderation: {
      requireReason: { type: Boolean, default: true },
      caseLogEnabled: { type: Boolean, default: true }
    },
    trustedAdminRoleIds: {
      type: [String],
      default: []
    },
    featureToggles: {
      moderation: { type: Boolean, default: true },
      automod: { type: Boolean, default: false },
      utility: { type: Boolean, default: true }
    },
    prefix: {
      type: String,
      default: 'tree'
    },
    twentyFourSeven: {
      enabled: { type: Boolean, default: false },
      voiceChannelId: { type: String, default: null },
      textChannelId: { type: String, default: null }
    },
    activityRoles: {
      spotify: { type: activityRoleConfigSchema, default: () => ({ enabled: false, roleId: null }) },
      streaming: { type: activityRoleConfigSchema, default: () => ({ enabled: false, roleId: null }) },
      gaming: { type: activityRoleConfigSchema, default: () => ({ enabled: false, roleId: null }) },
      voice: { type: activityRoleConfigSchema, default: () => ({ enabled: false, roleId: null }) }
    }
  },
  { timestamps: true }
);

export const GuildSettings =
  mongoose.models.GuildSettings ?? mongoose.model('GuildSettings', guildSettingsSchema, 'guild_settings');
