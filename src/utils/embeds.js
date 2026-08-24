import { EmbedBuilder } from 'discord.js';

import { BOT, COLORS } from './constants.js';
import { formatBoolean, formatDiscordTimestamp, formatDuration } from './formatters.js';

// ─── Base Embed ────────────────────────────────────────────────────────────────

export function buildBaseEmbed({ title, description, color = COLORS.brand }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: `${BOT.name} • Premium Discord Experience` })
    .setTimestamp();

  if (title) {
    embed.setTitle(title);
  }

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

// ─── Semantic Embeds ───────────────────────────────────────────────────────────

export function buildSuccessEmbed(title, description) {
  return buildBaseEmbed({ title: `✅ ${title}`, description, color: COLORS.success });
}

export function buildErrorEmbed(title, description) {
  return buildBaseEmbed({ title: `❌ ${title}`, description, color: COLORS.error });
}

export function buildNeutralEmbed(title, description) {
  return buildBaseEmbed({ title: `ℹ️ ${title}`, description, color: COLORS.neutral });
}

// ─── Ping Embed (Demon Bot Style) ──────────────────────────────────────────────

function getLatencyStatus(ms) {
  if (ms < 100) return { emoji: '🟢', label: 'Excellent' };
  if (ms < 200) return { emoji: '🟡', label: 'Good' };
  if (ms < 400) return { emoji: '🟠', label: 'Fair' };
  return { emoji: '🔴', label: 'Poor' };
}

export function buildPingEmbed(summary) {
  const wsStatus = getLatencyStatus(summary.websocketLatency);
  const botStatus = getLatencyStatus(summary.responseLatency);

  return buildBaseEmbed({
    title: '🔴 Pong!',
    color: COLORS.brand
  })
    .addFields(
      {
        name: 'ℹ️ Latency Information',
        value: [
          `🔌 **Bot Latency** \`\`\`${summary.responseLatency}ms\`\`\``,
          `🌐 **WebSocket Ping** \`\`\`${summary.websocketLatency}ms\`\`\``,
          `${botStatus.emoji} **Bot:** ${botStatus.label}`,
          `${wsStatus.emoji} **Gateway:** ${wsStatus.label}`
        ].join('\n'),
        inline: false
      },
      {
        name: '📊 Performance',
        value: [
          `⏱️ **Uptime:** ${summary.uptime || 'N/A'}`,
          `💾 **Memory:** ${summary.memoryUsed || 'N/A'}`,
          `🏠 **Servers:** ${summary.guildCount || 'N/A'}`
        ].join('\n'),
        inline: false
      }
    )
    .setThumbnail(summary.clientAvatarUrl || null)
    .setFooter({ text: `Requested by ${summary.requestedBy || 'User'} • ${BOT.name}` });
}

// ─── Now Playing Embed ─────────────────────────────────────────────────────────

function getSourceBadge(track) {
  const src = (track.source || track.raw?.source || '').toLowerCase();
  if (src.includes('spotify')) return '🟢 Spotify';
  if (src.includes('apple')) return '🍎 Apple Music';
  if (src.includes('youtube')) return '🔴 YouTube';
  if (src.includes('soundcloud')) return '🟠 SoundCloud';
  return '🎵 Music';
}

function getLoopLabel(mode) {
  if (mode === 1) return '🔂 Track';
  if (mode === 2) return '🔁 Queue';
  if (mode === 3) return '📻 Autoplay';
  return '➡️ Off';
}

