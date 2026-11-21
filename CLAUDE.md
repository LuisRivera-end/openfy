# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Openfy is a single-user personal music library. One Node/Nitro server owns a SQLite library and serves two clients:

- a Nuxt 4 PWA (`app/`), used mainly from an iPhone over Tailscale, with offline downloads;
- a native Windows app (`desktop/`, .NET 10 / WinUI 3, no WebView) that launches and supervises that same Node server.

UI strings, error messages and everything in `docs/` are Spanish; code and code comments are English. Keep both conventions.

## Commands

Web / server (Node `^22.22.3 || ^24.15.0 || >=26`; `scripts/setup.ps1` installs a private Node under `%LOCALAPPDATA%\Openfy\runtime` and records it in `.openfy-runtime.json`, which the PowerShell scripts use instead of the global `node`):

```powershell
npm run dev          # Nuxt dev server on 127.0.0.1 (no offline/service-worker behaviour)
npm run build        # production build into .output/
npm start            # serve .output/ via scripts/serve.mjs, loopback only, reads .env
npm run typecheck    # nuxt typecheck (vue-tsc) — there is no separate lint script
npm test             # Vitest, tests/unit/**/*.test.ts
npm run test:e2e     # Playwright; needs `npm run build` first and `npx playwright install chromium webkit`
```

Single tests:

```powershell
npx vitest run tests/unit/range.test.ts
npx vitest run -t "part of the test name"
npx playwright test tests/e2e/home.spec.ts --project=chromium
```

