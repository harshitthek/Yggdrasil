import { SlashCommandBuilder } from 'discord.js';
import { getAppContext } from '../../context/appContext.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds.js';
import { isQueueVoiceChannelMatch } from '../../services/playerService.js';

export const name = 'leave';
export const aliases = ['dc', 'disconnect'];
export const allowNoPrefix = true;
export const requiresSameVoiceChannel = true;

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Forces the bot to leave the voice channel (disables 24/7 mode if enabled).');

async function executeLeave(guild, memberVoiceChannel, playerService, settingsService, respond) {
  const queue = playerService?.getGuildQueue(guild.id);
  const botVoice = guild.members?.me?.voice;

  if (!queue && !botVoice?.channelId) {
    return respond({
      embeds: [buildErrorEmbed('Not in Voice', 'I am not connected to any voice channel in this server.')]
    });
  }

  if (memberVoiceChannel && queue && !isQueueVoiceChannelMatch(queue, memberVoiceChannel)) {
    return respond({
      embeds: [buildErrorEmbed('Wrong Voice Channel', 'Join my voice channel before using this command.')]
    });
  }

  // Check if 24/7 mode was enabled and disable it so watchdog does not rejoin
  let was247 = Boolean(queue?.metadata?.is247);
  if (!was247 && settingsService) {
    const settings = await settingsService.getSettings(guild.id).catch(() => null);
    was247 = Boolean(settings?.twentyFourSeven?.enabled);
  }

  if (settingsService && was247) {
    await settingsService
      .set247(guild.id, {
        enabled: false,
        voiceChannelId: null,
        textChannelId: null
      })
      .catch(() => null);
  }

  if (queue) {
    queue.metadata = { ...(queue.metadata ?? {}), is247: false };
    try {
      queue.delete();
    } catch {}
  } else if (botVoice?.disconnect) {
    await botVoice.disconnect().catch(() => null);
  }

  if (was247) {
    return respond({
      embeds: [
        buildSuccessEmbed(
          '👋 Left Voice Channel',
          'Disconnected from voice channel and **disabled 24/7 mode**.\nUse `tree 247` or `tree play` whenever you want me back! 🎵'
        )
      ]
    });
  }

  return respond({
    embeds: [buildSuccessEmbed('👋 Disconnected', 'Disconnected from the voice channel. See you next time!')]
  });
}

export async function execute(interaction) {
  const appContext = getAppContext(interaction) ?? {};
  const playerService = appContext.playerService ?? null;
  const settingsService = appContext.settingsService ?? null;
  const memberVoiceChannel = interaction.member?.voice?.channel;

  await executeLeave(interaction.guild, memberVoiceChannel, playerService, settingsService, async (payload) => {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  });
}

export async function executeMessage(context) {
  const playerService = context.appContext?.playerService ?? null;
  const settingsService = context.appContext?.settingsService ?? null;
  const memberVoiceChannel = context.member?.voice?.channel;

  await executeLeave(context.guild, memberVoiceChannel, playerService, settingsService, async (payload) => {
    await context.respond(payload);
  });
}