export function buildNowPlayingEmbed(track, queue) {
  if (!track) {
    return buildErrorEmbed('Nothing Playing', 'There is no track currently playing.');
  }

  const progress =
    queue.node.createProgressBar?.({
      timecodes: true,
      length: 14,
      indicator: '🔘',
      leftChar: '▬',
      rightChar: '▬'
    }) || '';

  const source = getSourceBadge(track);
  const loopLabel = getLoopLabel(queue.repeatMode);
  const requesterId = track.requestedBy?.id || (typeof track.requestedBy === 'string' ? track.requestedBy : null);
  const requesterMention = requesterId ? `<@${requesterId}>` : 'User';

  const description = [
    `### [${track.title}](${track.url})`,
    `by **${track.author}**`,
    '',
    progress,
    '',
    `${source} · 🔊 ${queue.node.volume ?? 80}% · 🔄 ${loopLabel}`,
    '',
    `👤 **Requested by:** ${requesterMention}`,
    `⏱️ **Duration:** \`${track.duration}\` · 📜 **Queue:** \`${queue.tracks.data.length} track(s)\``
  ].join('\n');

  const embed = buildBaseEmbed({ color: COLORS.brand })
    .setAuthor({ name: '♫ Now Playing', iconURL: track.requestedBy?.displayAvatarURL?.() || undefined })
    .setDescription(description);

  if (nextTrack) {
    embed.addFields({
      name: '⏭️ Up Next',
      value: `[${nextTrack.title}](${nextTrack.url}) — \`${nextTrack.duration}\``,
      inline: false
    });
  }

  if (track.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }

  return embed;
}

// Legacy alias
export function buildMusicPlayerEmbed(track, queue) {
  return buildNowPlayingEmbed(track, queue);
}

// ─── Queue Embed ──────────────────────────────────────────────────────────────