Playwright projects are `chromium` and `mobile-webkit`. Each spec runs once per browser unless you pass `--project`. E2E runs serially against `tests/helpers/server.mjs` on `127.0.0.1:4175`, which fronts the built `.output/server/index.mjs` and serves synthetic YouTube audio over a real socket (WebKit's media stack bypasses Playwright routing).

Background server scripts: `scripts/start.ps1` / `scripts/stop.ps1` (PID in `.openfy.pid`, logs in `%LOCALAPPDATA%\Openfy\logs`). **Stop the server before building**: Windows locks the native `better-sqlite3` module while it is loaded. The default port is 3000; a local `.env` (`NITRO_PORT`, `OPENFY_DATA_DIR`, `OPENFY_ORIGIN`, `OPENFY_FFMPEG`) overrides it — see `.env.example`.

Scripts that need a running server: `npm run test:youtube` (real YouTube search/HEAD/range check) and `npm run test:audio` (imports synthetic tracks into the configured library).

Native Windows app:

Distinguish the installed app from workspace development before telling the user how to apply changes. The installed app uses its bundled `backend/.output`; `npm run build` only rebuilds the repository's `.output`. Reopening the installed app after that command does not deploy repository changes. When the user expects changes in their installed Windows app, use `scripts/package-desktop.ps1`: its normal local-feed workflow builds, verifies, installs, reopens, confirms the new backend build, and retires obsolete packages. Check the running executable path and `--workspace` argument when the active mode is unclear. For test packages, use an isolated `-FeedRoot` with `-NoInstall`.

```powershell
.\scripts\setup-desktop.ps1     # private .NET SDK 10.0.404, icons, nuxt build, Release build of Openfy.Windows
.\scripts\start-desktop.ps1     # runs the built Openfy.exe with --workspace <repo>
.\scripts\package-desktop.ps1   # self-contained publish + installer + update manifest in output/desktop
& "$env:LOCALAPPDATA\Openfy\development\dotnet\dotnet.exe" test desktop/Openfy.Tests -c Release
& "$env:LOCALAPPDATA\Openfy\development\dotnet\dotnet.exe" test desktop/Openfy.Audio.Tests -c Release
```

Add `--filter "FullyQualifiedName~ListeningTests"` for a single xUnit class. `Openfy.Audio.Tests` needs Windows, an audio output device and a built production backend (`.output/`).

`Openfy.exe` accepts `--data-dir`, `--state-dir` and `--port` to run against an isolated library, plus self-exiting checks that write a JSON report: `--startup-check <file>`, `--smoke-test <audio>`, `--youtube-test <videoId>`, `--listening-test <audio>`, `--visual-check <dir>`, `--visual-players <dir> --visual-fixtures <dir>` (fullscreen/mini/widget captures with the Direct3D background composited). Use those isolation flags for any native test run.

## Never touch the personal library

The real library lives in `%LOCALAPPDATA%\Openfy\data` (or `OPENFY_DATA_DIR`). All automated tests create temp directories and set `OPENFY_DATA_DIR` themselves; follow that pattern. A `.openfy-library.lock` allows only one server per data directory, so a running Openfy instance and a second server on the same data will conflict.

## Architecture

### Server (`server/`, Nitro `node-server` preset)

- `server/database/index.ts` opens SQLite (WAL) and applies hand-written, idempotent migrations keyed on `PRAGMA user_version` (currently 5). `schema.ts` is the Drizzle mapping only — it does not create tables. A schema bump must also update the migration test expectations and the `maxLibrarySchema`/`maxSchema` defaults in `scripts/package-desktop.ps1`, `server/utils/update-maintenance.ts`, `server/utils/desktop-bridge.ts` and `desktop/Openfy.Setup/Transaction.cs`.
- `server/middleware/private.ts` is the only access control: requests must target loopback or the exact `OPENFY_ORIGIN` host, and mutating requests are origin-checked. There is no login; exposure is delegated to Tailscale Serve, and `scripts/serve.mjs` forces `NITRO_HOST=127.0.0.1`.
- `server/plugins/library.ts` starts the background worker and the desktop bridge, and emits `libraryChanged` after mutating API calls.
- `server/utils/workers.ts` is a single-flight queue: imports first, then FLAC→AAC conversions (FFmpeg), then genre scans. Conversions are killed and re-queued while any client reports active playback (`POST /api/activity`). Work is event-driven via `wakeWorkers()`, not polled.
- YouTube Music goes through `youtubei.js` behind an adapter (`server/utils/youtube-*.ts`, `music-*.ts`). Player scripts are evaluated in a QuickJS sandbox (`youtube-evaluator.ts`). Audio is proxied with HTTP Range by `server/api/music/youtube/[videoId]/stream.ts` and is never written to disk or cached. Local and YouTube items share collections using ids of the form `youtube:<videoId>`.
- Lyrics resolution order and caching live in `server/utils/lyrics.ts` / `lrclib.ts` / `embedded-lyrics.ts`.
- Motion art (the album's looping video in the desktop Big Picture) is resolved, stored and served by the server: `server/utils/apple-motion.ts` (undocumented Apple Music web-player endpoint; any unexpected answer keeps the static cover) and `server/utils/motion-art.ts` (file cache under `motion-cache/`, no SQLite state; albums of local tracks and of songs downloaded to the PC are pinned, the rest is evicted over 1 GB). Clients only call `POST /api/motion/resolve` and play `/api/motion/<key>.mp4`; every web client, phones and the installed PWA included, requests it for the large cover of the expanded player unless the browser reports data saver or a cellular link. `OPENFY_MOTION_ART=off` stops every provider request (tests, and native check runs set it). See `docs/motion-art.md`.

### PWA (`app/`, `ssr: false`)

- `app/pages/[[...view]].vue` is a catch-all that renders home, library, favorites, downloads, settings and local album/artist/playlist detail from the first path segment; `search`, `most-played` and `music/{artist,album}/[id]` are separate pages.
- State is in Pinia stores (`app/stores/`). Library, favorites and playlists are server-owned and cached locally; queue, position, downloads, lyrics and unsynced listening sessions are per-device in IndexedDB via Dexie (`app/lib/local.ts`, Dexie version 3). Adding a Dexie version changes the native IndexedDB version (Dexie multiplies by 10), which the migration specs in `tests/e2e/lyrics.spec.ts` assert.
- `app/service-worker/sw.ts` (injectManifest) precaches the shell and serves downloaded `/api/assets/*` from the cache with Range support, but never caches implicitly while streaming: only the downloads store commits a file, after size and SHA-256 verification. Streams use `streamingAssetUrl` (`?stream=1`) and are not intercepted. Updates are coordinated in `app/service-worker/update.ts`; hidden tabs that never answer (iOS freezes them) do not block, and any tab whose controller changed without being prepared reloads itself once visible and idle. Desktop Chromium holds activation (and the `skipWaiting()` promise) after a controlled page has played local audio, until its lame-duck timeout; cause not identified, so `updates.spec.ts` covers update-while-playing on WebKit only. Never reload a page to force activation: the navigation reaches the retiring worker and is lost. Offline behaviour therefore only exists in a production build.
- One appearance is used throughout Windows and web/PWA. Web presentation lives in `app/assets/main.css`; native `Appearance.Apply` is unconditional and idempotent. Preserve the independent motion preference and compatibility with old session files.

### Native Windows app (`desktop/Openfy.slnx`)

- `Openfy.Core`: platform-neutral contracts, HTTP client, range/fragmented-MP4 streams, listening rules, update feed, session log.
- `Openfy.Windows`: the WinUI app. Views are built in C# code (`Views/MainWindow.*.cs` partials by area, helpers in `Views/Ui.cs`), with a single `MainViewModel`; audio is NAudio/WASAPI (`Audio/`), reactive backgrounds are Direct3D 11 (`Graphics/`).
- `Openfy.Setup`: the installer/updater, which embeds the published app as a zip payload and performs a transactional replace with library backup.
- `Services/BackendHost.cs` spawns Node inside a Job Object, creates a random current-user-only named pipe, waits for the `ready` greeting, verifies the instance id over `GET /api/status`, and restarts the backend on crashes. In `--workspace` mode it uses the repo's `.output`, `.env` and `.openfy-runtime.json`; installed, it uses the bundled `backend/` and `%LOCALAPPDATA%\Openfy\configuration.env`.
- Ordinary data flows over the same HTTP API the PWA uses. The pipe (`server/utils/desktop-bridge.ts`, newline-delimited JSON) carries only what must not be on HTTP: resolving an asset to an absolute path, importing filesystem paths, artwork preparation, change subscriptions, update maintenance and shutdown. Absolute paths must not be added to HTTP responses.

### Contracts shared between TypeScript and .NET

Several rules are implemented twice and pinned by fixtures in `tests/fixtures/*-contract.json` that both Vitest and xUnit load: playback/queue snapshots (`shared/utils/playback.ts`, `queue.ts` ↔ `Openfy.Core/Contracts.cs`), listening/90 % play counting (`shared/utils/telemetry.ts` ↔ `Openfy.Core/Listening.cs`) lyrics matching (`shared/utils/lyrics.ts` ↔ `Openfy.Core/LyricsMatching.cs`), the per-word lyrics rule (`activeLyricsWord` ↔ `RenderPolicy.ActiveLyricsWord`, `lyrics-contract.json`), the ambient artwork grading (`shared/utils/ambient.ts` ↔ `Openfy.Core/Ambient.cs`, whose GLSL in `app/lib/ambient-gl.ts` and HLSL in `Graphics/ReactiveSurface.cs` are twins) and the expanded-player layout (`shared/utils/immersive.ts` ↔ `Openfy.Core/Immersive.cs`). The pipe protocol version is `DESKTOP_PROTOCOL` in `shared/types/desktop.ts` and `Contracts.Protocol`. Change both sides and the fixture together.

### Versioning and packaging

`package.json` `version` is the single source: `nuxt.config.ts` exposes it with `OPENFY_BUILD`, and `Directory.Build.props` parses it for the .NET assemblies. `package-desktop.ps1` gives each build a unique number and temporary directories: native publish/staging under `%TEMP%\Openfy\builds`, web output on the workspace volume under `output/web-build-*`. It runs the published exe's startup check from another working directory, publishes the installer and manifest to the local feed (`%LOCALAPPDATA%\Openfy\updates\feed`), and normally updates the existing installation. After verification it retains the current installer and small reports in `output/desktop`, retires obsolete packages, and removes its temporary directories. `-FeedRoot` targets an isolated feed; pair it with `-NoInstall` for QA. See `docs/performance-and-builds.md`. Do not delete another active build's outputs or identify the process that removed a shared `.output` without evidence.

Every version bump needs its "Novedades" entry in `shared/release-notes.json` (Spanish text, newest first; see `docs/release-notes.md`). The PWA bundles it and `Openfy.Core` embeds it; each client shows, once, every entry newer than the version it last saw (`openfy-release-seen` in `localStorage`, `release-notes.json` in the desktop state directory). The selection rule (`shared/utils/release-notes.ts` ↔ `Openfy.Core/ReleaseNotes.cs`) is pinned by `tests/fixtures/release-notes-contract.json`. Vitest and `package-desktop.ps1` refuse a version without an entry.

### Branches and pull requests

The GitHub repository (`LuisRivera-end/openfy`, public) uses two long-lived branches, enforced by repository rulesets (`gh api repos/LuisRivera-end/openfy/rulesets`):

- `dev` is the default branch and where all work lands. Pull requests always target `dev`. The repository admin may push to it directly; everyone else goes through a pull request. Deleting it and force-pushing are blocked.
- `main` only receives accepted releases, through a pull request from `dev` that the owner merges. Nobody pushes to it directly, the admin included (no bypass), and it cannot be deleted or force-pushed. The required status check `Solo dev hacia main` comes from `.github/workflows/pr-base.yml`, a `pull_request_target` workflow that never checks out PR code and closes, with a Spanish comment, any PR to `main` whose head is not this repository's `dev`.

Work locally on `dev` (tracking `origin/dev`) and never push to `main`. Publish a release with `gh pr create --base main --head dev`. Do not change the rulesets, the default branch or that workflow unless the user asks.

## Diagnostics

For failures involving requests, artwork, native↔Node communication or startup, read `docs/session-diagnostics.md` first. The native app writes per-session `native.jsonl` and `backend.jsonl` under `%LOCALAPPDATA%\Openfy\desktop\session-logs\`; they are wiped on the next real launch, so copy both before restarting if the evidence matters. Do not attribute a cause the logs do not show. Persistent Node and native error logs are separate, in `%LOCALAPPDATA%\Openfy\logs`.

Logging must never include signed stream URLs, tokens, query strings or request/response bodies, and a logging failure must never block playback.

## Conventions worth knowing

- `.ps1` files are UTF-8 with BOM and CRLF (`.editorconfig`); Windows PowerShell 5.1 misreads the Spanish strings otherwise.
- `docs/` holds design direction (`design.md`, `home-design.md`, `native-design-parity.md`: the web CSS is the visual reference for the native app) and dated validation records. Physical-iPhone checks listed there as pending cannot be claimed from emulated WebKit runs.
- Generated output (`output/`, `.output/`, `.nuxt/`, `**/bin`, `**/obj`) is ignored and safe to regenerate; `output/desktop` installers and the update feed are release artifacts.
