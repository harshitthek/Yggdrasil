import { createWriteStream, existsSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { getVoiceConnection, joinVoiceChannel, EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import ffmpegStatic from 'ffmpeg-static';
import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logger } from '../utils/logger.js';
import { buildBaseEmbed, buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
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
  async startRecording({ guild, voiceChannel, owner, textChannel, durationMs = 3600000, voiceConnection }) {
    const guildId = guild.id;
    if (this.activeRecordings.has(guildId)) {
      throw new Error('A voice recording is already active in this server.');
    }

    // Undeafen the bot first so Discord sends audio packets
    try {
      const me = guild.members.me;
      if (me?.voice?.channel) {
        await me.voice.setDeaf(false).catch(() => {});
      }
    } catch {}

    let connection = voiceConnection || getVoiceConnection(guildId);
    if (!connection && voiceChannel) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });
    }

    if (!connection || !connection.receiver) {
      throw new Error('The bot is not connected to a voice channel in this server.');
    }

    const timestamp = Date.now();
    const pcmPath = join(RECORDINGS_DIR, `rec_${guildId}_${timestamp}.pcm`);
    const mp3Path = join(RECORDINGS_DIR, `rec_${guildId}_${timestamp}.mp3`);
    const pcmStream = createWriteStream(pcmPath);

    const receiver = connection.receiver;
    const speakingSubscriptions = new Map();

    const handleSpeakingStart = (userId) => {
      if (speakingSubscriptions.has(userId)) return;

      try {
        const opusStream = receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 1000
          }
        });

        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
        opusStream.pipe(decoder);

        decoder.on('data', (chunk) => {
          if (!session.isStopping && pcmStream.writable) {
            pcmStream.write(chunk);
          }
        });

        decoder.on('error', () => {});
        opusStream.on('error', () => {});

        opusStream.on('end', () => {
          speakingSubscriptions.delete(userId);
        });

        speakingSubscriptions.set(userId, { opusStream, decoder });
      } catch (err) {
        logger.warn(`[Recording] Failed to subscribe to audio for user ${userId}:`, err);
      }
    };

    receiver.speaking.on('start', handleSpeakingStart);

    const session = {
      guildId,
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
      handleSpeakingStart,
      speakingSubscriptions,
      isStopping: false,
      reminderTimer: null,
      stopTimer: null
    };

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

    // Unregister speaking listener
    try {
      session.receiver.speaking.off('start', session.handleSpeakingStart);
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

    // Re-deafen the bot
    try {
      const client = session.owner.client;
      const guild = client.guilds.cache.get(guildId);
      if (guild?.members?.me?.voice?.channel) {
        await guild.members.me.voice.setDeaf(true).catch(() => {});
      }
    } catch {}

    this.activeRecordings.delete(guildId);

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - session.startTime) / 1000));
    const elapsedMinutes = (elapsedSeconds / 60).toFixed(1);

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

      const proc = spawn(ffmpegPath, args, { stdio: 'ignore' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });

    // Clean up PCM file
    try {
      if (existsSync(session.pcmPath)) unlinkSync(session.pcmPath);
    } catch {}

    if (!encoded || !existsSync(session.mp3Path)) {
      throw new Error('Failed to encode audio recording to MP3.');
    }

    const fileSizeMb = (statSync(session.mp3Path).size / (1024 * 1024)).toFixed(2);
    const attachment = new AttachmentBuilder(session.mp3Path, {
      name: `recording_${session.guildName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.mp3`
    });

    // Send audio attachment and report to Owner DM
    try {
      await session.owner.send({
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
      logger.info(`[Recording] Successfully delivered MP3 recording (${fileSizeMb}MB) to owner ${session.ownerId}.`);
    } catch (err) {
      logger.error(`[Recording] Failed to DM audio file to owner:`, err);
      // Fallback: Notify in text channel if DM closed
      if (session.textChannel) {
        await session.textChannel
          .send({
            content: `<@${session.ownerId}>`,
            embeds: [
              buildErrorEmbed(
                'Recording DM Failed',
                'Your recording was completed, but I could not DM you the file. Please check your DM privacy settings.'
              )
            ]
          })
          .catch(() => {});
      }
    } finally {
      // Clean up MP3 file after delivery
      setTimeout(() => {
        try {
          if (existsSync(session.mp3Path)) unlinkSync(session.mp3Path);
        } catch {}
      }, 30000);
    }

    return {
      guildName: session.guildName,
      voiceChannelName: session.voiceChannelName,
      durationSeconds: elapsedSeconds,
      fileSizeMb
    };
  }
}

export const recordingService = new RecordingService();
