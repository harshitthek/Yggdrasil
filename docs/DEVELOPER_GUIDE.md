# Developer Guide

## Purpose

World Tree is a self-hosted Discord bot and backend platform living in one Node.js process. The repository favors clear service boundaries over framework-heavy abstractions.

## Working Rules

- commands stay thin
- services own behavior
- repositories isolate MongoDB access
- Fastify plugins own API infrastructure concerns
- shared runtime dependencies move through `AppContext`
- voice recording attaches non-disruptively to voice channels and respects 24/7 standby states
- file uploads to Discord REST API use in-memory buffers to avoid network stream aborts

## Main Runtime Flow

1. `src/index.js` wires shutdown handling.
2. `src/bootstrap.js` creates `AppContext`, connects MongoDB, loads commands/events, initializes the player, logs in the client, and conditionally starts the API server.
3. Discord events attach `appContext` to message/interaction objects before routing.
4. Voice recording commands defer immediately to satisfy Discord's 3-second interaction acknowledgment SLA.

## Safe Change Areas

- command behavior changes: `src/commands`, `src/services`, matching tests
- API behavior changes: `src/api`, `src/config/env.js`, matching tests
- interaction behavior changes: `src/interactions`, `src/middleware/commandRouter.js`, matching tests
- utility and formatter functions: `src/utils/`, matching tests

## High-Caution Areas

- auth/session plugins (`src/api/plugins/sessionPlugin.js`)
- permission and no-prefix trust boundaries (`src/middleware/permissionGuard.js`)
- music external-process integration (`src/services/musicService.js`)
- voice recording pipeline (`src/services/recordingService.js` — UDP warm-up packets, VoiceReceiver bindings, and 24/7 standby retention)
- repository-layer schema changes (`src/database/mongo/`)
