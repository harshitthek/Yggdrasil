import { createWriteStream, existsSync, mkdirSync, unlinkSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
  EndBehaviorType,
  StreamType
} from '@discordjs/voice';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logger } from '../utils/logger.js';
import { buildBaseEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { COLORS } from '../utils/constants.js';

const RECORDINGS_DIR = join(process.cwd(), 'storage', 'recordings');
if (!existsSync(RECORDINGS_DIR)) {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
}

export function getFfmpegPath() {
  const candidates = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', ffmpegStatic, 'ffmpeg'];
  for (const c of candidates) {
    if (c && typeof c === 'string' && existsSync(c)) return c;
  }
  return 'ffmpeg';
}

class RecordingService {
  constructor() {
    /** @type {Map<string, Object>} */
    this.activeRecordings = new Map();
  }

  isRecording(guildId) {
    return this.activeRecordings.has(guildId);
  }

  getRecording(guildId) {
    return this.activeRecordings.get(guildId) ?? null;
  }

  /**
   * Starts voice channel audio recording.
   */
  async startRecording({
    guild,
    voiceChannel,
    owner,
    textChannel,
    durationMs = 3600000,
    voiceConnection = null,
    appContext = null
  }) {
    const guildId = guild.id;
    if (this.activeRecordings.has(guildId)) {
      throw new Error('A voice recording is already active in this server.');
    }

    if (!voiceChannel && !voiceConnection) {
      throw new Error('The bot is not connected to a voice channel in this server.');
    }

    let connection = voiceConnection || getVoiceConnection(guildId);
    if (!connection && voiceChannel) {
      // 1. Release existing discord-player queue so discord-voip releases the voice adapter
      const playerService = appContext?.playerService;
      const existingQueue = playerService?.getGuildQueue(guildId);
      if (existingQueue) {
        logger.info(`[Recording] Releasing discord-player queue for guild ${guildId} to allow voice receiver.`);
        try {
          existingQueue.delete();
        } catch (err) {
          logger.warn(`[Recording] Notice while deleting existing queue: ${err.message}`);
        }
      }

      // 2. Connect or attach cleanly using @discordjs/voice without leaving the voice channel
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
        logger.info(`[Recording] Voice connection READY in "${voiceChannel.name}" for guild "${guild.name}".`);
      } catch (err) {
        try {
          connection.destroy();
        } catch {}
        throw new Error(`Failed to establish voice connection: ${err.message}`, { cause: err });
      }
    }

    if (!connection || !connection.receiver) {
      throw new Error('The bot is not connected to a voice channel in this server.');
    }

    // 5. Undeafen and unmute bot on Discord gateway
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

    // 6. Warm up Discord voice UDP NAT tunnel by transmitting a 1-frame Opus silence packet
    try {
      const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
      const silenceStream = new Readable({
        read() {
          this.push(SILENCE_FRAME);
          this.push(null);
        }
      });
      const player = createAudioPlayer();
      const resource = createAudioResource(silenceStream, {
        inputType: StreamType.Opus
      });
      player.play(resource);
      connection.subscribe(player);
      logger.info(`[Recording] Warm-up silence frame sent to Discord voice mixer.`);
    } catch (err) {
      logger.warn(`[Recording] Notice while sending warm-up packet: ${err.message}`);
    }

    const timestamp = Date.now();
    const pcmPath = join(RECORDINGS_DIR, `rec_${guildId}_${timestamp}.pcm`);
    const mp3Path = join(RECORDINGS_DIR, `rec_${guildId}_${timestamp}.mp3`);
    const pcmStream = createWriteStream(pcmPath);

    const receiver = connection.receiver;
    const speakingSubscriptions = new Map();

    // Initialize session state BEFORE registering listeners (prevents TDZ ReferenceError)
    const session = {
      guildId,
      guild,
      guildName: guild.name,
      voiceChannelId: voiceChannel.id,
      voiceChannelName: voiceChannel.name,
      ownerId: owner.id,
      owner,
      textChannel,
      startTime: timestamp,
      durationMs,
      pcmPath,
      mp3Path,
      pcmStream,
      receiver,
      connection,
      speakingSubscriptions,
      bytesWritten: 0,
      isStopping: false,
      reminderTimer: null,
      stopTimer: null,
      handleSpeakingStart: null
    };

    const handleSpeakingStart = (userId) => {
      if (session.isStopping || speakingSubscriptions.has(userId)) return;

      logger.info(`[Recording] User ${userId} speaking detected. Subscribing to audio stream.`);

      try {
        const opusStream = receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.Manual
          }
        });

        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
        opusStream.pipe(decoder);

        decoder.on('data', (chunk) => {
          if (!session.isStopping && pcmStream.writable) {
            session.bytesWritten += chunk.length;
            pcmStream.write(chunk);
            if (session.bytesWritten % 192000 < chunk.length) {
              logger.info(`[Recording] Captured ${session.bytesWritten} bytes of PCM audio from voice channel.`);
            }
          }
        });

        opusStream.on('error', (err) => {
          logger.warn(`[Recording] Opus stream notice for user ${userId}: ${err.message}`);
          speakingSubscriptions.delete(userId);
        });

        opusStream.on('close', () => {
          logger.debug(`[Recording] Opus stream closed for user ${userId}`);
          speakingSubscriptions.delete(userId);
        });

        decoder.on('error', (err) => {
          logger.warn(`[Recording] Decoder notice for user ${userId}: ${err.message}`);
        });

        speakingSubscriptions.set(userId, { opusStream, decoder });
      } catch (err) {
        logger.warn(`[Recording] Failed to subscribe to audio for user ${userId}:`, err);
      }
    };

    session.handleSpeakingStart = handleSpeakingStart;
    receiver.speaking.on('start', handleSpeakingStart);

    // Pre-subscribe to any active non-bot members already in the voice channel
    if (voiceChannel.members) {
      for (const [memberId, member] of voiceChannel.members) {
        if (!member.user.bot) {
          logger.info(`[Recording] Pre-subscribing to member ${memberId} in voice channel.`);
          handleSpeakingStart(memberId);
        }
      }
    }

    // 15-Minute Progress Reminder
    const reminderDelay = Math.min(15 * 60 * 1000, durationMs - 60000);
    if (reminderDelay > 0) {
      session.reminderTimer = setTimeout(async () => {
        try {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`rec_stop_${guildId}`)
              .setLabel('Stop & Save Recording')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('⏹️')
          );

          const elapsedMin = Math.round((Date.now() - session.startTime) / 60000);
          await owner.send({
            embeds: [
              buildBaseEmbed({
                title: '🎙️ Voice Recording In Progress',
                description:
                  `You have an active recording in **#${voiceChannel.name}** in **${guild.name}**.\n\n` +
                  `⏱️ **Elapsed Time:** ${elapsedMin} minutes\n` +
                  `⏳ **Max Duration:** ${Math.round(durationMs / 60000)} minutes\n\n` +
                  `The recording will automatically stop when the duration expires, or click below to stop now.`,
                color: COLORS.warning
              })
            ],
            components: [row]
          });
        } catch (err) {
          logger.warn('[Recording] Could not send 15m reminder DM to owner:', err);
        }
      }, reminderDelay);
    }

    // Auto-Stop Timer
    session.stopTimer = setTimeout(async () => {
      logger.info(`[Recording] Max duration reached for guild ${guildId}. Finalizing recording.`);
      try {
        await this.stopRecording(guildId);
      } catch (err) {
        logger.error('[Recording] Failed during auto-stop recording:', err);
      }
    }, durationMs);

    this.activeRecordings.set(guildId, session);
    logger.info(`[Recording] Started recording in "${voiceChannel.name}" for guild "${guild.name}".`);

    return session;
  }

  /**
   * Stops recording, encodes to MP3, delivers to owner's DM, and cleans up.
   */
  async stopRecording(guildId) {
    const session = this.activeRecordings.get(guildId);
    if (!session) {
      throw new Error('No active recording found for this server.');
    }

    if (session.isStopping) {
      return session;
    }
    session.isStopping = true;

    if (session.reminderTimer) clearTimeout(session.reminderTimer);
    if (session.stopTimer) clearTimeout(session.stopTimer);

    // Unregister speaking listener and tear down active streams
    try {
      if (session.handleSpeakingStart) {
        session.receiver.speaking.off('start', session.handleSpeakingStart);
      }
      for (const [, sub] of session.speakingSubscriptions) {
        try {
          sub.opusStream.destroy();
          sub.decoder.destroy();
        } catch {}
      }
      session.speakingSubscriptions.clear();
    } catch {}

    // End raw stream writing
    await new Promise((resolve) => {
      session.pcmStream.end(() => resolve());
    });

    this.activeRecordings.delete(guildId);

    const client = session.owner?.client || session.guild?.client;
    const appContext = client?.appContext;
    const settingsService = appContext?.settingsService;
    let is247Enabled = false;
    if (settingsService) {
      try {
        const settings = await settingsService.getEffectiveSettings(guildId);
        is247Enabled = Boolean(settings?.twentyFourSeven?.enabled);
      } catch {}
    }

    if (is247Enabled) {
      logger.info(`[Recording] 24/7 mode active for guild ${guildId} — maintaining voice connection in channel.`);
      try {
        const guild = client?.guilds?.cache?.get(guildId) || session.guild;
        if (guild?.members?.me?.voice?.channel) {
          await guild.members.me.voice.setDeaf(true).catch(() => {});
        }
      } catch {}
    } else {
      try {
        session.connection?.destroy?.();
      } catch {}
    }

    if (!is247Enabled && client && appContext) {
      import('./musicService.js')
        .then(({ reconnect247Guilds }) => reconnect247Guilds(client, appContext, { quiet: true }))
        .catch(() => {});
    }

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - session.startTime) / 1000));
    const elapsedMinutes = (elapsedSeconds / 60).toFixed(1);

    // Verify audio data was received
    const pcmExists = existsSync(session.pcmPath);
    const pcmSize = pcmExists ? statSync(session.pcmPath).size : 0;

    logger.info(`[Recording] Finalizing session: bytesWritten=${session.bytesWritten}, pcmSize=${pcmSize}`);

    if (session.bytesWritten === 0 || pcmSize === 0) {
      try {
        if (pcmExists) unlinkSync(session.pcmPath);
      } catch {}

      throw new Error(
        'No audio was detected during the recording session. Make sure members were speaking in the voice channel.'
      );
    }

    // Convert raw PCM to MP3 using FFmpeg
    const ffmpegPath = getFfmpegPath();
    const encoded = await new Promise((resolve) => {
      const args = [
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-i',
        session.pcmPath,
        '-b:a',
        '192k',
        '-y',
        session.mp3Path
      ];

      const proc = spawn(ffmpegPath, args);
      let stderr = '';
      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }
      proc.on('close', (code) => {
        if (code !== 0) {
          logger.warn(`[Recording] FFmpeg exited with code ${code}. Stderr: ${stderr.slice(-200)}`);
        }
        resolve(code === 0);
      });
      proc.on('error', (err) => {
        logger.error('[Recording] FFmpeg process error:', err);
        resolve(false);
      });
    });

    // Clean up PCM file
    try {
      if (existsSync(session.pcmPath)) unlinkSync(session.pcmPath);
    } catch {}

    if (!encoded || !existsSync(session.mp3Path) || statSync(session.mp3Path).size === 0) {
      try {
        if (existsSync(session.mp3Path)) unlinkSync(session.mp3Path);
      } catch {}
      throw new Error('Failed to encode audio recording to MP3.');
    }

    const fileBuffer = readFileSync(session.mp3Path);
    const fileSizeMb = (statSync(session.mp3Path).size / (1024 * 1024)).toFixed(2);
    const safeGuildName = session.guildName ? session.guildName.replace(/[^a-zA-Z0-9]/g, '_') : 'recording';
    const filename = `recording_${safeGuildName}_${new Date().toISOString().slice(0, 10)}.mp3`;
    const attachment = new AttachmentBuilder(fileBuffer, { name: filename });

    // Deliver audio attachment to owner's DM with automatic retry and channel fallback
    let delivered = false;
    let targetUser = session.owner;
    if (client?.users && session.ownerId) {
      targetUser = await client.users.fetch(session.ownerId).catch(() => session.owner);
    }

    try {
      await targetUser.send({
        embeds: [
          buildSuccessEmbed(
            '🎙️ Voice Recording Complete',
            `Here is your private voice recording.\n\n` +
              `📍 **Server:** ${session.guildName}\n` +
              `🔊 **Channel:** #${session.voiceChannelName}\n` +
              `⏱️ **Duration:** ${elapsedMinutes} minutes (${elapsedSeconds}s)\n` +
              `💾 **File Size:** ${fileSizeMb} MB\n\n` +
              `*The audio file is attached below for download or immediate playback.*`
          )
        ],
        files: [attachment]
      });
      delivered = true;
      logger.info(`[Recording] Successfully delivered MP3 recording (${fileSizeMb}MB) to owner ${session.ownerId}.`);
    } catch (err) {
      logger.warn(`[Recording] Direct user.send notice (${err.message}), retrying via createDM...`);
      try {
        const dmChannel = await targetUser.createDM();
        await dmChannel.send({
          embeds: [
            buildSuccessEmbed(
              '🎙️ Voice Recording Complete',
              `Here is your private voice recording.\n\n` +
                `📍 **Server:** ${session.guildName}\n` +
                `🔊 **Channel:** #${session.voiceChannelName}\n` +
                `⏱️ **Duration:** ${elapsedMinutes} minutes (${elapsedSeconds}s)\n` +
                `💾 **File Size:** ${fileSizeMb} MB`
            )
          ],
          files: [new AttachmentBuilder(fileBuffer, { name: filename })]
        });
        delivered = true;
        logger.info(`[Recording] Successfully delivered MP3 recording on retry to owner ${session.ownerId}.`);
      } catch (retryErr) {
        logger.error(`[Recording] Retry DM delivery failed:`, retryErr);
      }
    }

    if (!delivered && session.textChannel) {
      try {
        await session.textChannel.send({
          content: `⚠️ <@${session.ownerId}> Could not deliver to your Direct Messages (privacy settings may be blocking bot DMs). Here is your recording:`,
          files: [new AttachmentBuilder(fileBuffer, { name: filename })]
        });
        logger.info(`[Recording] Delivered recording to text channel fallback #${session.textChannel.name}`);
      } catch (fallbackErr) {
        logger.error(`[Recording] Failed to deliver to text channel fallback:`, fallbackErr);
      }
    }

    // Clean up MP3 file after delivery
    const cleanupTimer = setTimeout(() => {
      try {
        if (existsSync(session.mp3Path)) unlinkSync(session.mp3Path);
      } catch {}
    }, 30000);
    cleanupTimer?.unref?.();

    return {
      guildName: session.guildName,
      voiceChannelName: session.voiceChannelName,
      durationSeconds: elapsedSeconds,
      fileSizeMb
    };
  }
}

export const recordingService = new RecordingService();
