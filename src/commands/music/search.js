import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { QueryType } from 'discord-player';
import { getAppContext } from '../../context/appContext.js';
import { buildBaseEmbed, buildErrorEmbed } from '../../utils/embeds.js';
import { executePlay, formatMusicErrorMessage } from './play.js';
import { logger } from '../../utils/logger.js';
import { COLORS } from '../../utils/constants.js';

export const name = 'search';
export const aliases = ['find'];
export const allowNoPrefix = true;
export const requiresSameVoiceChannel = true;

export const data = new SlashCommandBuilder()
  .setName('search')
  .setDescription('Search for a song and pick from results.')
  .addStringOption((option) => option.setName('query').setDescription('Song name or artist').setRequired(true));

// Store search results temporarily for select menu resolution.
// Keyed by a unique component ID so concurrent searches cannot overwrite each other.
const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 60_000;

async function executeSearch(query, voiceChannel, user, textChannel, playerService, respond) {
  if (!voiceChannel) {
    return respond({
      embeds: [buildErrorEmbed('Voice Channel Required', 'You need to be in a voice channel to play music.')]
    });
  }

  const musicPlayer = playerService?.getPlayer();

  if (!musicPlayer) {
    return respond({
      embeds: [buildErrorEmbed('Music Unavailable', 'The music system is not ready yet. Try again in a moment.')]
    });
  }

  let result;
  try {
    const appContext = getAppContext();
    const useLocalYoutubeExtractor = appContext?.config?.useLocalYoutubeExtractor === true;
    const searchEngine = useLocalYoutubeExtractor ? 'ext:WorldTreeYoutube' : QueryType.AUTO_SEARCH;

    result = await musicPlayer.search(query, {
      requestedBy: user,
      searchEngine
    });
  } catch (err) {
    logger.error('Search failed.', err);
    return respond({
      embeds: [
        buildErrorEmbed(
          'Search Failed',
          `Could not search for that query.\n\`\`\`${formatMusicErrorMessage(err)}\`\`\``
        )
      ]
    });
  }

  if (!result || !result.hasTracks()) {
    return respond({
      embeds: [
        buildErrorEmbed(
          'No Results',
          `No results found for **${query}**.\nTry a different search term or paste a direct link.`
        )
      ]
    });
  }

  const tracks = result.tracks.slice(0, 5);
  const cacheKey = `search_select_${user.id}:${randomUUID()}`;
  searchCache.set(cacheKey, {
    userId: user.id,
    tracks,
    voiceChannel,
    textChannel,
    playerService,
    timestamp: Date.now()
  });

  // Auto-clean cache after TTL
  const cleanupTimer = setTimeout(() => {
    const entry = searchCache.get(cacheKey);
    if (entry && Date.now() - entry.timestamp >= SEARCH_CACHE_TTL_MS) {
      searchCache.delete(cacheKey);
    }
  }, SEARCH_CACHE_TTL_MS);
  cleanupTimer.unref?.();

  const options = tracks.map((track, i) => {
    const src = (track.source || '').toLowerCase();
    const emoji = src.includes('spotify')
      ? '🟢'
      : src.includes('youtube')
        ? '🔴'
        : src.includes('soundcloud')
          ? '🟠'
          : '🎵';
    return {
      label: `${track.title}`.slice(0, 100),
      description: `${track.author} · ${track.duration}`.slice(0, 100),
      value: `${i}`,
      emoji
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(cacheKey)
    .setPlaceholder('Pick a track to play...')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  const description = tracks
    .map((t, i) => `**${i + 1}.** [${t.title}](${t.url})\nby **${t.author}** · \`${t.duration}\``)
    .join('\n\n');

  await respond({
    embeds: [
      buildBaseEmbed({
        title: `🔍 Search Results for "${query.slice(0, 50)}"`,
        description,
        color: COLORS.brand
      })
    ],
    components: [row]
  });
}

// Handle the select menu callback
export async function handleSearchSelect(interaction, { cache = searchCache, play = executePlay } = {}) {
  await interaction.deferUpdate();
  const cacheKey = interaction.customId;
  const cached = cache.get(cacheKey);

  if (!cached) {
    return interaction.followUp({
      embeds: [buildErrorEmbed('Search Expired', 'This search has expired. Please run `tree search` again.')],
      flags: 64
    });
  }

  if (cached.userId !== interaction.user.id) {
    return interaction.followUp({
      embeds: [buildErrorEmbed('Not Your Search', 'Only the person who searched can pick a result.')],
      flags: 64
    });
  }

  const trackIndex = parseInt(interaction.values[0], 10);
  const track = cached.tracks[trackIndex];

  if (!track) {
    return interaction.followUp({
      embeds: [buildErrorEmbed('Invalid Selection', 'Could not find that track. Please try again.')],
      flags: 64
    });
  }

  cache.delete(cacheKey);

  // Play the selected track using its URL for exact match
  await play(
    track.url,
    interaction.member?.voice?.channel,
    interaction.user,
    cached.textChannel,
    cached.playerService,
    async (payload) => {
      await interaction.followUp(payload);
    }
  );
}

export async function execute(interaction) {
  await interaction.deferReply();
  const query = interaction.options.getString('query');
  const voiceChannel = interaction.member?.voice?.channel;
  const textChannel = interaction.channel;
  const appContext = getAppContext(interaction) ?? {};
  const playerService = appContext.playerService ?? null;

  await executeSearch(query, voiceChannel, interaction.user, textChannel, playerService, async (payload) => {
    await interaction.editReply(payload);
  });
}

export async function executeMessage(context) {
  const query = context.args.join(' ');

  if (!query) {
    return context.respond({
      embeds: [buildErrorEmbed('Missing Query', 'Usage: `tree search <song name>`')]
    });
  }

  const voiceChannel = context.member.voice.channel;
  const textChannel = context.message.channel;
  const playerService = context.appContext?.playerService ?? null;

  await executeSearch(query, voiceChannel, context.user, textChannel, playerService, async (payload) => {
    await context.respond(payload);
  });
}
