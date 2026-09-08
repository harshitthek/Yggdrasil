import mongoose from 'mongoose';

import { logger } from '../../utils/logger.js';
import { runPendingMigrations } from './migrationRunner.js';

let hasRegisteredConnectionLogger = false;

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 5_000;

/**
 * Connects to MongoDB with retry logic and runs pending migrations.
 *
 * Retry logic handles transient failures during initial connection (e.g.,
 * MongoDB Atlas cold-starts, brief DNS resolution failures). Once connected,
 * Mongoose's built-in driver handles reconnection automatically.
 *
 * @param {string} mongoUri - MongoDB connection string.
 * @param {object} [options]
 * @param {number} [options.serverSelectionTimeoutMS] - Mongoose server selection timeout.
 * @param {number} [options.maxRetries=3] - Maximum connection attempts before giving up.
 * @param {number} [options.retryDelayMs=5000] - Delay between retry attempts in ms.
 * @param {boolean} [options.runMigrations=true] - Whether to auto-run migrations after connecting.
 */
export async function connectMongo(mongoUri, options = {}) {
  const {
    serverSelectionTimeoutMS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    runMigrations = true
  } = options;

  if (!mongoUri || typeof mongoUri !== 'string') {
    throw new Error('mongoUri is required and must be a non-empty string.');
  }

  mongoose.set('strictQuery', true);

  if (!hasRegisteredConnectionLogger) {
    mongoose.connection.on('error', (error) => {
      logger.error('MongoDB connection error.', error);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. The driver will attempt to reconnect automatically.');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected successfully.');
    });

    hasRegisteredConnectionLogger = true;
  }

  if (mongoose.connection.readyState === 1) {
    logger.info('MongoDB already connected.');
    return mongoose.connection;
  }

  const connectOptions = {
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 30000
  };
  if (serverSelectionTimeoutMS !== undefined) {
    connectOptions.serverSelectionTimeoutMS = serverSelectionTimeoutMS;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await mongoose.connect(mongoUri, connectOptions);
      logger.info('MongoDB connected.');
      break;
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`MongoDB connection failed after ${maxRetries} attempts.`, error);
        throw error;
      }

      logger.warn(`MongoDB connection attempt ${attempt}/${maxRetries} failed. Retrying in ${retryDelayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  // Run pending database migrations after successful connection
  if (runMigrations) {
    const result = await runPendingMigrations({ log: logger });

    if (result.applied > 0) {
      logger.info(`Database migrations: ${result.applied} applied, ${result.skipped} skipped.`);
    }
  }

  return mongoose.connection;
}