export function buildQueueEmbed(queue) {
  const currentTrack = queue.currentTrack;
  const tracks = queue.tracks.data.slice(0, 10);
  const loopLabel = getLoopLabel(queue.repeatMode);

  let description = '';
  if (currentTrack) {
    description += `**🎶 Now Playing:**\n[${currentTrack.title}](${currentTrack.url})\nby **${currentTrack.author}** — \`${currentTrack.duration}\` · <@${currentTrack.requestedBy?.id || '0'}>\n\n`;
  }

  if (tracks.length > 0) {
    description += '**📜 Up Next:**\n';
    description += tracks
      .map((t, i) => `\`${i + 1}.\` **${t.title}** — \`${t.duration}\` · <@${t.requestedBy?.id || '0'}>`)
      .join('\n');

    if (queue.tracks.data.length > 10) {
      description += `\n\n*... and **${queue.tracks.data.length - 10}** more track(s)*`;
    }
  } else {
    description += '*No upcoming tracks. Add more with* `tree play`';
  }

  const totalTracks = queue.tracks.data.length + (currentTrack ? 1 : 0);

  return buildBaseEmbed({
    title: '📜 Music Queue',
    description,
    color: COLORS.brand
  }).addFields(
    { name: '📀 Total', value: `\`${totalTracks} track(s)\``, inline: true },
    { name: '🔊 Volume', value: `\`${queue.node.volume ?? 80}%\``, inline: true },
    { name: '🔄 Loop', value: loopLabel, inline: true }
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

export function buildAvatarEmbed(summary) {
  return buildBaseEmbed({
    title: `${summary.displayName}'s Avatar`,
    description: `[Open image](${summary.imageUrl})`
  }).setImage(summary.imageUrl);
}

// ─── Banner ───────────────────────────────────────────────────────────────────

export function buildBannerEmbed(summary) {
  if (!summary.imageUrl) {
    return buildNeutralEmbed(`${summary.displayName}'s Banner`, 'No profile banner is available for this user.');
  }

  return buildBaseEmbed({
    title: `${summary.displayName}'s Banner`,
    description: `[Open image](${summary.imageUrl})`
  }).setImage(summary.imageUrl);
}

// ─── User Info ────────────────────────────────────────────────────────────────

export function buildUserInfoEmbed(summary) {
  const roles = summary.roles.length > 0 ? summary.roles.join(', ') : 'None';

  return buildBaseEmbed({
    title: summary.tag,
    description: `User ID: \`${summary.userId}\``
  })
    .setThumbnail(summary.avatarUrl)
    .addFields(
      { name: '📅 Account Created', value: formatDiscordTimestamp(summary.createdAt, 'D'), inline: true },
      { name: '📥 Joined Server', value: formatDiscordTimestamp(summary.joinedAt, 'D'), inline: true },
      { name: '🤖 Bot Account', value: formatBoolean(summary.isBot), inline: true },
      { name: '🎭 Roles', value: roles.slice(0, 1024), inline: false }
    );
}

// ─── Server Info ──────────────────────────────────────────────────────────────

export function buildServerInfoEmbed(summary) {
  const embed = buildBaseEmbed({
    title: `🏠 ${summary.name}`,
    description: `Server ID: \`${summary.guildId}\``
  }).addFields(
    { name: '👥 Members', value: `\`${summary.memberCount}\``, inline: true },
    { name: '💬 Channels', value: `\`${summary.channelCount}\``, inline: true },
    { name: '🎭 Roles', value: `\`${summary.roleCount}\``, inline: true },
    { name: '📅 Created', value: formatDiscordTimestamp(summary.createdAt, 'D'), inline: true }
  );

  if (summary.iconUrl) {
    embed.setThumbnail(summary.iconUrl);
  }

  return embed;
}

// ─── Bot Info (Demon Bot Style) ───────────────────────────────────────────────

export function buildBotInfoEmbed(summary) {
  return buildBaseEmbed({
    title: `🤖 ${BOT.name}`,
    description: `A premium utility, music, and moderation bot.\nBuilt for seamless server management.`,
    color: COLORS.brand
  })
    .setThumbnail(summary.avatarUrl)
    .addFields(
      {
        name: '💻 System',
        value: [
          `**CPU:** ${summary.cpuModel}`,
          `**Usage:** ${summary.cpuUsage}%`,
          `**RAM:** ${summary.memoryUsed} MB / ${summary.memoryTotal} MB`,
          `**Platform:** ${summary.platform}`
        ].join('\n'),
        inline: true
      },
      {
        name: '📊 Statistics',
        value: [
          `**Servers:** ${summary.guildCount}`,
          `**Users:** ${summary.userCount}`,
          `**Channels:** ${summary.channelCount}`,
          `**API Latency:** ${summary.websocketLatency}ms`
        ].join('\n'),
        inline: true
      },
      {
        name: '⚙️ Runtime',
        value: [
          `**Uptime:** ${formatDuration(summary.uptimeMs)}`,
          `**Discord.js:** v${summary.discordJsVersion}`,
          `**Node.js:** ${summary.nodeVersion}`
        ].join('\n'),
        inline: false
      }
    );
}

// ─── Owner Info ───────────────────────────────────────────────────────────────

export function buildOwnerInfoEmbed(summary) {
  return buildBaseEmbed({
    title: '👑 Owner Information',
    description: `Information about the creator of ${BOT.name}.`
  })
    .setThumbnail(summary.ownerAvatarUrl)
    .addFields(
      { name: '👨‍💻 Developer', value: `<@${summary.ownerId}>`, inline: true },
      {
        name: '🌟 Vision',
        value: 'Crafting premium Discord experiences with fast, robust logic and dynamic UI.',
        inline: false
      }
    );
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function buildStatsEmbed(summary) {
  return buildBaseEmbed({
    title: `📊 ${BOT.name} Stats`,
    description: 'Current runtime and coverage snapshot.'
  }).addFields(
    { name: '🏠 Servers', value: `\`${summary.guildCount}\``, inline: true },
    { name: '👥 Members', value: `\`${summary.memberCount}\``, inline: true },
    { name: '⚡ Commands', value: `\`${summary.commandCount}\``, inline: true },
    { name: '🌐 Gateway', value: `\`${summary.websocketLatency}ms\``, inline: true },
    { name: '⏱️ Uptime', value: formatDuration(summary.uptimeMs), inline: true }
  );
}

// ─── Member Count ─────────────────────────────────────────────────────────────

export function buildMemberCountEmbed(summary) {
  return buildBaseEmbed({
    title: '👥 Member Count',
    description: `**${summary.name}** has **${summary.memberCount}** member(s).`
  });
}

// ─── Role Info ────────────────────────────────────────────────────────────────

export function buildRoleInfoEmbed(summary) {
  return buildBaseEmbed({
    title: `🎭 ${summary.name}`,
    description: `Role ID: \`${summary.roleId}\``,
    color: summary.color || COLORS.brand
  }).addFields(
    { name: '👥 Members', value: `\`${summary.memberCount}\``, inline: true },
    { name: '🎨 Color', value: summary.hexColor, inline: true },
    { name: '📅 Created', value: formatDiscordTimestamp(summary.createdAt, 'D'), inline: true },
    { name: '📌 Hoisted', value: formatBoolean(summary.hoist), inline: true },
    { name: '💬 Mentionable', value: formatBoolean(summary.mentionable), inline: true },
    { name: '⚙️ Managed', value: formatBoolean(summary.managed), inline: true }
  );
}

// ─── Moderation Embeds ────────────────────────────────────────────────────────

export function buildModerationResultEmbed(title, moderationCase) {
  return buildSuccessEmbed(title, `Case #${moderationCase.caseId} recorded for <@${moderationCase.targetUserId}>.`);
}

export function buildWarningsEmbed({ targetUser, warnings }) {
  const description =
    warnings.length === 0
      ? 'No warnings are recorded for this user.'
      : warnings
          .slice(0, 8)
          .map((warning) => `**#${warning.caseId}** — ${warning.reason}`)
          .join('\n');

  return buildBaseEmbed({
    title: `⚠️ Warnings for ${targetUser.tag ?? targetUser.username}`,
    description
  });
}

export function buildModerationLogEmbed({ moderationCase, targetUser, moderatorUser }) {
  const targetValue =
    moderationCase.metadata?.targetType === 'channel'
      ? `<#${moderationCase.metadata.channelId ?? moderationCase.targetUserId}>\n\`${moderationCase.targetUserId}\``
      : `${targetUser.tag ?? targetUser.username}\n\`${moderationCase.targetUserId}\``;

  const embed = buildBaseEmbed({
    title: `⚖️ Moderation Case #${moderationCase.caseId}`,
    description: `Action: \`${moderationCase.actionType}\``,
    color: COLORS.warning
  }).addFields(
    { name: '🎯 Target', value: targetValue, inline: true },
    {
      name: '🛡️ Moderator',
      value: `${moderatorUser.tag ?? moderatorUser.username}\n\`${moderationCase.moderatorId}\``,
      inline: true
    },
    { name: '📝 Reason', value: moderationCase.reason, inline: false }
  );

  if (moderationCase.duration) {
    embed.addFields({ name: '⏳ Duration', value: moderationCase.duration, inline: true });
  }

  if (Number.isInteger(moderationCase.deletedMessageCount)) {
    embed.addFields({ name: '🗑️ Messages Deleted', value: `${moderationCase.deletedMessageCount}`, inline: true });
  }

  return embed;
}

// ─── Settings Embeds ──────────────────────────────────────────────────────────

export function buildSettingsEmbed(settings) {
  const trustedRoles = settings.trustedAdminRoleIds?.length
    ? settings.trustedAdminRoleIds.map((roleId) => `<@&${roleId}>`).join(', ')
    : 'None configured';

  const activityRoles =
    Object.entries(settings.activityRoles ?? {})
      .filter(([, config]) => config?.enabled && config?.roleId)
      .map(([type, config]) => {
        const labels = { spotify: '🟢', streaming: '🔴', gaming: '🎮', voice: '🔊' };
        return `${labels[type] ?? '⚡'} <@&${config.roleId}>`;
      })
      .join('\n') || 'None configured';

  return buildBaseEmbed({
    title: `⚙️ ${BOT.name} Settings`,
    description: `Server ID: \`${settings.guildId}\``
  }).addFields(
    {
      name: '📝 Mod Log',
      value: settings.modLogChannelId ? `<#${settings.modLogChannelId}>` : 'Not configured',
      inline: true
    },
    { name: '🛡️ Automod', value: formatBoolean(settings.automod.enabled), inline: true },
    { name: '🎭 Trusted Admin Roles', value: trustedRoles.slice(0, 1024), inline: false },
    { name: '⚡ Activity Roles', value: activityRoles.slice(0, 1024), inline: false }
  );
}

export function buildAutomodSettingsEmbed(settings) {
  const rules = Object.entries(settings.automod.rules)
    .map(([name, rule]) => {
      const threshold = rule.threshold ? `, threshold ${rule.threshold}` : '';
      const icon = rule.enabled ? '✅' : '❌';
      return `${icon} \`${name}\`: ${rule.enabled ? 'on' : 'off'} (${rule.punishment?.action ?? 'delete'}${threshold})`;
    })
    .join('\n');

  return buildBaseEmbed({
    title: '🛡️ Automod Settings',
    description: settings.automod.enabled ? '✅ Automod is **enabled**.' : '❌ Automod is **disabled**.'
  }).addFields(
    { name: '📋 Rules', value: rules || 'No rules configured.', inline: false },
    { name: '📝 Logging', value: formatBoolean(settings.automod.logActions), inline: true }
  );
}

// ─── Case Embeds ──────────────────────────────────────────────────────────────

export function buildCaseEmbed(moderationCase) {
  if (!moderationCase) {
    return buildErrorEmbed('Case not found', 'No matching moderation case was found.');
  }

  return buildBaseEmbed({
    title: `⚖️ Moderation Case #${moderationCase.caseId}`,
    description: `Action: \`${moderationCase.actionType}\``
  }).addFields(
    { name: '🎯 Target', value: `<@${moderationCase.targetUserId}>`, inline: true },
    { name: '🛡️ Moderator', value: `<@${moderationCase.moderatorId}>`, inline: true },
    { name: '📌 Status', value: moderationCase.status, inline: true },
    { name: '📝 Reason', value: moderationCase.reason, inline: false }
  );
}

export function buildCaseListEmbed(cases) {
  const description = cases.length
    ? cases
        .map(
          (moderationCase) =>
            `**#${moderationCase.caseId}** \`${moderationCase.actionType}\` <@${moderationCase.targetUserId}> — ${moderationCase.reason}`
        )
        .join('\n')
        .slice(0, 4096)
    : 'No moderation cases found.';

  return buildBaseEmbed({
    title: '📋 Moderation Cases',
    description
  });
}

export function buildCaseStatsEmbed(stats) {
  const byAction =
    Object.entries(stats.byAction)
      .map(([action, count]) => `\`${action}\`: ${count}`)
      .join('\n') || 'None';

  const byStatus =
    Object.entries(stats.byStatus)
      .map(([status, count]) => `\`${status}\`: ${count}`)
      .join('\n') || 'None';

  return buildBaseEmbed({
    title: '📊 Moderation Case Stats',
    description: `${stats.total} total active or resolved case(s).`
  }).addFields(
    { name: '⚡ By Action', value: byAction, inline: true },
    { name: '📌 By Status', value: byStatus, inline: true }
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function buildDashboardEmbed({ dashboardUrl }) {
  return buildBaseEmbed({
    title: `🌐 ${BOT.name} Dashboard`,
    description: dashboardUrl
      ? `Dashboard foundation is available at ${dashboardUrl}.`
      : 'Dashboard contracts and planning are scaffolded. A production web dashboard is not enabled yet.'
  }).addFields({
    name: '📋 Current Scope',
    value: 'Settings, automod, moderation cases, and API contracts are prepared for a future web surface.'
  });
}
