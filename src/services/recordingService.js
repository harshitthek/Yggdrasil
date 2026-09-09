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

    // Undeafen the bot in the guild and dispatch Voice Gateway Opcode 4 (self_deaf: false)
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

    let connection = (voiceConnection?.receiver ? voiceConnection : null) || getVoiceConnection(guildId);
    if ((!connection || !connection.receiver) && voiceChannel) {
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

    // Initialize session state BEFORE registering listeners (prevents TDZ ReferenceError)
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
          }
        });

        decoder.on('error', (err) => {
          logger.debug(`[Recording] Decoder notice for user ${userId}: ${err.message}`);
        });
        opusStream.on('error', (err) => {
          logger.debug(`[Recording] Opus stream notice for user ${userId}: ${err.message}`);
        });

        opusStream.on('end', () => {
          speakingSubscriptions.delete(userId);
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

    // Re-deafen the bot member and gateway voice state
    try {
      const client = session.owner.client;
      const guild = client.guilds.cache.get(guildId);
      if (guild?.members?.me?.voice?.channel) {
        await guild.members.me.voice.setDeaf(true).catch(() => {});
      }
      if (guild?.shard) {
        guild.shard.send({
          op: 4,
          d: {
            guild_id: guild.id,
            channel_id: session.voiceChannelId,
            self_mute: false,
            self_deaf: true
          }
        });
      }
    } catch {}

    this.activeRecordings.delete(guildId);

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - session.startTime) / 1000));
    const elapsedMinutes = (elapsedSeconds / 60).toFixed(1);

    // Verify audio data was received
    const pcmExists = existsSync(session.pcmPath);
    const pcmSize = pcmExists ? statSync(session.pcmPath).size : 0;

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
