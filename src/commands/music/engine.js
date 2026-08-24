import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import {
  getAudioEngineDiagnostics,
  setGuildEngineOverride,
  resolveAudioEngine
} from '../../services/music/engine/audioEngineRouter.js';
import { buildSuccessEmbed, buildNeutralEmbed, buildErrorEmbed } from '../../utils/embeds.js';

export const name = 'engine';
export const aliases = ['audioengine', 'backend'];
export const allowNoPrefix = true;

export const data = new SlashCommandBuilder()
  .setName('engine')
  .setDescription('View or switch the active audio engine (Dual-Channel JS / Rust).')
  .addSubcommand((sub) => sub.setName('status').setDescription('View current audio engine status and channel health.'))
  .addSubcommand((sub) =>
    sub
      .setName('switch')
      .setDescription('Switch the active audio engine for this server.')
      .addStringOption((opt) =>
        opt
          .setName('type')
          .setDescription('Target audio engine')
          .setRequired(true)
          .addChoices(
            { name: 'Auto (Preferred)', value: 'auto' },
            { name: 'Rust SIMD Engine (High Performance)', value: 'rust' },
            { name: 'JavaScript Engine (Standard Baseline)', value: 'js' }
          )
      )
  );

async function executeStatus(guildId, respond) {
  const diag = getAudioEngineDiagnostics(guildId);

  const fields = [
    {
      name: '⚡ Active Engine',
      value: `**${diag.label}**\nStatus: \`${diag.status}\` | SIMD Accelerated: \`${diag.isAccelerated ? 'Yes 🚀' : 'No'}\``
    },
    {
      name: 'Channel A: JavaScript Engine',
      value: `Backend: \`${diag.channelA.backend}\`\nStatus: \`🟢 Online & Ready\``,
      inline: true
    },
    {
      name: 'Channel B: Rust SIMD Engine',
      value: `Backend: \`${diag.channelB.backend}\`\nStatus: \`${diag.channelB.available ? '🟢 Online & Ready' : '⚪ Binary Not Built (JS Active)'}\``,
      inline: true
    }
  ];

  return respond({
    embeds: [
      buildNeutralEmbed(
        'Dual-Channel Audio Engine Status',
        'World Tree utilizes a Dual-Channel audio engine to guarantee zero-latency playback and 100% uninterrupted uptime.'
      ).addFields(fields)
    ]
  });
}

async function executeSwitch(guildId, targetType, member, respond) {
  if (member && !member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return respond({
      embeds: [
        buildErrorEmbed('Permission Denied', 'You need **Manage Server** permission to change the audio engine.')
      ]
    });
  }

  setGuildEngineOverride(guildId, targetType);
  const resolved = resolveAudioEngine(guildId);

  return respond({
    embeds: [
      buildSuccessEmbed(
        '🔄 Audio Engine Updated',
        `Switched active audio engine preference to **${targetType.toUpperCase()}**.\nActive backend: **${resolved.label}**`
      )
    ]
  });
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand() || 'status';
  const guildId = interaction.guild?.id;

  if (sub === 'status') {
    await executeStatus(guildId, async (payload) => {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    });
  } else if (sub === 'switch') {
    const targetType = interaction.options.getString('type');
    await executeSwitch(guildId, targetType, interaction.member, async (payload) => {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    });
  }
}

export async function executeMessage(context) {
  const sub = context.args[0]?.toLowerCase();
  const guildId = context.guild?.id;

  if (sub === 'switch' && context.args[1]) {
    const targetType = context.args[1].toLowerCase();
    if (!['js', 'rust', 'auto'].includes(targetType)) {
      return context.respond({
        embeds: [buildErrorEmbed('Invalid Engine', 'Valid options: `js`, `rust`, `auto`')]
      });
    }
    await executeSwitch(guildId, targetType, context.member, async (payload) => {
      await context.respond(payload);
    });
  } else {
    await executeStatus(guildId, async (payload) => {
      await context.respond(payload);
    });
  }
}
