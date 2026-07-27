# WorldTree YouTube Extraction: Shipped Architecture Record

> Status: This supersedes the earlier scaffold-era execution plan. It documents the implementation currently shipped on `feature/local-youtube-extractor`; package cleanup remains intentionally pending.

## 1. Current Architecture

The local YouTube boundary is `src/services/music/youtube/`:

- `WorldTreeYoutubeExtractor.js`: `discord-player` extractor lifecycle, validation, metadata lookup orchestration, streaming delegation, bridging, and the Innertube-backed debug diagnostic.
- `YoutubeTrackMapper.js`: conversion from YouTube metadata to `discord-player` `Track`, `Playlist`, and search-result structures.
- `YoutubeStreamResolver.js`: stream resolution strategy sequencing. It preserves the local configured order: custom stream override, configured peer, Innertube adaptive stream, and yt-dlp fallback.
- `youtubeErrors.js`: stable standard-`Error` codes: `YT_EXTRACTOR_INACTIVE`, `YT_INVALID_QUERY`, `YT_METADATA_FAILED`, `YT_PLAYLIST_FAILED`, `YT_SEARCH_FAILED`, `YT_STREAM_FAILED`, `YT_BRIDGE_FAILED`, `YT_NO_STREAM`, `YT_DEPENDENCY_MISSING`, and `YT_DIAGNOSTIC_TIMEOUT`.
- `YoutubeDiagnostic.js`: timeout and deduplication coordinator that invokes the active extractor's existing Innertube client. It does not import `youtubei.js`.

`WorldTreeYoutubeExtractor.activate()` creates the active Innertube client with `{ retrieve_player: true }`. The project does not implement the obsolete WEB -> MWEB -> IOS -> ANDROID client rotation or a separate PoToken workflow.

Playlist collection is bounded to 25 continuation pages and 500 playable items to prevent unbounded sequential retrieval and memory growth.

## 2. Runtime Cutover

`USE_LOCAL_YOUTUBE_EXTRACTOR` is parsed in `src/config/env.js` as `useLocalYoutubeExtractor`.

- Flag unset or `false`: `musicService.js` registers the existing `discord-player-youtubei` `YoutubeExtractor` with the existing IOS/PoToken options.
- Flag `true`: `musicService.js` registers `WorldTreeYoutubeExtractor` instead. It does not register both YouTube extractors.
- `play.js` owns direct URL routing. `isYoutubeUrl()` recognizes supported `youtube.com`, `m.youtube.com`, `music.youtube.com`, and `youtu.be` video/playlist URLs. `resolveMusicSearchEngine()` returns `ext:WorldTreeYoutube` only for those URLs when the flag is enabled.
- The local extractor has bridge priority `1` while the installed default extractors use the base priority `0`. This makes local YouTube the first bridge target for Spotify/Apple metadata tracks without claiming their URLs or text searches.
- Non-YouTube URLs and text searches preserve `QueryType.AUTO` and `QueryType.AUTO_SEARCH` behavior.

`discord-player@7.2.0` exposes `disableFallbackStream`, but it is queue-wide. WorldTree deliberately does not enable it because one queue can contain multiple providers. Instead, `musicService.js` installs its documented `onBeforeCreateStream` hook and delegates only local YouTube tracks. A local stream failure cannot enter generic cross-provider fallback.

## 3. Error and Player Error Handling

The local extractor throws ordinary `Error` objects with codes from `youtubeErrors.js`. `musicService.js` continues to own the `playerError` user notification path. With `MUSIC_DEBUG=true`, it asks the active local extractor for a timeout-bounded, deduplicated diagnostic. If the local flag is off, the diagnostic is safely skipped because no local extractor is active.

## 4. Dependency and Rollback Policy

`youtubei.js@17.2.0` is a direct dependency because the local extractor imports it directly. `discord-player-youtubei` and `youtube-dl-exec` remain installed during the staged rollout.

Rollback is configuration-only: set `USE_LOCAL_YOUTUBE_EXTRACTOR=false` and restart. This returns registration and URL routing to the upstream extractor without package changes.

## 5. Verification

Use the Node.js native runner. The relevant checks are:

```bash
npm run lint
npm run format:check
npm test
```

Focused coverage verifies mapper behavior, resolver behavior, extractor lifecycle and bounded playlists, flag-on/off registration selection, direct URL routing, provider isolation, and diagnostic timeout/deduplication.

## 6. Deferred Work

Package cleanup is a separate release decision. Do not remove `discord-player-youtubei` or `youtube-dl-exec` until production rollout evidence supports ending the rollback window.
