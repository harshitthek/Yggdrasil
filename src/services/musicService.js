import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { YoutubeExtractor } from 'discord-player-youtubei';
import { QUEUE_DEFAULTS, VOICE_CONNECTION_OPTIONS } from '../config/queueDefaults.js';
import { buildNowPlayingEmbed, buildSuccessEmbed, buildErrorEmbed, buildNeutralEmbed } from '../utils/embeds.js';
import { buildMusicPlayerComponents } from '../utils/components.js';
import { logger } from '../utils/logger.js';
import { WorldTreeYoutubeExtractor } from './music/youtube/WorldTreeYoutubeExtractor.js';
import { runYoutubeDiagnostic } from './music/youtube/YoutubeDiagnostic.js';

// ─── MUSIC_DEBUG helpers ────────────────────────────────────────────────────

const isDebug = () => process.env.MUSIC_DEBUG === 'true';

function dbg(queue, msg) {
  if (!isDebug()) return;
  const cid = queue?.metadata?.correlationId || '[MUSIC:SYS]';
  const t0 = queue?.metadata?.playbackStartedAt;
  const offset = t0 ? `+${Date.now() - t0}ms` : '+?ms';
  logger.info(`${cid} ${offset} ${msg}`);
}

function dbgErr(queue, msg, error) {
  if (!isDebug()) return;
  const cid = queue?.metadata?.correlationId || '[MUSIC:SYS]';
  const t0 = queue?.metadata?.playbackStartedAt;
  const offset = t0 ? `+${Date.now() - t0}ms` : '+?ms';
  logger.error(`${cid} ${offset} ${msg}`, {
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error
  });
}

const LOCAL_YOUTUBE_EXTRACTOR_ID = WorldTreeYoutubeExtractor.identifier;

/**
 * Select the one active YouTube ownership boundary for this process.
 *
 * @param {boolean} useLocalYoutubeExtractor Whether the staged local path is enabled.
 * @returns {{extractor: typeof WorldTreeYoutubeExtractor | typeof YoutubeExtractor, options: object, label: string}}
 * Extractor registration details.
 */
export function getYoutubeExtractorRegistration(useLocalYoutubeExtractor = false) {
  if (useLocalYoutubeExtractor) {
    return {
      extractor: WorldTreeYoutubeExtractor,
      options: {},
      label: LOCAL_YOUTUBE_EXTRACTOR_ID
    };
  }

  return {
    extractor: YoutubeExtractor,
    options: {
      streamOptions: {
        useClient: 'IOS',
        generateWithPoToken: true
      }
    },
    label: 'YoutubeExtractor'
  };
}

/**
 * Prevent a local YouTube track from falling through discord-player's generic
 * cross-provider fallback path. Non-local tracks keep the existing behavior.
 *
 * @param {boolean} useLocalYoutubeExtractor Whether the local path is enabled.
 * @returns {(track: import('discord-player').Track, queryType: string, queue: import('discord-player').GuildQueue) => Promise<import('discord-player').ExtractorStreamable | null>}
 * Queue hook used by discord-player before generic stream extraction.
 */
export function createLocalYoutubeStreamGuard(useLocalYoutubeExtractor = false) {
  return async (track, _queryType, queue) => {
    if (!useLocalYoutubeExtractor || track?.extractor?.identifier !== LOCAL_YOUTUBE_EXTRACTOR_ID) {
      return null;
    }

    const extractor = queue?.player?.extractors?.get(LOCAL_YOUTUBE_EXTRACTOR_ID);
    if (!extractor) {
      const error = new Error('The local YouTube extractor is not registered.');
      error.code = 'YT_DEPENDENCY_MISSING';
      throw error;
    }

    return extractor.stream(track);
  };
}

// ─── Safe channel sender ────────────────────────────────────────────────────

function safeSend(queue, payload) {
  try {
    const channel = queue?.metadata?.channel;
    if (channel?.send) {
      channel.send(payload).catch((err) => {
        logger.warn('Failed to send music event message.', err);
      });
    }
  } catch (err) {
    logger.error('Unexpected error in safeSend.', err);
  }
}

// ─── Source detection helper ────────────────────────────────────────────────

function getSourceEmoji(track) {
  const src = (track.source || track.raw?.source || '').toLowerCase();
  if (src.includes('spotify')) return '🟢';
  if (src.includes('apple')) return '🍎';
  if (src.includes('youtube')) return '🔴';
  if (src.includes('soundcloud')) return '🟠';
  return '🎵';
}

