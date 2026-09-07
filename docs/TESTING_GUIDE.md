# Testing Guide

## Test Suites & Runners

World Tree uses Node's built-in test runner (`node --test`) alongside targeted smoke testing and mutation testing harnesses.

## Test Commands

### 1. Unit & Regression Tests

Runs the entire test suite across all domains:

```bash
npm test
```

- **Suites:** 13 test suites
- **Tests:** 384 tests passing (0 failures)
- **Coverage Shape:**
  - API server and routes (Fastify, Zod, OpenAPI)
  - OAuth2 and encrypted session infrastructure (AES-256-GCM, HKDF, HMAC)
  - Environment schema and profile validation
  - Command loading, validation, and execution routing
  - Permission guards, hierarchy checks, and Discord Team owner authorization
  - Moderation, settings, automod, and no-prefix services
  - Music playback, extractors, queue management, and audio effects
  - Voice recording session lifecycle, 24/7 standby retention, and DM delivery
  - Component interaction registry and button handlers

### 2. Smoke Testing

Runs end-to-end smoke verification of the full application stack and host environment:

```bash
npm run test:smoke
```

- Script: `scripts/smokeRunner.js`
- **Checks (13 automated passes):**
  1. Environment & configuration schema validation
  2. Constants and bot prefix integrity
  3. Command registry discovery and schema inspection (47 commands)
  4. Core command schemas (`/record`, `/play`, `/ping`)
  5. Gateway event handler bindings (5 events)
  6. FFmpeg binary resolution and execution validation
  7. RecordingService initial state and session management
  8. Bot owner and application team authentication guards
  9. Music PlayerService factory contracts
  10. Live host process manager liveness (`PM2: online`)
  11. System operations health check (`ops/health.sh: PASS`)

### 3. Mutation Testing

Runs fault-injection mutation testing against core modules to measure the defect-detection capability of the test suite:

```bash
npm run test:mutation
```

- Script: `scripts/mutationRunner.js`
- **Evaluated Mutants:** 15 synthetic code mutations across `src/services/recordingService.js` and `src/commands/utility/record.js`:
  - 24/7 mode detection boolean inversion
  - 24/7 connection retention branch negation
  - Non-24/7 connection destruction suppression
  - Voice redeafening inversion on standby
  - Zero-byte audio detection inversion
  - Active recording duplicate guard inversion
  - DM retry bypass simulation
  - Text channel fallback delivery suppression
  - Command owner restriction flag toggling
  - Owner authorization check inversion
  - Expired interaction code mutation (`10062` $\to$ `99999`)
  - Recording start/stop state machine checks
  - Voice channel requirement guards
  - Guild scope requirement guards
- **Results:** 15/15 mutants killed (**100.0% Mutation Score**)

### 4. Code Hygiene & Formatting

```bash
npm run lint          # Run ESLint across source, tests, and scripts
npm run lint:fix      # Automatically fix linting issues
npm run format:check  # Check formatting with Prettier
npm run format        # Auto-format all JavaScript and Markdown files
```

## Notes

- Some music-related unit tests emit expected `discord-player` or client warnings from mocks.
- Temporary recording audio fixtures (`storage/recordings/`) are automatically cleaned up after test runs.
