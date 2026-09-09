import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import ms from 'ms';
import { getAppContext } from '../../context/appContext.js';
import { recordingService } from '../../services/recordingService.js';
import { QUEUE_DEFAULTS, VOICE_CONNECTION_OPTIONS } from '../../config/queueDefaults.js';
import { buildErrorEmbed, buildSuccessEmbed, buildBaseEmbed } from '../../utils/embeds.js';
import { COLORS } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';

export const name = 'record';
export const aliases = ['rec', 'voice-record'];
export const allowNoPrefix = false;
export const botOwnerOnly = true;

export const data = new SlashCommandBuilder()
  .setName('record')
  .setDescription('Owner-only voice channel audio recorder.')
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('Starts recording the voice channel audio.')
      .addStringOption((opt) =>
        opt
          .setName('duration')
          .setDescription('Recording duration (e.g. 30m, 1h, 2h). Defaults to 1 hour.')
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('stop').setDescription('Stops the active recording and sends the file to your DM.')
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Checks the status of the active recording.'));

export function isOwner(userId, appContext, client) {
  const botOwnerId = appContext?.config?.botOwnerId || process.env.BOT_OWNER_ID;
  if (botOwnerId && userId === botOwnerId) return true;
  const owner = client?.application?.owner;
  if (owner) {
    if (owner.id === userId) return true;
    if (owner.ownerId === userId) return true;
    if (owner.ownerUserId === userId) return true;
    if (owner.members?.has?.(userId)) return true;
  }
  return false;
}

export async function executeRecord({ action, durationStr, voiceChannel, user, textChannel, appContext, respond }) {
  const client = appContext?.client || voiceChannel?.client || textChannel?.client;
  if (!isOwner(user.id, appContext, client)) {
    return respond({
      embeds: [buildErrorEmbed('Owner Restricted', 'This command is restricted to the bot owner only.')],
      ephemeral: true
    });
  }

  const guild = voiceChannel?.guild || textChannel?.guild;
  if (!guild) {
    return respond({
      embeds: [buildErrorEmbed('Guild Required', 'This command can only be used in a Discord server.')],
      ephemeral: true
    });
  }

  const guildId = guild.id;

  // ─── STOP ACTION ──────────────────────────────────────────────────────────
  if (action === 'stop') {
    if (!recordingService.isRecording(guildId)) {
      return respond({
        embeds: [buildErrorEmbed('No Active Recording', 'There is no active voice recording running in this server.')]
      });
    }

    await respond({
      embeds: [
        buildBaseEmbed({
          title: '⏳ Processing Audio...',
          description: 'Finalizing voice recording and encoding to MP3. Sending file to your DM...',
          color: COLORS.primary
        })
      ]
    });

    try {
      const result = await recordingService.stopRecording(guildId);
      return respond({
        embeds: [
          buildSuccessEmbed(
            'Recording Saved & Delivered',
            `Recording stopped successfully!\n\n` +
              `⏱️ **Duration:** ${(result.durationSeconds / 60).toFixed(1)} minutes\n` +
              `💾 **File Size:** ${result.fileSizeMb} MB\n\n` +
              `Check your **Direct Messages (DMs)** for the complete audio file.`
          )
        ]
      });
    } catch (err) {
      return respond({
        embeds: [buildErrorEmbed('Recording Failed', `Could not finalize recording: ${err.message}`)]
      });
    }
  }

  // ─── STATUS ACTION ────────────────────────────────────────────────────────
  if (action === 'status') {
    const session = recordingService.getRecording(guildId);
    if (!session) {
      return respond({
        embeds: [buildBaseEmbed({ title: '🎙️ Recording Inactive', description: 'No recording is currently running.' })]
      });
    }

    const elapsed = Math.round((Date.now() - session.startTime) / 1000);
    const maxSec = Math.round(session.durationMs / 1000);

    return respond({
      embeds: [
        buildBaseEmbed({
          title: '🎙️ Active Voice Recording',
          description:
            `📍 **Channel:** #${session.voiceChannelName}\n` +
            `⏱️ **Elapsed:** ${Math.floor(elapsed / 60)}m ${elapsed % 60}s\n` +
            `⏳ **Max Duration:** ${Math.floor(maxSec / 60)} minutes\n\n` +
            `Use \`tree record stop\` or \`/record stop\` to finish and receive the MP3 file in your DM.`,
          color: COLORS.success
        })
      ]
    });
  }

  // ─── START ACTION ─────────────────────────────────────────────────────────
  if (!voiceChannel) {
    return respond({
      embeds: [buildErrorEmbed('Voice Channel Required', 'You must be in a voice channel to start recording.')]
    });
  }

  if (recordingService.isRecording(guildId)) {
    return respond({
      embeds: [
        buildErrorEmbed(
          'Already Recording',
          'A recording is already active in this server. Use `tree record stop` to stop it first.'
        )
      ]
    });
  }

  // Parse duration
  let durationMs = 60 * 60 * 1000; // Default 1 hour
  if (durationStr) {
    const parsed = ms(durationStr);
    if (parsed && parsed >= 10000 && parsed <= 6 * 60 * 60 * 1000) {
      durationMs = parsed;
    } else {
      return respond({
        embeds: [
          buildErrorEmbed(
            'Invalid Duration',
            'Please specify a valid duration between 1 minute and 6 hours (e.g. `30m`, `1h`, `2h`).'
          )
        ]
      });
    }
  }

  // Ensure bot is in voice channel and undeafened
  const playerService = appContext?.playerService;
  const player = playerService?.getPlayer();
  let queue = playerService?.getGuildQueue(guildId);

  if (!queue && player) {
    queue = player.nodes.create(guild, {
      ...QUEUE_DEFAULTS,
      selfDeaf: false,
      metadata: {
        channel: textChannel,
        is247: true
      }
    });
  }

  let voiceConn = queue?.dispatcher?.voiceConnection || queue?.connection;
  if (queue && !queue.connection) {
    try {
      await queue.connect(voiceChannel, { ...VOICE_CONNECTION_OPTIONS, selfDeaf: false, deaf: false });
      voiceConn = queue.dispatcher?.voiceConnection || queue.connection;
    } catch {
      return respond({
        embeds: [buildErrorEmbed('Connection Failed', 'Could not join voice channel.')]
      });
    }
  }

  // Undeafen the bot member in the guild and dispatch Voice Gateway Opcode 4 (self_deaf: false)
  try {
    if (guild.members.me?.voice?.channel) {
      await guild.members.me.voice.setDeaf(false).catch(() => {});
      await guild.members.me.voice.setMute(false).catch(() => {});
    }
    if (guild.shard) {
      guild.shard.send({
        op: 4,
        d: {
          guild_id: guild.id,
          channel_id: voiceChannel.id,
          self_mute: false,
          self_deaf: false
        }
      });
    }
  } catch {}

  try {
    await recordingService.startRecording({
      guild,
      voiceChannel,
      owner: user,
      textChannel,
      durationMs,
      voiceConnection: voiceConn
    });

    const durationDisplay = ms(durationMs, { long: true });
    return respond({
      embeds: [
        buildSuccessEmbed(
          '🎙️ Voice Recording Started',
          `The bot has undeafened and started recording in **#${voiceChannel.name}**.\n\n` +
            `⏱️ **Max Duration:** ${durationDisplay}\n` +
            `🔔 **Reminder:** I will notify you in your DM at 15 minutes.\n` +
            `⏹️ **Stop Command:** Use \`tree record stop\` anytime to finish and get your MP3 file.`
        )
      ]
    });
  } catch (err) {
    return respond({
      embeds: [buildErrorEmbed('Recording Start Failed', err.message)]
    });
  }
}

export async function execute(interaction) {
  const appContext = getAppContext(interaction) ?? {};
  logger.info(
    `[RecordCommand] In execute for user ${interaction.user?.tag || interaction.user?.id} (${interaction.user?.id}), sub: ${interaction.options?.getSubcommand?.(false) || 'default'}`
  );

  // Defer immediately to ensure the 3-second SLA is satisfied
  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });
      logger.info(`[RecordCommand] deferReply success`);
    } catch (err) {
      logger.error(`[RecordCommand] deferReply error:`, err);
      if (err.code === 10062) {
        return;
      }
      throw err;
    }
  }

  const subcommand =
    (typeof interaction.options?.getSubcommand === 'function' ? interaction.options.getSubcommand(false) : null) ||
    'start';
  const durationStr =
    typeof interaction.options?.getString === 'function' ? interaction.options.getString('duration') : null;

  let member = interaction.member;
  if (!member?.voice?.channelId && interaction.guild) {
    member = await interaction.guild.members.fetch(interaction.user.id).catch(() => member);
  }
  let voiceChannel = member?.voice?.channel;
  if (!voiceChannel && member?.voice?.channelId) {
    voiceChannel =
      interaction.guild.channels.cache.get(member.voice.channelId) ||
      (await interaction.guild.channels.fetch(member.voice.channelId).catch(() => null));
  }
  const textChannel = interaction.channel;

  logger.info(`[RecordCommand] Calling executeRecord: action=${subcommand}, vc=${voiceChannel?.name || 'none'}`);

  await executeRecord({
    action: subcommand,
    durationStr,
    voiceChannel,
    user: interaction.user,
    textChannel,
    appContext,
    respond: async (payload) => {
      logger.info(`[RecordCommand] respond payload: ${JSON.stringify(payload)}`);
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(payload);
      } else {
        await interaction.reply(payload);
      }
      logger.info(`[RecordCommand] respond finished`);
    }
  });
}

export async function executeMessage(context) {
  const args = context.args;
  let action = 'start';
  let durationStr = null;

  if (args[0] === 'stop' || args[0] === 'status' || args[0] === 'start') {
    action = args[0];
    durationStr = args[1] || null;
  } else if (args[0]) {
    // If first argument is a duration like 1h, 30m
    durationStr = args[0];
    action = 'start';
  }

  const voiceChannel = context.member?.voice?.channel;
  const textChannel = context.message?.channel;

  await executeRecord({
    action,
    durationStr,
    voiceChannel,
    user: context.user,
    textChannel,
    appContext: context.appContext,
    respond: async (payload) => {
      await context.respond(payload);
    }
  });
}