function getSourceLabel(track) {
  const src = (track.source || track.raw?.source || '').toLowerCase();
  if (src.includes('spotify')) return 'Spotify';
  if (src.includes('apple')) return 'Apple Music';
  if (src.includes('youtube')) return 'YouTube';
  if (src.includes('soundcloud')) return 'SoundCloud';
  return 'Unknown';
}

export { getSourceEmoji, getSourceLabel };

function formatPlaybackError(error, maxLength = 200) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

  return message.slice(0, maxLength);
}

// ─── Phase 2: Deep pipeline instrumentation (MUSIC_DEBUG only) ──────────────

function instrumentDispatcher(queue) {
  if (!isDebug()) return;
  const dispatcher = queue.dispatcher;
  if (!dispatcher) return;

  dbg(queue, 'Instrumenting dispatcher: VoiceConnection + AudioPlayer + Networking');

  // ── VoiceConnection state transitions ──
  let currentNetworking = null;

  dispatcher.voiceConnection.on('stateChange', (oldState, newState) => {
    dbg(queue, `VoiceConnection: ${oldState.status} -> ${newState.status}`);

    if (newState.status === 'signalling' || newState.status === 'disconnected') {
      dbg(
        queue,
        `VoiceConnection close detail: reason="${newState.reason}" ws_close_num=${newState.closeCode} rejoinAttempts=${dispatcher.voiceConnection.rejoinAttempts}`
      );
    }

    // Re-instrument Networking when it changes
    const networking = newState.networking;
    if (networking && networking !== currentNetworking) {
      currentNetworking = networking;
      dbg(queue, 'Networking object changed, attaching listeners');
      networking.on('stateChange', (oldNS, newNS) => {
        dbg(queue, `Networking: ${oldNS.code} -> ${newNS.code}`);
      });
      networking.on('error', (err) => {
        dbgErr(queue, 'Networking error:', err);
      });
      networking.on('close', (code) => {
        dbg(queue, `Networking close: ws_close_num=${code}`);
      });
      networking.on('debug', (msg) => {
        dbg(queue, `Networking debug: ${msg}`);
      });
    }
  });

  dispatcher.voiceConnection.on('error', (err) => {
    dbgErr(queue, 'VoiceConnection error:', err);
  });

  dispatcher.voiceConnection.on('debug', (msg) => {
    dbg(queue, `VoiceConnection debug: ${msg}`);
  });

  // ── AudioPlayer state transitions ──
  dispatcher.audioPlayer.on('stateChange', (oldState, newState) => {
    dbg(queue, `AudioPlayer: ${oldState.status} -> ${newState.status}`);

    // When transitioning to buffering, instrument the AudioResource
    if (newState.status === 'buffering' && newState.resource) {
      instrumentAudioResource(queue, newState.resource);
    }
  });

  dispatcher.audioPlayer.on('error', (error) => {
    dbgErr(queue, `AudioPlayer error: ${error.message}`, error);
    if (error.resource) {
      dbg(
        queue,
        `AudioPlayer error resource: started=${error.resource.started}, ended=${error.resource.ended}, playbackDuration=${error.resource.playbackDuration}ms`
      );
    }
  });
}

function instrumentAudioResource(queue, resource) {
  if (!isDebug()) return;

  dbg(
    queue,
    `AudioResource created: started=${resource.started}, ended=${resource.ended}, silencePaddingFrames=${resource.silencePaddingFrames}, playStream type=${resource.playStream?.constructor?.name}`
  );

  // ── playStream (Readable) lifecycle ──
  const ps = resource.playStream;
  if (ps) {
    ps.on('error', (err) => {
      dbgErr(queue, 'playStream error:', err);
    });
    ps.on('close', () => {
      dbg(
        queue,
        `playStream close: playbackDuration=${resource.playbackDuration}ms, started=${resource.started}, ended=${resource.ended}`
      );
    });
    ps.on('end', () => {
      dbg(queue, `playStream end: playbackDuration=${resource.playbackDuration}ms`);
    });

    // ── FFmpeg process instrumentation ──
    // If the playStream is an FFmpeg Duplex, it has a .process (ChildProcess) property
    if (ps.process) {
      dbg(queue, `FFmpeg process detected (pid=${ps.process.pid})`);
      ps.process.on('exit', (code, signal) => {
        dbg(queue, `FFmpeg exit: code=${code}, signal=${signal}`);
      });
      if (ps.process.stderr) {
        ps.process.stderr.on('data', (chunk) => {
          dbg(queue, `FFmpeg stderr: ${chunk.toString().trim()}`);
        });
      }
    }
  }
}

