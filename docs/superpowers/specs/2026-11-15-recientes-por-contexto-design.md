# "Escuchado recientemente" por contexto — diseño

Fecha: 2026-11-15 · Tamaño: cambio pequeño-mediano (servidor, PWA, app de Windows y contrato compartido)

## Intención

Hoy la fila "Escuchado recientemente" muestra cada canción escuchada por separado, aunque se haya reproducido desde favoritas o una playlist. Se quiere que funcione como Apple Music: mostrar **desde dónde** escuchaste (la playlist, tus favoritas, el álbum, el artista) y solo mostrar canciones sueltas cuando las elegiste una por una. Así la fila es variada y no se llena de canciones individuales.

## Reglas (decididas)

| Dónde empezó la reproducción | Qué aparece en la fila |
|---|---|
| Buscador (tocar una canción) | La canción suelta |
| Populares de un artista (tocar una canción concreta) | La canción suelta |
| Botón "Reproducir"/aleatorio de un artista (local o YouTube Music) | Tarjeta del artista |
| Álbum (de la biblioteca o de YouTube Music) | Tarjeta del álbum |
| Una playlist propia | Tarjeta de la playlist |
| Favoritas | Tarjeta "Tus favoritas" |
| Todas las canciones de la biblioteca, descargas, sugerencias del inicio, "Más escuchadas" | No aparece |

- Lo que no aparece **sigue contando** para estadísticas, reproducciones y "Más escuchadas".
- Cada tarjeta aparece una sola vez, en la posición de su escucha más reciente.
- Una tarjeta solo aparece si algo realmente sonó (tiempo escuchado > 0), como hoy.

## No-objetivos / anti-objetivos

- No cambia cómo se cuentan escuchas ni la regla del 90 %.
- No migra ni reinterpreta el historial existente: las sesiones viejas no tienen origen y **no** se convierten en tarjetas. (Decisión del constructor: las sesiones sin origen se tratan como "no aparece"; ver abajo.)
- No se escribe nada en la base fuera de las sesiones de escucha existentes: sin bump de `user_version`.

## Enfoques considerados

- **A. Origen por canción en la cola (elegido).** Cada entrada de la cola lleva su origen; al empezar a escucharla, el origen se copia a la sesión de escucha, que ya viaja al servidor por la cola de envío durable. Funciona sin conexión, solo cuenta lo que sonó, y lo que se añade a la cola conserva su propio origen.
- B. Origen solo al iniciar la cola: más simple, pero lo añadido después hereda un origen equivocado.
- C. Tabla aparte de "orígenes recientes" al pulsar reproducir: cuenta lo saltado al instante, no registra sin conexión y obliga a subir la versión del esquema (empaquetado, instalador, maintenance).

## Diseño

**Origen (`ListeningContext`)**, opcional, tipo compartido TS ↔ .NET:

- `{ kind: 'song' }` — buscador o populares de artista.
- `{ kind: 'favorites' }`
- `{ kind: 'playlist', id }`
- `{ kind: 'album', id, title, subtitle, artwork }` — `id` es el id de álbum local (ruta `/album/<id>`) o el de YouTube Music con prefijo `youtube:` (ruta `/music/album/<id>`).
- `{ kind: 'artist', id, title, artwork }` — nombre del artista local (ruta `/artist/<nombre>`) o id de canal YouTube con prefijo `youtube:` (ruta `/music/artist/<id>`).

Álbum y artista guardan nombre y portada porque los de YouTube Music no viven en la biblioteca; el servidor usa esos datos guardados también para los locales (las playlists sí se leen de la biblioteca, para reflejar renombres y borrados).

**Flujo:**
1. `PlaybackEntry` gana `context?` (como `queueId`). `playEntries`/`playYouTube`/`playTracks` y `enqueue` en la PWA, y `PlayAsync`/`Enqueue` en Windows, reciben el origen del lugar que reproduce. Sin origen = no aparece.
2. `ListeningAccumulator` (TS y C#) copia `entry.context` a `session.context` al crear la sesión. El esquema zod de sesiones acepta `context` opcional; la identidad de la sesión no cambia.
3. `recentlyPlayed()` recorre las sesiones con tiempo escuchado, ordenadas por `updatedAt`, y agrupa por clave de origen (`song:<trackKey>`, `favorites`, `playlist:<id>`, `album:<id>`, `artist:<id>`). Descarta orígenes cuyo destino ya no existe (playlist borrada; canción local eliminada) y devuelve hasta `limit` tarjetas.
4. Respuesta de `/api/telemetry/recent`: `items` pasa a ser una lista de tarjetas `{ kind, key, id, title, subtitle, artwork, lastPlayedAt, item }` (`item` solo en canciones); cada cliente arma su propia navegación a partir de `kind` + `id`. Cambia el tipo `RecentListening` en `shared/types/telemetry.ts` y en `Openfy.Core/Listening.cs`; la caché local `listening-recent` se renombra (`listening-recent-v2`) para no leer el formato viejo.
5. Inicio (PWA y Windows): canción suelta = la tarjeta actual (tocar reproduce esa canción con origen `song`); álbum/artista/playlist/favoritas = tarjeta de colección que navega a su página, con el mismo estilo que "Tus favoritas y playlists".

**Contrato:** `listening-contract.json` añade un caso con `context` para fijar que ambas implementaciones lo conservan en la sesión. Se actualizan `tests/unit/telemetry.test.ts`, `ListeningTests` y `tests/e2e/home.spec.ts`.

## Decisiones que dejo al constructor (marcadas como mías)

- Sesiones viejas sin origen: no aparecen. Consecuencia: tras el cambio la fila empieza casi vacía y se llena con lo nuevo.
- Volver a reproducir desde una tarjeta suelta de la fila mantiene origen `song`; las tarjetas de colección navegan, no reproducen.
- Shuffle o repetir no cambian el origen de cada entrada.
