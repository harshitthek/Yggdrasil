import { buildErrorEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { replyToInteraction, replyToMessage } from '../utils/responses.js';

export async function handleInteractionError(interaction, error) {
  logger.error(`Command failed: ${interaction.commandName}`, error);

  if (error?.code === 10062 || error?.code === 40060) {
    return;
  }

  const payload = {
    embeds: [buildErrorEmbed('Something went wrong', 'The command could not be completed. Please try again later.')]
  };

  try {
    await replyToInteraction(interaction, payload, { ephemeral: true });
  } catch (responseError) {
    if (responseError?.code !== 10062 && responseError?.code !== 40060) {
      logger.error('Failed to send command error response.', responseError);
    }
  }
}

export async function handleMessageCommandError(message, error) {
  logger.error('Message command failed.', error);

  await replyToMessage(message, {
    embeds: [buildErrorEmbed('Something went wrong', 'The command could not be completed. Please try again later.')]
  }).catch((responseError) => {
    logger.error('Failed to send message command error response.', responseError);
  });
}
