# "Escuchado recientemente" por contexto — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La fila "Escuchado recientemente" muestra tarjetas por origen (canción suelta, favoritas, playlist, álbum, artista) en lugar de cada canción escuchada.

**Architecture:** Cada `PlaybackEntry` de la cola lleva un `context` opcional; el acumulador de escucha (TS y C#) lo copia a la sesión, que ya viaja por la cola de envío durable. `recentlyPlayed()` agrupa sesiones por clave de origen y devuelve `RecentCard[]`. Sin bump de esquema SQLite ni de Dexie.

**Tech Stack:** Nitro + zod + Drizzle/SQLite, Nuxt 4 / Pinia, .NET 10 / WinUI 3, Vitest, xUnit, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-recientes-por-contexto-design.md`

**Estado:** Implementado en servidor, PWA y Windows. Ver [resultados y verificación](2026-11-15-recientes-por-contexto-resultados.md). La implementación también incluye los botones compartidos de colección, el store de inicio y la conservación del contexto al actualizar metadatos de entradas repetidas.

## Global Constraints

- Textos de UI en español; código y comentarios en inglés.
- Sin bump de `PRAGMA user_version` ni de Dexie. Al implementar, el repositorio ya estaba en SQLite 5 e IndexedDB 4 por cambios anteriores; se conservan esas versiones.
- Lo que no tiene origen sigue contando en estadísticas y "Más escuchadas"; solo deja de aparecer en la fila.
- Sesiones antiguas sin `context` no aparecen en la fila.
- Cambiar TS, .NET y `tests/fixtures/listening-contract.json` juntos.
- Las pruebas usan directorios temporales con `OPENFY_DATA_DIR`; nunca la biblioteca personal.
- Sin commits salvo que el usuario lo pida (el repo aún está sin seguimiento).

## Review Focus

1. Playlist borrada después de escucharla → su tarjeta desaparece, sin error (test en Task 2).
2. La misma canción escuchada suelta y dentro de una playlist → aparece una tarjeta de canción y una de playlist, cada una una vez (test en Task 2).
3. Canción añadida a la cola desde el buscador mientras suena una playlist → cuenta como suelta (cubierto por `enqueue` con contexto en Task 3; verificación manual en Task 6).
4. Caché `listening-recent` con el formato viejo en un dispositivo → no rompe el inicio, se ignora (clave `listening-recent-v2`, Tasks 3 y 5).
5. Sesión C# con álbum sin portada (Artwork null omitido al serializar) → el servidor la acepta (zod `artwork` opcional y nullable; test en Task 1).

---

### Task 1: Contexto en tipos, acumulador TS y contrato

**Files:**
- Modify: `shared/types/music.ts:172` (`PlaybackEntry`)
- Modify: `shared/types/telemetry.ts` (`ListeningSession`, nuevo `ListeningContext`)
- Modify: `shared/utils/telemetry.ts` (constructor de `ListeningAccumulator`)
- Modify: `server/utils/telemetry.ts:16-30` (`listeningSessionSchema`)
- Modify: `tests/fixtures/listening-contract.json` (añadir `"context"`)
- Test: `tests/unit/telemetry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/types/telemetry.ts
  export type ListeningContext =
    | { kind: 'song' } | { kind: 'favorites' } | { kind: 'playlist'; id: string }
    | { kind: 'album' | 'artist'; id: string; title: string; subtitle: string; artwork?: string | null }
  // ListeningSession gains: context?: ListeningContext
  // PlaybackEntry intersection gains: context?: ListeningContext  (import type from telemetry)
  export const listeningContextSchema // zod, exported from server/utils/telemetry.ts
  ```
  Ids de álbum/artista de YouTube Music llevan prefijo `youtube:`; los locales no (álbum = `Album.id`, artista = `Artist.name`).

- [ ] **Step 1: Tests que fallan.** En `telemetry.test.ts`:
  - `it('keeps the entry context on the session and across restoration')`: `new ListeningAccumulator({ ...entry, context: fixture.context }, …).checkpoint().context` `toEqual(fixture.context)`; restaurado desde ese checkpoint con un entry sin contexto conserva `fixture.context`; sin contexto → `checkpoint()` no tiene la propiedad `context` (`not.toHaveProperty('context')`).
  - `it('validates listening contexts')`: `listeningSessionSchema.safeParse(session(1000, { context: { kind: 'album', id: 'youtube:MPRE1', title: 'A', subtitle: 'B' } })).success` es `true` (sin artwork); `{ kind: 'playlist' }` sin id → `false`; `{ kind: 'nope' }` → `false`; `title` de 501 caracteres → `false`.
  - Fixture: `"context": { "kind": "album", "id": "youtube:MPREb_contract", "title": "Contrato", "subtitle": "Openfy", "artwork": null }`.
- [ ] **Step 2:** `npx vitest run tests/unit/telemetry.test.ts` → FAIL (no hay `context`).
- [ ] **Step 3: Implementar.** Constructor del acumulador: sesión nueva toma `context` de `entry.context` solo si existe (no escribir `context: undefined`); una restaurada conserva el suyo. Schema: `listeningContextSchema` como `z.discriminatedUnion('kind', …)`; `id` 1–512, `title`/`subtitle` 0–500, `artwork` `z.string().max(2048).nullable().optional()`; la sesión acepta `context: listeningContextSchema.optional()`.
- [ ] **Step 4:** `npx vitest run tests/unit/telemetry.test.ts` → PASS.

### Task 2: `recentlyPlayed()` agrupa por origen

**Files:**
- Create: `shared/utils/recent.ts`
- Modify: `shared/types/telemetry.ts` (`RecentCard`, `RecentListening`)
- Modify: `server/utils/telemetry.ts:88-95`
- Test: `tests/unit/telemetry.test.ts` (reemplazar los dos tests de recientes de las líneas 61-81)

**Interfaces:**
- Consumes: `ListeningContext` (Task 1).
- Produces:
  ```ts
  export interface RecentCard { kind: ListeningContext['kind']; key: string; id: string | null; title: string; subtitle: string; artwork: string | null; lastPlayedAt: number; item: LibraryItem | null }
  export interface RecentListening { items: RecentCard[] }
  // shared/utils/recent.ts
  export function contextKey(context: ListeningContext, trackKey: string): string // 'song:<trackKey>' | 'favorites' | 'playlist:<id>' | 'album:<id>' | 'artist:<id>'
  export function recentRoute(card: RecentCard): string | null
  // song → null; favorites → '/favorites'; playlist → `/playlist/${encodeURIComponent(id)}`;
  // album → id con 'youtube:' ? `/music/album/${encodeURIComponent(resto)}` : `/album/${encodeURIComponent(id)}`;
  // artist → id con 'youtube:' ? `/music/artist/${encodeURIComponent(resto)}` : `/artist/${encodeURIComponent(id)}`
  export function recentlyPlayed(limit = 12): RecentListening // server/utils/telemetry.ts, misma firma
  ```

- [ ] **Step 1: Tests que fallan:**
  - `it('groups recent listening by context, newest first, once per card')`: sesiones con `listenedMs > 0`: canción A con `{kind:'song'}` (t+1000), canción B con playlist P (t+2000), canción C con playlist P (t+3000), canción A con favoritas (t+4000), álbum YouTube (t+5000), artista local (t+6000), canción D sin contexto (t+7000), canción E con `{kind:'song'}` y `listenedMs: 0` (t+8000). La biblioteca temporal debe contener la playlist P (crearla con la utilidad de playlists del servidor). Esperado `items.map(i => i.key)` = `['artist:Openfy', 'album:youtube:MPRE1', 'favorites', 'playlist:<P>', 'song:youtube:<A>']`; tarjeta de playlist con `title` = nombre de P, `subtitle` 'Playlist', `lastPlayedAt` t+3000; tarjeta de canción con `item.id` `youtube:<A>` y `title`/`subtitle` del item; favoritas `title` 'Tus favoritas'; álbum/artista copian `title`/`subtitle`/`artwork` del contexto (artista local con `subtitle` 'Artista' si el contexto lo trae vacío). `recentlyPlayed(2).items` tiene 2.
  - `it('drops recent cards whose target no longer exists')`: playlist con id inexistente y canción local con `trackId` inexistente (ambas con contexto) → no aparecen.
  - `it('orders equal timestamps by key')`: dos `song` con mismo `updatedAt` → orden por `key` ascendente.
  - `contextKey`/`recentRoute`: un `it` con las seis rutas de arriba, incluido un nombre de artista local con espacio y acento.
- [ ] **Step 2:** `npx vitest run tests/unit/telemetry.test.ts` → FAIL.
- [ ] **Step 3: Implementar `recentlyPlayed`.** Recorre `listeningSessions` (snapshot), ignora sin `context` o con `listenedMs === 0`, agrupa por `contextKey` quedándose con el `updatedAt` máximo, resuelve cada grupo y descarta los que no resuelven: canción → `listeningItems().get(trackKey)`; playlist → `readLibrary().playlists` por id, `artwork` = primera portada de sus `trackIds` en `listeningItems()`; favoritas → `subtitle` `${n} canciones` con `n` = items favoritos (0 se muestra igual); álbum/artista → del contexto. Orden `lastPlayedAt` desc, luego `key` asc; `slice(0, limit)`.
- [ ] **Step 4:** `npx vitest run tests/unit` → PASS (`validates the recent endpoint limit` de e2e no cambia).

### Task 3: La PWA registra el origen y pinta las tarjetas

**Files:**
- Modify: `app/stores/player.ts` (`startQueue`, `playTracks`, `playYouTube`, `playEntries`, `enqueue`, `enqueueYouTube`)
- Modify: `app/components/YouTubeTrackList.vue`, `app/components/TrackList.vue`, `app/components/CollectionTrackList.vue`, `app/components/HomeSongCard.vue`, `app/components/HomePage.vue`
- Modify: `app/pages/[[...view]].vue`, `app/pages/music/album/[id].vue`, `app/pages/music/artist/[id].vue`
- Test: `tests/e2e/home.spec.ts`

**Interfaces:**
- Consumes: `ListeningContext`, `RecentCard`, `recentRoute` (Tasks 1-2).
- Produces (player store): `playEntries(entries, start = 0, context?: ListeningContext)`, `playTracks(ids, start = 0, context?)`, `playYouTube(songs, start = 0, context?)`, `enqueue(id, context?)`, `enqueueYouTube(song, context?)`. `startQueue` pone `context` en cada entrada; `telemetry.select` no cambia (el acumulador lo lee del entry). Componentes: prop `context?: ListeningContext` en `YouTubeTrackList` (por defecto `{ kind: 'song' }`), `CollectionTrackList` (por defecto ninguno) y `HomeSongCard` (para su `enqueue`); se usa tanto al reproducir como al añadir a la cola.

Mapa de orígenes (spec):
| Lugar | Contexto |
|---|---|
| `search.vue` (`YouTubeTrackList`, `TrackList`) | `{ kind: 'song' }` (`TrackList` lo fija siempre) |
| Populares de `music/artist/[id].vue` (`YouTubeTrackList`) | `{ kind: 'song' }` (por defecto) |
| Botones "Reproducir" y aleatorio de `music/artist/[id].vue` | `{ kind: 'artist', id: 'youtube:'+id, title: nombre, subtitle: 'Artista', artwork }` |
| `music/album/[id].vue` (botón y lista) | `{ kind: 'album', id: 'youtube:'+id, title, subtitle: artistas unidos por ', ', artwork }` |
| `[[...view]].vue` favoritas / playlist / álbum / artista (botón y lista) | computed `listeningContext`: `{kind:'favorites'}` / `{kind:'playlist', id}` / `{kind:'album', id: selectedAlbum.id, title, subtitle: artist, artwork}` / `{kind:'artist', id: selectedArtist.name, title: name, subtitle: 'Artista', artwork}`; `undefined` en biblioteca |
| Más escuchadas, descargas, sugerencias del inicio | sin contexto |
| Tarjeta de canción en "Escuchado recientemente" | `{ kind: 'song' }` |

- [ ] **Step 1: e2e que falla.** En `mockHome`, `/api/telemetry/recent` devuelve 12 tarjetas: 10 `song` (`item` como hoy, `key` `song:<id>`) más `{ kind: 'playlist', key: 'playlist:p1', id: 'p1', title: 'Para correr', subtitle: 'Playlist', artwork: null, item: null }` y `{ kind: 'album', key: 'album:youtube:MPRE1', id: 'youtube:MPRE1', title: 'Álbum reciente', subtitle: 'Openfy', … }`. Nuevo test `shows recent collections as links and songs as playable cards`: en la región "Escuchado recientemente" hay 10 `.home-song` y los links `Para correr` (href `/playlist/p1`) y `Álbum reciente` (href `/music/album/MPRE1`). El test de caché offline (líneas 88-92) espera ahora 10 `.home-song` en esa región.
- [ ] **Step 2:** `npm run build` y luego `npx playwright test tests/e2e/home.spec.ts --project=chromium` → FAIL.
- [ ] **Step 3: Implementar.** Cambios en el player y en los componentes según la tabla. `HomePage.vue`: `recent` es `RecentListening` nuevo; tarjetas `song` usan `HomeSongCard` (al reproducir: `playEntries(songItems.map(i => i.entry), i, { kind: 'song' })`, cola = solo las tarjetas de canción); las demás usan el mismo marcado `NuxtLink.home-collection` que "Tus favoritas y playlists" (`AlbumCover favorite` para favoritas), con `to = recentRoute(card)`, `:key="card.key"` y el orden del servidor. `known` toma `item` solo de las tarjetas de canción. Caché local: `listening-recent-v2`. Antes de editar `HomePage.vue`, volver a leerlo: cambió durante la exploración.
- [ ] **Step 4:** `npm run typecheck` sin errores; `npm run build`; `npx playwright test tests/e2e/home.spec.ts` (ambos proyectos) → PASS.

### Task 4: .NET Core — contexto, acumulador y tarjetas

**Files:**
- Modify: `desktop/Openfy.Core/Contracts.cs:45` (`PlaybackEntry`)
- Modify: `desktop/Openfy.Core/Listening.cs` (`ListeningContext`, `ListeningSession`, `RecentCard`, `RecentListening`, constructor del acumulador)
- Test: `desktop/Openfy.Tests/ListeningTests.cs`

**Interfaces:**
- Produces:
  ```csharp
  public record ListeningContext(string Kind, [WhenWritingNull] string? Id = null, [WhenWritingNull] string? Title = null, [WhenWritingNull] string? Subtitle = null, [WhenWritingNull] string? Artwork = null);
  // PlaybackEntry gains trailing: [WhenWritingNull] ListeningContext? Context = null
  // ListeningSession gains trailing: [WhenWritingNull] ListeningContext? Context = null
  public record RecentCard(string Kind, string Key, string? Id, string Title, string Subtitle, string? Artwork, long LastPlayedAt, LibraryItem? Item);
  public record RecentListening(RecentCard[] Items);
  ```
  (`[WhenWritingNull]` = `[property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]`, como `QueueId`.)

- [ ] **Step 1: Tests que fallan:** `KeepsTheContractContextOnTheSession`: lee `context` de `listening-contract.json`, crea el acumulador con `entry with { Context = context }`, y `Checkpoint().Context` es igual; serializado con `Contracts.Json`, la propiedad `context` coincide con el JSON del fixture (sin `artwork`, porque es null y se omite; el resto igual). Una sesión sin contexto no serializa `context`. Restaurar desde el checkpoint con un entry sin contexto conserva el contexto. `DeserializesRecentCards`: `{"items":[{"kind":"playlist","key":"playlist:p1","id":"p1","title":"Para correr","subtitle":"Playlist","artwork":null,"lastPlayedAt":5,"item":null}]}` → `Items[0].Kind == "playlist"`, `Item == null`.
- [ ] **Step 2:** `& "$env:LOCALAPPDATA\Openfy\development\dotnet\dotnet.exe" test desktop/Openfy.Tests -c Release --filter "FullyQualifiedName~ListeningTests"` → FAIL (compilación).
- [ ] **Step 3: Implementar.** Constructor: sesión nueva `Context = entry.Context`; restaurada conserva la suya. Corregir los usos de `RecentListening.Items[].Item` que no compilen (los arregla la Task 5; aquí basta con que `Openfy.Core` y `Openfy.Tests` compilen).
- [ ] **Step 4:** Mismo comando → PASS.

### Task 5: App de Windows — origen por página e inicio

**Files:**
- Modify: `desktop/Openfy.Windows/ViewModels/MainViewModel.cs` (`PlayAsync` :359, `Enqueue` :406, nuevas propiedades)
- Modify: `desktop/Openfy.Windows/ViewModels/MainViewModel.Listening.cs:49-51,62` y `MainViewModel.cs:167` (clave de caché)
- Modify: `desktop/Openfy.Windows/Views/MainWindow.Artist.cs:109,113`, `MainWindow.Catalog.cs:160,277`, `MainWindow.Shell.cs:102`, `MainWindow.Home.cs:20,42-44,73,153,189`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  ```csharp
  public Task PlayAsync(SongRow song, IEnumerable<SongRow>? collection = null, ListeningContext? context = null) // pone Context en cada entrada de la cola
  public void Enqueue(SongRow song) // usa ItemContext
  public ListeningContext? PageContext { get; } // botón Reproducir/aleatorio de la página
  public ListeningContext? ItemContext { get; } // clic en una canción de la lista
  ```
  `PageContext` por `page`: `favorites` → favoritas; `playlist` → `("playlist", playlistId)`; `localalbum` → `("album", localAlbumId, Heading, CatalogSubtitle, CatalogArtwork)`; `localartist` → `("artist", localArtistName, Heading, "Artista", CatalogArtwork)`; `album` → `("album", "youtube:"+catalogId, Heading, CatalogSubtitle, CatalogArtwork)`; `artist` → `("artist", "youtube:"+catalogId, Heading, "Artista", CatalogArtwork)`; resto → null. `ItemContext`: `search`, `localSearch` y `artist` → `("song")`; resto → `PageContext`.

- [ ] **Step 1:** Botones de Reproducir/aleatorio (Artist.cs, Catalog.cs:160 y :277) pasan `model.PageContext`; `Shell.cs:102` pasa `model.ItemContext`; `PlayAsync` pone el contexto en cada `Entry`.
- [ ] **Step 2: Inicio.** `HomeSongCard` gana `ListeningContext? listening = null`, que se pasa a `PlayAsync` (sugerencias: null; recientes: `("song")`). Los recientes se pintan en el orden del servidor: `Kind == "song"` → `HomeSongCard(model.Describe(card.Item!.Entry), songRows, listening: new("song"))`; resto → `HomeCollectionCard(card.Title, card.Subtitle, card.Artwork, action, favorite: card.Kind == "favorites", key: card.Key)`, con acción: favoritas `ShowLocal("favorites")`; playlist `ShowLocal("playlist", card.Id)`; álbum con `youtube:` `AlbumAsync(resto)`, si no `ShowLocalAlbum(card.Id)`; artista con `youtube:` `ArtistAsync(resto)`, si no `ShowLocalArtist(card.Id)`. La firma de la línea 20 usa `card.Key + card.Artwork + card.Title + card.Subtitle`. `hasMusic` cuenta las tarjetas. Caché: `listening-recent-v2`.
- [ ] **Step 3:** `.\scripts\setup-desktop.ps1` (o el build Release de `Openfy.Windows` con el SDK privado) compila sin errores ni avisos nuevos. Detener el servidor antes.

### Task 6: Verificación completa

- [ ] `npm test` → todos PASS.
- [ ] `npm run typecheck` → sin errores.
- [ ] `npm run build` y `npm run test:e2e` → PASS (o, como mínimo, `home.spec.ts` y `lyrics.spec.ts` en ambos proyectos; anotar cualquier spec que no se haya corrido).
- [ ] `dotnet test desktop/Openfy.Tests -c Release` con el SDK privado → PASS.
- [ ] Prueba manual con datos aislados (`Openfy.exe --data-dir <temp> --state-dir <temp> --port <libre>` o `npm start` con `OPENFY_DATA_DIR` temporal): reproducir desde buscador, favoritas, una playlist, un álbum y "Reproducir" de un artista, y añadir a la cola una canción del buscador mientras suena la playlist; confirmar que la fila muestra canción, favoritas, playlist, álbum y artista, cada uno una vez, y la canción añadida como suelta. Si no se puede hacer, decirlo en el resumen.
