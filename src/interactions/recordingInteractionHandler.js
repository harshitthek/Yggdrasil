import { recordingService } from '../services/recordingService.js';
import { replyToInteraction } from '../utils/responses.js';
import { buildSuccessEmbed, buildErrorEmbed } from '../utils/embeds.js';

export const prefix = 'rec_stop_';

export async function handle(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith(prefix)) {
    return false;
  }

  const guildId = interaction.customId.slice(prefix.length);
  if (!recordingService.isRecording(guildId)) {
    await replyToInteraction(interaction, {
      embeds: [buildErrorEmbed('Recording Finished', 'This voice recording has already ended.')],
      ephemeral: true
    });
    return true;
  }

  await replyToInteraction(interaction, {
    content: '⏳ Stopping and finalizing audio recording. Encoding to MP3...',
    ephemeral: true
  });

  try {
    const result = await recordingService.stopRecording(guildId);
    await interaction.followUp({
      embeds: [
        buildSuccessEmbed(
          'Recording Saved',
          `Voice recording stopped.\nDuration: ${(result.durationSeconds / 60).toFixed(1)} minutes.\nCheck your DM above for the audio file.`
        )
      ],
      ephemeral: true
    });
  } catch (err) {
    await interaction.followUp({
      embeds: [buildErrorEmbed('Recording Stop Error', err.message)],
      ephemeral: true
    });
  }

  return true;
}
