# WorldTree Developer Contract: Music Pipeline Invariants

This document defines the maintained invariants for WorldTree's local YouTube extraction path. The repository implementation and installed dependency versions are the source of truth.

## 1. Architectural Boundaries

### 1.1 Do Not Modify `discord-player` Core

WorldTree owns these components:

1. `src/services/music/youtube/WorldTreeYoutubeExtractor.js`
2. `src/services/music/youtube/YoutubeTrackMapper.js`
3. `src/services/music/youtube/YoutubeStreamResolver.js`
4. `src/services/music/youtube/youtubeErrors.js`
5. `src/services/music/youtube/YoutubeDiagnostic.js`
6. `src/services/musicService.js`
7. `src/commands/music/play.js`
8. The music and local YouTube test suites.

Do not monkey-patch or fork `discord-player` to alter fallback, queue, or extractor behavior.

### 1.2 Local YouTube Boundary

`WorldTreeYoutubeExtractor.js` is the only WorldTree module that imports and calls `youtubei.js`. It owns Innertube lifecycle, metadata orchestration, stream orchestration, bridge orchestration, and the debug diagnostic work.

`YoutubeDiagnostic.js` is a coordinator, not an Innertube client. It calls the active extractor's diagnostic method, enforces a caller timeout, and deduplicates active diagnostic tasks. It must not import `youtubei.js` or create a second Innertube session.

```text
youtubei.js
      ^
WorldTreeYoutubeExtractor
      ^
YoutubeDiagnostic / discord-player
      ^
musicService.js
      ^
Command Handlers
```

### 1.3 Strict Provider Isolation

YouTube failures must never silently bridge to SoundCloud, Spotify, or another provider.

- `play.js` owns explicit direct-URL routing through `isYoutubeUrl()` and `resolveMusicSearchEngine()`. When the local feature flag is enabled, supported YouTube URLs use `searchEngine: 'ext:WorldTreeYoutube'`.
- `musicService.js` owns extractor registration and installs the queue-level per-track guard. The guard delegates only `WorldTreeYoutube` tracks to the local extractor before discord-player's generic cross-provider fallback can run.
- `WorldTreeYoutubeExtractor` has bridge priority `1`, ahead of the installed default extractors at priority `0`, so Spotify/Apple bridge attempts prefer the local YouTube boundary. Its strict `validate()` method must continue to reject non-YouTube URLs and generic text queries.
- `YoutubeTrackMapper.js` owns metadata conversion only. `YoutubeStreamResolver.js` owns stream strategy sequencing only. `youtubeErrors.js` owns stable error-code constants.

## 2. Ownership and Dependency Rules

### 2.1 `musicService` Must Not Own YouTube Internals

`musicService.js` manages player construction, extractor selection, queue hooks, and Discord event handling. It must not create Innertube clients, parse cipher failures, create PoTokens, map YouTube metadata, or resolve streams.

`play.js` owns the explicit URL-to-search-engine decision. Commands must not call the extractor or `youtubei.js` directly.

### 2.2 Dependencies Are Explicit

WorldTree imports `youtubei.js` directly, so it must remain a direct dependency at the tested version. Do not rely on `discord-player-youtubei` to hoist it transitively. Keep `discord-player-youtubei` installed until the staged local rollout is complete and the rollback window has closed.

## 3. Maintenance Policy

When YouTube or an upstream dependency changes:

1. Validate the installed `discord-player`, `youtubei.js`, and `discord-player-youtubei` sources before changing implementation.
2. Update only the local YouTube boundary for metadata, stream, bridge, or Innertube API changes.
3. Preserve stable codes from `youtubeErrors.js`; do not use error-message matching for control flow.
4. Run `npm run lint`, `npm run format:check`, and `npm test` before rollout.
5. Keep `USE_LOCAL_YOUTUBE_EXTRACTOR=false` as the immediate rollback path until package cleanup is explicitly approved.