// ─── Player initialization ──────────────────────────────────────────────────

export async function initializePlayer(client, playerService) {
  const useLocalYoutubeExtractor = client?.appContext?.config?.useLocalYoutubeExtractor === true;
  const player = playerService.setPlayer(
    new Player(client, {
      skipFFmpeg: false
    })
  );

  // 1. Register YouTube extractor first so YouTube is preferred for search and bridging
  try {
    const registration = getYoutubeExtractorRegistration(useLocalYoutubeExtractor);
    await player.extractors.register(registration.extractor, registration.options);

    logger.info(`Music extractors loaded: ${registration.label} + DefaultExtractors`);
  } catch (err) {
    logger.error('Failed to register the active YouTube extractor. Music playback will be unavailable.', err);
  }

  // 2. Load default extractors (Spotify metadata, Apple metadata, SoundCloud, etc.)
  try {
    await player.extractors.loadMulti(DefaultExtractors);
  } catch (err) {
    logger.error('Failed to load DefaultExtractors. Some sources may be unavailable.', err);
  }

  // ─── Player Events ──────────────────────────────────────────────────────

  // Single debug listener — MUSIC_DEBUG gets verbose info, production gets logger.debug
  player.events.on('debug', (queue, message) => {
    if (isDebug()) {
      dbg(queue, `[discord-player] ${message}`);
    }
    logger.debug(`[Player] ${message}`);
  });

  // ── Connection created: attach deep instrumentation ONCE ──
  player.events.on('connection', (queue) => {
    dbg(queue, 'connection event: dispatcher created');
    queue.onBeforeCreateStream = createLocalYoutubeStreamGuard(useLocalYoutubeExtractor);
    instrumentDispatcher(queue);
  });

  client.on('raw', (packet) => {
    if (isDebug() && packet.t === 'VOICE_SERVER_UPDATE') {
      const guildId = packet.d?.guild_id;
      const queue = player.nodes.get(guildId);
      if (queue) {
        dbg(
          queue,
          `[WS] Raw VOICE_SERVER_UPDATE received: endpoint=${packet.d?.endpoint} token_present=${!!packet.d?.token}`
        );
      }
    }
  });

  // ── connectionDestroyed: detect premature teardown ──
  player.events.on('connectionDestroyed', (queue) => {
    dbg(queue, 'connectionDestroyed event: VoiceConnection was destroyed');
  });

  // ── willPlayTrack: confirm stream config before dispatch ──
  player.events.on('willPlayTrack', (queue, track, config, done) => {
    dbg(
      queue,
      `willPlayTrack: "${track.title}" source=${track.source} queryType=${track.queryType} skipFFmpeg=${config?.dispatcherConfig?.skipFFmpeg} streamType=${config?.dispatcherConfig?.type}`
    );
    // Signal that we are done (no modifications to config)
    done();
  });

  // ── playerTrigger: confirms the player actually received the track ──
  player.events.on('playerTrigger', (queue, track, reason) => {
    dbg(queue, `playerTrigger: "${track.title}" reason=${reason}`);
  });

  // ── playerStart: now playing ──
  player.events.on('playerStart', (queue, track) => {
    dbg(queue, `playerStart: "${track.title}" [${track.url}]`);

    if (isDebug()) {
      // Log environment once per playback
      dbg(queue, `Environment: node=${process.version} platform=${process.platform} arch=${process.arch}`);
    }

    const emoji = getSourceEmoji(track);
    try {
      safeSend(queue, {
        embeds: [buildNowPlayingEmbed(track, queue)],
        components: buildMusicPlayerComponents()
      });
    } catch (err) {
      logger.error('Failed to send Now Playing embed on playerStart.', err);
    }
    logger.info(`Now playing: ${emoji} ${track.title} — ${track.author} [${getSourceLabel(track)}]`);
  });

  // ── willAutoPlay: continuous autoplay recommendation with multi-source fallback ──
  player.events.on('willAutoPlay', async (queue, tracks, done) => {
    dbg(queue, `willAutoPlay: candidate count = ${tracks?.length || 0}`);
    try {
      // 1. If extractor provided candidate tracks, filter history and select first unplayed
      if (Array.isArray(tracks) && tracks.length > 0) {
        const historyUrls = new Set(queue.history?.tracks?.map((t) => t.url) ?? []);
        const unplayed = tracks.filter((t) => !historyUrls.has(t.url));
        const chosen = unplayed[0] || tracks[Math.floor(Math.random() * Math.min(tracks.length, 5))];
        if (chosen) {
          dbg(queue, `willAutoPlay: selected candidate track "${chosen.title}"`);
          return done(chosen);
        }
      }

      // 2. If extractor candidates were empty, perform fallback recommendation search using current or seed track
      const seedTrack = queue.currentTrack || queue.history?.currentTrack || queue.history?.tracks?.[0];
      if (seedTrack) {
        const query = seedTrack.author ? `${seedTrack.author} radio` : seedTrack.title;
        dbg(queue, `willAutoPlay: attempting fallback query "${query}"`);
        const searchResult = await player.search(query, {
          requestedBy: seedTrack.requestedBy || client.user
        });
        if (searchResult?.hasTracks()) {
          const historyUrls = new Set(queue.history?.tracks?.map((t) => t.url) ?? []);
          const unplayed = searchResult.tracks.filter((t) => !historyUrls.has(t.url));
          const next = unplayed[0] || searchResult.tracks[0];
          if (next) {
            dbg(queue, `willAutoPlay: fallback selected "${next.title}"`);
            return done(next);
          }
        }
      }
    } catch (err) {
      dbgErr(queue, 'Error in willAutoPlay resolver:', err);
    }

    done(null);
  });

  // ── playerFinish: confirms whether playback completed normally ──
  player.events.on('playerFinish', (queue, track) => {
    dbg(queue, `playerFinish: "${track?.title || 'unknown'}"`);
  });

  const lastErrorSent = new Map();

  function shouldSendError(guildId, error) {
    const errorStr = `${error?.name ?? ''} ${error?.message ?? ''} ${error?.code ?? ''} ${String(error)}`;
    // Suppress internal stream aborts, socket resets, UDP IP discovery, and connection transitions
    if (/abort|discovery|socket|closed|connreset|epipe|network|voiceconnection|destroy/i.test(errorStr)) {
      return false;
    }
    const now = Date.now();
    if (guildId) {
      const lastSent = lastErrorSent.get(guildId) || 0;
      if (now - lastSent < 30000) return false;
      lastErrorSent.set(guildId, now);
    }
    return true;
  }

  // ── playerError: single handler for both logging and user notification ──
  player.events.on('playerError', (queue, error, track) => {
    const trackInfo = track ? `**${track.title}**` : 'the current track';
    dbgErr(queue, `playerError: track="${track?.title || 'unknown'}"`, error);
    logger.error(`Player track error on ${trackInfo}.`, error);

    if (shouldSendError(queue?.guild?.id, error)) {
      safeSend(queue, {
        embeds: [
          buildErrorEmbed(
            'Track Error',
            `Failed to stream ${trackInfo}.\n\`\`\`${formatPlaybackError(error)}\`\`\`\nTry playing it again or use a different source.`
          )
        ]
      });
    }

    if (isDebug() && track) {
      const localYoutubeExtractor = player.extractors.get(LOCAL_YOUTUBE_EXTRACTOR_ID);
      void runYoutubeDiagnostic(track, localYoutubeExtractor, {
        debug: (message) => dbg(queue, `[DIAG] ${message}`),
        debugError: (message, error) => dbgErr(queue, `[DIAG] ${message}`, error)
      });
    }
  });

  // ── playerSkip: track skipped due to extraction failure ──
  player.events.on('playerSkip', (queue, track) => {
    dbg(queue, `playerSkip: "${track.title}" — this is the "error swallowed" path`);
    logger.warn(`Skipped unplayable track: ${track.title} — ${track.author}`);
    safeSend(queue, {
      embeds: [
        buildErrorEmbed(
          'Track Skipped',
          `Could not play **${track.title}**. Skipping to next track.\nThis can happen with age-restricted or region-locked content.`
        )
      ]
    });
  });

  player.events.on('audioTrackAdd', (queue, track) => {
    // Only notify if something is already playing (playerStart handles the first track)
    if (queue.isPlaying()) {
      const emoji = getSourceEmoji(track);
      const position = queue.tracks?.data?.length ?? queue.tracks?.size ?? 1;
      safeSend(queue, {
        embeds: [
          buildSuccessEmbed(
            `${emoji} Track Queued`,
            `**[${track.title}](${track.url})**\nby **${track.author}** · \`${track.duration}\`\n\n📍 Position in queue: **#${position}**`
          )
        ]
      });
    }
  });

  player.events.on('audioTracksAdd', (queue, tracks) => {
    safeSend(queue, {
      embeds: [buildSuccessEmbed('📋 Tracks Queued', `Added **${tracks.length}** tracks to the queue.`)]
    });
  });

  player.events.on('disconnect', (queue) => {
    dbg(queue, 'disconnect event: bot left the voice channel');
    safeSend(queue, {
      embeds: [buildNeutralEmbed('Disconnected', 'Left the voice channel. See you next time! 👋')]
    });
  });

  player.events.on('emptyChannel', (queue) => {
    dbg(queue, 'emptyChannel event');
    if (!queue.metadata?.is247) {
      safeSend(queue, {
        embeds: [buildNeutralEmbed('Empty Channel', 'Everyone left the voice channel. Disconnecting...')]
      });
    }
  });

  player.events.on('emptyQueue', (queue) => {
    dbg(queue, 'emptyQueue event');
    if (!queue.metadata?.is247) {
      safeSend(queue, {
        embeds: [buildNeutralEmbed('Queue Finished', 'No more tracks in the queue. Add more with `tree play`!')]
      });
    }
  });

  // ── error: GuildQueue-level errors bubbled from StreamDispatcher ──
  player.events.on('error', (queue, error) => {
    dbgErr(queue, 'GuildQueue error event:', error);
    logger.error('Player error.', error);

    if (shouldSendError(queue?.guild?.id, error)) {
      safeSend(queue, {
        embeds: [
          buildErrorEmbed(
            'Playback Error',
            `Something went wrong during playback.\n\`\`\`${formatPlaybackError(error)}\`\`\``
          )
        ]
      });
    }
  });

  player.extractors.on('error', (_context, extractor, error) => {
    logger.error(`Music extractor error: ${extractor?.identifier ?? 'unknown'}`, error);
  });

  logger.info('Music player initialized successfully.');
}

