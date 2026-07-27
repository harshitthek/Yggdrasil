# Music System

## Current Shape

The music subsystem uses `discord-player`, a shared `playerService` in `AppContext`, and the following source paths:

- Default extractors provide Spotify, Apple Music, SoundCloud, and other metadata/source handling.
- `discord-player-youtubei` remains the default YouTube path while the staged rollout flag is off.
- `WorldTreeYoutubeExtractor` is the local YouTube path when `USE_LOCAL_YOUTUBE_EXTRACTOR=true`.
- `youtube-dl-exec` is retained only as the local extractor's final optional stream fallback. It is not used by `musicService.js` or as a global interceptor.

## Main Files

- `src/services/musicService.js`: player setup, active extractor registration, queue stream guard, and player events.
- `src/services/music/youtube/`: local YouTube lifecycle, metadata mapping, stream resolution, stable errors, and debug diagnostics.
- `src/services/playerService.js`: shared player access through `AppContext`.
- `src/commands/music/*`: command/UI behavior. `play.js` owns explicit YouTube URL routing.
- `src/interactions/music*`: interaction handling only.

## Lifecycle and Rollout

1. `bootstrap.js` creates a fresh `playerService` and stores it in `AppContext`.
2. `initializePlayer(client, playerService)` loads default extractors and registers exactly one YouTube boundary.
3. With the flag off, the upstream `YoutubeExtractor` remains active. With the flag on, `WorldTreeYoutubeExtractor` is registered and supported direct YouTube URLs are explicitly routed to it.
4. The local extractor owns Innertube, mapping, stream strategy sequencing, managed stream/process cleanup, and bridge attempts. `musicService.js` does not own those details.
5. Set `USE_LOCAL_YOUTUBE_EXTRACTOR=false` and restart to roll back without changing packages.

## Operational Notes

- CI sets `YOUTUBE_DL_SKIP_DOWNLOAD=true` only during `npm ci`, because tests do not execute the optional yt-dlp binary and GitHub release downloads can be rate-limited. Production deployment installs remain unchanged.
- Stream extraction depends on external providers. Keep the feature flag off until production monitoring supports the local path.
- See `docs/_final/developer_contract.md` and `docs/_final/implementation_plan.md` for the maintained extractor invariants and rollout policy.
