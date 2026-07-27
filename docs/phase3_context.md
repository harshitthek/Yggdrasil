# Phase 3 — Codebase Context Reference

> **Purpose**: Pre-read context snapshot for Phase 3 implementation. Eliminates re-reading files during coding.
> **Created**: 2026-07-08
> **Scope**: Every file touched or consumed by Phase 3: Data & Resource Hardening
>
> **Historical note**: The music subsection predates the local YouTube extractor migration. For current music ownership, dependency, and rollout rules, use `docs/_final/developer_contract.md` and `docs/_final/implementation_plan.md`.

---

## Table of Contents

- [1. Cache Layer (Settings + NoPrefix)](#1-cache-layer)
  - [1.1 settingsService.js](#11-settingsservicejs)
  - [1.2 noPrefixService.js](#12-noprefixservicejs)
- [2. Automod State](#2-automod-state)
  - [2.1 automodState.js](#21-automodstatejs)
  - [2.2 automodService.js (consumer)](#22-automodservicejs-consumer)
- [3. Database Layer](#3-database-layer)
  - [3.1 connection.js](#31-connectionjs)
  - [3.2 queryOptions.js](#32-queryoptionsjs)
  - [3.3 Models](#33-models)
  - [3.4 Repositories](#34-repositories)
- [4. Bootstrap & Lifecycle](#4-bootstrap--lifecycle)
  - [4.1 bootstrap.js](#41-bootstrapjs)
  - [4.2 index.js (shutdown)](#42-indexjs-shutdown)
- [5. Music Service (yt-dlp assessment)](#5-music-service)
- [6. Constants & Defaults](#6-constants--defaults)
- [7. Consumer Map](#7-consumer-map)
- [8. Existing Tests](#8-existing-tests)
- [9. Known Issues Summary](#9-known-issues-summary)

---

## 1. Cache Layer

### 1.1 settingsService.js

**File**: [settingsService.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/services/settingsService.js) (202 lines)

**Cache mechanics**:
- Data structure: `new Map()` — unbounded, keyed by `guildId`
- Value shape: `{ settings: <normalized object>, expiresAt: <timestamp> }`
- TTL: `30_000ms` (30 seconds), configurable via `cacheTtlMs` constructor option
- Read path: `getEffectiveSettings(guildId)` → check `expiresAt > Date.now()` → on miss, fetch from repo + `cache.set()`
- Invalidation: `clearCache(guildId)` → `cache.delete(guildId)` — called after every mutation

**Factory signature**:
```js
createSettingsService(repository = settingsRepository, { cacheTtlMs = 30_000 } = {})
```

**Mutation methods that call `clearCache` after DB write**:
`setModLogChannel`, `setMusicPanel`, `addTrustedAdminRole`, `removeTrustedAdminRole`, `setAutomodEnabled`, `updateAutomodThreshold`, `updateAutomodRule`, `updateAutomodPunishment`, `addBadWord`, `removeBadWord`, `setActivityRole`, `removeActivityRole`

**Exported singleton**: `export const settingsService = createSettingsService();`

**Key detail for LRU swap**: The cache API is `get(key)`, `set(key, value)`, `delete(key)` — exact same as `Map`. LRU is a transparent drop-in.

---

### 1.2 noPrefixService.js

**File**: [noPrefixService.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/services/noPrefixService.js) (73 lines)

**Cache mechanics**:
- Data structure: `new Map()` — unbounded, keyed by `userId`
- Value shape: `{ allowed: <boolean>, expiresAt: <timestamp> }`
- TTL: `30_000ms`, configurable via `cacheTtlMs`
- Read path: `canUseNoPrefix(userId)` → owner bypass → check `expiresAt` → on miss, `repository.findActiveByUserId()` → `cache.set()`
- Invalidation: `clearCache(userId)` after `addUser` and `removeUser`

**Factory signature**:
```js
createNoPrefixService(repository = noPrefixRepository, { botOwnerId = null, cacheTtlMs = 30_000 } = {})
```

**Hot path**: `canUseNoPrefix` is called on **every message** via the message command router. This is the highest-frequency cache operation in the entire bot.

**Exported singleton**: `export const noPrefixService = createNoPrefixService();`

**Key detail for LRU swap**: Same `Map`-compatible API. Drop-in replacement.

---

## 2. Automod State

### 2.1 automodState.js

**File**: [automodState.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/services/automod/automodState.js) (49 lines)

**State mechanics**:
- Data structure: `new Map()` — keyed by composite key (e.g., `guildId:userId`), values are arrays of `{ createdAt }` entries
- Sweep: `setInterval` every `60_000ms`, prunes entries older than `65_000ms`
- `sweepInterval.unref()` — doesn't block process exit
- `dispose()` — clears interval + map, guarded by `disposed` boolean

**Factory signature**:
```js
createAutomodState()  // no options currently
```

**Public API**: `getRepeatedMessages(key)`, `setRepeatedMessages(key, entries)`, `clear()`, `dispose()`

**Exported singleton**: `export const automodState = createAutomodState();`

**Gap for Phase 3**: No `maxEntries` cap. Under spam attack, Map grows unbounded within the 60s sweep window.

---

### 2.2 automodService.js (consumer)

**File**: [automodService.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/services/automod/automodService.js) (85 lines)

**How it uses automodState**: Passes `state` (the automodState instance) into `evaluateRules()`, which passes it to `evaluateRepeatSpam()`. The state is only consumed by the repeat spam rule.

**Factory signature**:
```js
createAutomodService({ settingsService, punishmentExecutor, state = automodState, log = logger } = {})
```

**Key detail**: The `state` is injectable — tests already pass a mock. Adding `maxEntries` to `createAutomodState()` won't break any consumer.

---

## 3. Database Layer

### 3.1 connection.js

**File**: [connection.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/database/mongo/connection.js) (29 lines)

**Current logic**:
```
1. Set strictQuery = true
2. Register error event listener (once, guarded by flag)
3. If readyState === 1, skip
4. mongoose.connect(mongoUri, { serverSelectionTimeoutMS })
5. Log success
6. Return connection
```

**What's missing**:
- No retry on initial connection failure
- No `disconnected` / `reconnected` event logging
- No migration runner call
- No connection pool options

**Called from**: [bootstrap.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/bootstrap.js) line 47

---

### 3.2 queryOptions.js

**File**: [queryOptions.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/database/mongo/queryOptions.js) (13 lines)

```js
export function upsertOptions() {
  return { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true };
}
```

No changes needed. Shared by all repositories.

---

### 3.3 Models

#### GuildSettings

**File**: [GuildSettings.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/database/mongo/models/GuildSettings.js) (114 lines)

**Schema shape** (relevant fields for migration `002`):
```
activityRoles:
  spotify:   { enabled: Boolean(false), roleId: String(null) }
  streaming: { enabled: Boolean(false), roleId: String(null) }
  gaming:    { enabled: Boolean(false), roleId: String(null) }
  voice:     { enabled: Boolean(false), roleId: String(null) }
```

**Collection name**: `guild_settings`

**Migration note**: Documents created before Phase 0 lack the `activityRoles` field entirely. Mongoose applies defaults on read, but raw queries and aggregations bypass this. Migration `002` will `$set` this field on all docs that lack it.

#### ModerationCase

**File**: [ModerationCase.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/database/mongo/models/ModerationCase.js) (88 lines)

**Collection name**: `moderation_cases`
**Indexes**: `{ guildId: 1, caseId: 1 }` unique, `{ guildId: 1, targetUserId: 1, actionType: 1 }` compound

No Phase 3 changes needed.

#### Counter

**File**: [Counter.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/database/mongo/models/Counter.js)

Schema: `{ _id: String, seq: Number }`. Used for atomic `$inc` on case IDs. No changes needed.

#### NoPrefixPrivilege

**File**: [NoPrefixPrivilege.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/database/mongo/models/NoPrefixPrivilege.js)

Schema: `{ userId (unique), active (indexed), addedBy, removedBy, reason, ... }`. Collection: `no_prefix_privileges`. No changes needed.

---

### 3.4 Repositories

#### settingsRepository.js

**File**: [settingsRepository.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/database/mongo/repositories/settingsRepository.js) (124 lines)

**Factory**: `createSettingsRepository(model = GuildSettings)`
**All methods use**: `findOneAndUpdate` + `upsertOptions()` + `.lean()`
**Key methods**: `getOrCreate`, `setModLogChannel`, `setMusicPanel`, `addTrustedAdminRole`, `removeTrustedAdminRole`, `setAutomodEnabled`, `updateAutomodRule`, `updateAutomodPunishment`, `addBadWord`, `removeBadWord`, `setActivityRole`, `removeActivityRole`

No Phase 3 changes needed (repo layer is clean).

#### moderationRepository.js

**File**: [moderationRepository.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/database/mongo/repositories/moderationRepository.js) (178 lines)

**Key detail**: `createCase()` uses 2-attempt retry with counter re-alignment on duplicate key error. `getCaseStats()` has a fallback path that loads all cases into memory (noted as medium-severity issue but not in Phase 3 scope).

No Phase 3 changes needed.

#### noPrefixRepository.js

**File**: [noPrefixRepository.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/database/mongo/repositories/noPrefixRepository.js) (53 lines)

**Factory**: `createNoPrefixRepository(model = NoPrefixPrivilege)`
**Methods**: `findActiveByUserId`, `listActiveUsers`, `upsertUser`, `deactivateUser`

No Phase 3 changes needed.

---

## 4. Bootstrap & Lifecycle

### 4.1 bootstrap.js

**File**: [bootstrap.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/bootstrap.js) (93 lines)

**Startup sequence**:
```
1. Create playerService
2. Create appContext (client, config, settingsService, noPrefixService, logger, commands, playerService)
3. Attach appContext to client
4. connectMongo()  ← Phase 3 will add retry + migrations here
5. Load commands
6. Load events
7. Log intent warnings
8. initializePlayer()
9. client.login()
10. If ENABLE_API, create + listen API server
11. Return { client, apiServer, appContext, ... }
```

**Phase 3 impact**: After step 4 (`connectMongo`), migrations will auto-run before the bot proceeds. This ensures schema is up-to-date before any commands or services touch the DB.

---

### 4.2 index.js (shutdown)

**File**: [index.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/index.js) (67 lines)

**Shutdown order**: `client.destroy()` → `apiServer.close()` → `mongoose.disconnect()`

**Handles**: `unhandledRejection`, `uncaughtException`, `SIGINT`, `SIGTERM`

No Phase 3 changes needed. Mongoose disconnect is already handled.

---

## 5. Music Service

**Historical scope update**: The original assessment no longer reflects the repository. The staged local YouTube extractor imports `youtube-dl-exec` only for its final fallback stream strategy and owns cleanup of any spawned process. The dependency must remain installed until the explicit package-cleanup phase; it is not a `musicService.js` responsibility.

---

## 6. Constants & Defaults

**File**: [constants.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/utils/constants.js) (106 lines)

**Relevant defaults for migrations**:
```js
DEFAULT_ACTIVITY_ROLES = {
  spotify:   { enabled: false, roleId: null },
  streaming: { enabled: false, roleId: null },
  gaming:    { enabled: false, roleId: null },
  voice:     { enabled: false, roleId: null }
}
```

These are the values migration `002` will backfill into existing documents.

---

## 7. Consumer Map

Who imports what — critical for impact analysis:

| Module | Consumers |
|--------|-----------|
| `settingsService` (singleton) | [bootstrap.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/bootstrap.js), [servicesPlugin.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/api/plugins/servicesPlugin.js), [activityrole.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/commands/setup/activityrole.js), [setmodlog.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/commands/setup/setmodlog.js), [settings.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/commands/setup/settings.js), [automodService.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/services/automod/automodService.js) |
| `createSettingsService` (factory) | [settingsService.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/settingsService.test.js), [settingsServiceActivityRoles.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/settingsServiceActivityRoles.test.js) |
| `noPrefixService` (singleton) | [bootstrap.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/bootstrap.js) (uses factory), [noprefix.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/commands/setup/noprefix.js) |
| `createNoPrefixService` (factory) | [noPrefixService.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/noPrefixService.test.js) |
| `automodState` (singleton) | [automodService.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/services/automod/automodService.js) |
| `createAutomodState` (factory) | [automodService.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/automodService.test.js) |
| `connectMongo` | [bootstrap.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/src/bootstrap.js) |

---

## 8. Existing Tests

| Test File | Tests | What it covers | Phase 3 impact |
|-----------|-------|----------------|----------------|
| [settingsService.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/settingsService.test.js) | 2 | Normalization, cache invalidation | ✅ No changes — uses `createSettingsService(mockRepo)` |
| [settingsServiceActivityRoles.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/settingsServiceActivityRoles.test.js) | 6 | Activity role set/remove/list | ✅ No changes — uses factory |
| [noPrefixService.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/noPrefixService.test.js) | 3 | Owner bypass, CRUD, cache invalidation | ✅ No changes — uses factory |
| [automodService.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/automodService.test.js) | ~8 | Rule matching, punishment, dispose | ⚠️ Add maxEntries tests |
| [settingsRepository.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/settingsRepository.test.js) | 3 | CRUD, modlog, automod rules | ✅ No changes |
| [noPrefixRepository.test.js](file:///c:/Users/user/Desktop/harshit/projects/WorldTree-Auth/test/noPrefixRepository.test.js) | 1 | Upsert | ✅ No changes |

**Total existing tests**: 253 (must all still pass after Phase 3).

---

## 9. Known Issues Summary

| # | Issue | File | Severity | Phase 3 fix? |
|---|-------|------|----------|---------------|
| 1 | Unbounded `Map` cache in settings | `settingsService.js` | 🔴 | ✅ LRU(1000) |
| 2 | Unbounded `Map` cache in noPrefix | `noPrefixService.js` | 🔴 | ✅ LRU(10000) |
| 3 | Unbounded automod state Map | `automodState.js` | 🔴 | ✅ maxEntries(50000) |
| 4 | No DB connection retry | `connection.js` | 🔴 | ✅ 3-attempt retry |
| 5 | No DB reconnection logging | `connection.js` | 🟡 | ✅ Event listeners |
| 6 | No migration system | — | 🟡 | ✅ New system |
| 7 | Historical dead-dependency finding for `youtube-dl-exec` | `package.json` | Superseded | Retained during the local YouTube rollout |
| 8 | `listWarnings` has no limit | `moderationRepository.js` | 🟡 | ❌ Out of scope |
| 9 | `getCaseStats` fallback loads all | `moderationRepository.js` | 🟡 | ❌ Out of scope |
| 10 | Triple `automodEnabled` redundancy | `GuildSettings` + repo | 🟡 | ❌ Out of scope |