// ─── 24/7 Watchdog State & Circuit Breakers ────────────────────────────────
const reconnectFailures = new Map(); // guildId -> { count, nextRetryTime }
const MAX_CONSECUTIVE_FAILURES = 5;
const CIRCUIT_BREAKER_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes backoff after 5 failures

/**
 * Reconnects 24/7 enabled voice channels across all guilds on bot startup or watchdog tick.
 *
 * @param {import('discord.js').Client} client
 * @param {object} appContext
 * @param {object} [options]
 * @param {boolean} [options.quiet=false]
 * @returns {Promise<void>}
 */
export async function reconnect247Guilds(client, appContext, { quiet = false } = {}) {
  const settingsService = appContext?.settingsService;
  const player = appContext?.playerService?.getPlayer();
  if (!settingsService || !player || !client) return;

  try {
    const records = await settingsService.getAll247Guilds();
    if (!Array.isArray(records) || records.length === 0) return;

    const now = Date.now();

    for (const record of records) {
      const guildId = record.guildId;
      const voiceChannelId = record.twentyFourSeven?.voiceChannelId;
      const textChannelId = record.twentyFourSeven?.textChannelId;
      if (!guildId || !voiceChannelId) continue;

      // Circuit-breaker check: back off if too many consecutive failures
      const failureState = reconnectFailures.get(guildId);
      if (failureState && failureState.count >= MAX_CONSECUTIVE_FAILURES && now < failureState.nextRetryTime) {
        continue;
      }

      try {
        const guild =
          client.guilds?.cache?.get(guildId) ??
          (typeof client.guilds?.fetch === 'function' ? await client.guilds.fetch(guildId).catch(() => null) : null);
        if (!guild) continue;

        const voiceChannel =
          guild.channels?.cache?.get(voiceChannelId) ??
          (typeof guild.channels?.fetch === 'function'
            ? await guild.channels.fetch(voiceChannelId).catch(() => null)
            : null);

        // Case 1: Target voice channel was deleted or converted to non-voice
        if (!voiceChannel || (typeof voiceChannel.isVoiceBased === 'function' && !voiceChannel.isVoiceBased())) {
          logger.warn(
            `[24/7 Watchdog] Target voice channel ${voiceChannelId} was deleted or invalid in "${guild.name}". Disabling 24/7 mode.`
          );
          await settingsService
            .set247(guildId, {
              enabled: false,
              voiceChannelId: null,
              textChannelId: null
            })
            .catch(() => null);
          reconnectFailures.delete(guildId);
          continue;
        }

        // Case 2: Bot permissions check
        const botMember =
          guild.members?.me ??
          (typeof guild.members?.fetchMe === 'function' ? await guild.members.fetchMe().catch(() => null) : null);
        if (botMember && typeof voiceChannel.permissionsFor === 'function') {
          const permissions = voiceChannel.permissionsFor(botMember);
          if (permissions && (!permissions.has('ViewChannel') || !permissions.has('Connect'))) {
            logger.warn(
              `[24/7 Watchdog] Missing ViewChannel/Connect permission in "${voiceChannel.name}" (${guild.name}). Skipping.`
            );
            continue;
          }

          // Case 3: Channel capacity check (user limit exceeded)
          if (
            voiceChannel.userLimit > 0 &&
            voiceChannel.members?.size >= voiceChannel.userLimit &&
            !permissions?.has('MoveMembers') &&
            !voiceChannel.members?.has(botMember.id)
          ) {
            logger.warn(
              `[24/7 Watchdog] Channel "${voiceChannel.name}" is full in "${guild.name}". Backing off until space opens.`
            );
            continue;
          }
        }

        const currentBotVoiceId = guild.members?.me?.voice?.channelId;
        let queue = player.nodes.get(guildId);

        // If already connected properly in the target voice channel with an active connection, do nothing
        if (currentBotVoiceId === voiceChannelId && queue?.connection) {
          reconnectFailures.delete(guildId);
          continue;
        }

        const textChannel = textChannelId
          ? (guild.channels?.cache?.get(textChannelId) ??
            (typeof guild.channels?.fetch === 'function'
              ? await guild.channels.fetch(textChannelId).catch(() => null)
              : null))
          : null;

        if (!queue) {
          queue = player.nodes.create(guild, {
            ...QUEUE_DEFAULTS,
            metadata: {
              channel: textChannel,
              is247: true
            },
            leaveOnEmpty: false,
            leaveOnEnd: false
          });
        } else {
          queue.metadata = { ...(queue.metadata ?? {}), is247: true };
          queue.options.leaveOnEmpty = false;
          queue.options.leaveOnEnd = false;
        }

        if (!queue.connection || currentBotVoiceId !== voiceChannelId) {
          await queue.connect(voiceChannel, VOICE_CONNECTION_OPTIONS);
          reconnectFailures.delete(guildId);
          if (!quiet) {
            logger.info(`[24/7] Restored voice connection to "${voiceChannel.name}" in guild "${guild.name}".`);
          } else {
            logger.info(`[24/7 Watchdog] Reconnected to "${voiceChannel.name}" in guild "${guild.name}".`);
          }
        }
      } catch (err) {
        const prevCount = reconnectFailures.get(guildId)?.count ?? 0;
        const nextCount = prevCount + 1;
        const nextRetry = nextCount >= MAX_CONSECUTIVE_FAILURES ? now + CIRCUIT_BREAKER_BACKOFF_MS : now;
        reconnectFailures.set(guildId, { count: nextCount, nextRetryTime: nextRetry });
        logger.warn(
          `[24/7] Failed to reconnect to guild ${record.guildId} (attempt ${nextCount}/${MAX_CONSECUTIVE_FAILURES}):`,
          err
        );
      }
    }
  } catch (error) {
    logger.error('[24/7] Error restoring 24/7 voice channels:', error);
  }
}

let watchdogInterval = null;

/**
 * Starts a background periodic watchdog timer that guarantees 24/7 presence.
 * If Discord gateway or voice reconnect drops the connection over days, the
 * watchdog auto-heals and reconnects.
 *
 * @param {import('discord.js').Client} client
 * @param {object} appContext
 * @param {number} [intervalMs=45000]
 * @returns {NodeJS.Timeout}
 */
export function start247Watchdog(client, appContext, intervalMs = 45000) {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
  }

  watchdogInterval = setInterval(async () => {
    try {
      if (!client || (typeof client.isReady === 'function' && !client.isReady())) return;
      await reconnect247Guilds(client, appContext, { quiet: true });
    } catch (err) {
      logger.error('[24/7 Watchdog] Error in watchdog tick:', err);
    }
  }, intervalMs);

  if (watchdogInterval.unref) {
    watchdogInterval.unref();
  }

  return watchdogInterval;
}

export function stop247Watchdog() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}
