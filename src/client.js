import { Client, Collection } from 'discord.js';
import { CLIENT_INTENTS, CLIENT_PARTIALS, CLIENT_CACHE_OPTIONS, CLIENT_SWEEPER_OPTIONS } from './config/discord.js';

export function createClient({
  intents = CLIENT_INTENTS,
  partials = CLIENT_PARTIALS,
  makeCache = CLIENT_CACHE_OPTIONS,
  sweepers = CLIENT_SWEEPER_OPTIONS
} = {}) {
  const client = new Client({
    intents,
    partials,
    makeCache,
    sweepers
  });

  client.commands = new Collection();

  return client;
}
