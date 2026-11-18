# Descargas de YouTube Music

Openfy obtiene el audio con YouTube.js en el PC, guarda AAC en un M4A normalizado y lo asocia a la clave `youtube:<videoId>`. Favoritos, playlists, cola, letras y estadísticas conservan esa identidad. La descarga no crea otra pista importada.

## Uso

- Las opciones de una canción permiten descargarla en el dispositivo actual.
- Las filas de canciones en playlists, biblioteca y búsquedas muestran una flecha dentro de un círculo verde cuando están descargadas. En Windows indica «Descargada en este PC» e incluye los archivos importados; en la PWA aparece solo al terminar y verificar la copia del dispositivo. Se actualiza al descargar o eliminar una copia y sigue visible en pantallas móviles.
- En un álbum o playlist, **Descargar** activa **Mantener descargado**. Al añadir canciones a una playlist marcada, Openfy descarga las nuevas automáticamente.
- La cabecera de Favoritas incluye **Descargar favoritas** en Windows y web. Solicita todas las favoritas actuales, aunque la búsqueda o «Solo descargadas» oculten parte de la colección. Windows conserva los archivos locales y solicita el audio de YouTube que falta en lotes de hasta cien canciones; la web verifica su copia en el dispositivo.
- La preferencia pertenece a cada dispositivo: marcar una playlist en Windows no la marca también en el iPhone.
- Quitar canciones, borrar una playlist o dejar de actualizarla conserva los archivos. Descargas permite eliminarlos explícitamente.
- Una eliminación o cancelación manual crea una exclusión local. La sincronización de una playlist no vuelve a descargar esa canción hasta solicitarla de nuevo.
- Las copias compartidas por varias referencias no se eliminan mientras otra descarga las necesite. Los originales importados no se borran al eliminar una copia de YouTube.

Windows reproduce directamente el archivo del PC cuando existe. La PWA prefiere su copia verificada y después el archivo del PC; el streaming queda para canciones que no están descargadas. Si termina la descarga de una canción que está sonando por streaming, el reproductor cambia a la copia local conservando la posición y el estado de reproducción o pausa.

Una canción de YouTube descargada usa únicamente sus recursos locales para reproducirse y mostrar su portada, metadatos y letras. No consulta YouTube Music, LRCLIB ni los servidores de imágenes, aunque haya conexión. La letra guardada no caduca para una descarga y «Reintentar letras» tampoco consulta al proveedor. Incluso una URL de streaming conservada en una cola antigua se dirige al asset local, con soporte de rangos y HEAD.

Las nuevas descargas intentan guardar la letra antes de publicar la copia completa. Si el proveedor no ofrece portada o letra, o no se pudo obtenerlas durante la descarga, se muestra una portada neutra o la letra como no disponible. Las descargas anteriores reutilizan lo que ya tengan guardado; no completan recursos faltantes automáticamente. Si el audio local falla, se indica que debe volver a descargarse y no se activa streaming. Buscar en el catálogo o abrir información externa de artistas sigue requiriendo conexión.

## iPhone y recuperación

El iPhone solicita primero la preparación en el PC y después verifica su propia copia por tamaño y SHA-256. Los indicadores **Disponible en el PC** y **Disponible sin conexión** no son equivalentes.

La PWA debe permanecer abierta para completar la transferencia. Si está cerrada o suspendida, detectará los cambios al abrirse y recuperar conexión. La biblioteca se comprueba cada 2,5 segundos con trabajo pendiente y cada 30 segundos sin actividad, además de la apertura, reconexión y ediciones locales.

Las solicitudes y colecciones sobreviven a la reapertura. Un archivo incompleto se vuelve a descargar desde el inicio. Los errores transitorios admiten tres intentos en total; los fallos de integridad y espacio requieren reintento. Las copias terminadas no se eliminan automáticamente. iOS sigue pudiendo desalojar el almacenamiento de la PWA.

El catálogo externo requiere conexión. Los snapshots de álbumes descargados permiten abrir su lista ordenada sin consultar al proveedor.

## Persistencia y API

SQLite v5 añade `youtube_audio`, `audio_downloads` y `offline_collections`. Los archivos viven en `originals` con nombres UUID; los temporales viven en `staging`. IndexedDB v4 conserva las tablas existentes y añade `offlineCollections` y `downloadExclusions`.

| Método y ruta | Función |
|---|---|
| `POST /api/music/downloads` | `{ songs, intent: 'manual' \| 'automatic' }`, hasta 100 por petición; devuelve trabajos con HTTP 202 |
| `GET /api/music/downloads` | Estado y progreso de la cola del PC |
| `PATCH /api/music/downloads/:id` | `{ action: 'cancel' \| 'retry' }` |
| `GET /api/offline/collections` | Colecciones marcadas en el PC |
| `PUT /api/offline/collections/:kind/:id` | `{ enabled }`, con `kind` álbum o playlist |
| `DELETE /api/music/youtube/:videoId/local-audio` | Elimina únicamente la asociación y copia del PC que no comparta otro propietario |

`SavedYouTubeSong.localAudio` es opcional e incluye descriptor del asset, duración medida, portada local, paleta y fecha. Las rutas de assets y el protocolo de escritorio permanecen compatibles. El puente añade `downloadProgress`; la publicación emite `libraryChanged`.

Hay un trabajo por video y una transferencia de red simultánea. El trabajador comparte la ejecución serial con importaciones y conversiones. Comprueba tamaño, formato, decodificación completa y espacio; normaliza con FFmpeg sin recodificar. Las portadas y letras son opcionales. El cierre aborta el trabajo activo antes de cerrar SQLite y lo deja pendiente para el arranque siguiente.

La lista de descargas de Windows virtualiza las filas: conserva las visibles y una pequeña caché, aunque haya cientos de trabajos. El progreso actualiza solo el trabajo correspondiente. Las actualizaciones de biblioteca conservan la lista y su desplazamiento, y la cola elimina una sola entrada al avanzar. La lectura de mensajes de Node, la serialización HTTP y la preparación del audio se ejecutan fuera del hilo de la interfaz. Los snapshots HTTP verifican las copias mediante disco asíncrono en lotes acotados.

La actualización mantiene SQLite y todas sus tablas en el respaldo. El paquete declara compatibilidad hasta v5; una versión anterior limitada a v4 requiere restaurar un respaldo compatible.

## Verificación

- `npm test`: incluye archivos completos y truncados, recuperación, conservación de identidad, playlists automáticas y exclusiones.
- `tests/e2e/downloads.spec.ts`: usa AAC sintetizado y assets HTTP reales para verificar la actualización y escucha offline en Chromium y WebKit.
- `node scripts/check-downloads.mjs <entrada-del-backend> [informe]`: descarga dos muestras reales en una biblioteca temporal, verifica SHA-256, actualización de playlist, conservación y reinicio. No usa la biblioteca personal.
- `Openfy.exe --workspace <workspace> --data-dir <biblioteca-de-prueba> --state-dir <estado-de-prueba> --port <puerto> --offline-test <videoId>`: comprueba reproducción WASAPI, seek y pausa de una canción de YouTube ya descargada, y escribe `offline-smoke.json`.

Las pruebas automatizadas no confirman las suspensiones, auriculares ni pantalla bloqueada de un iPhone físico. Esa aceptación permanece pendiente.

Consulta los [resultados de validación y el instalador generado](downloads-validation.md).

La política de recursos locales se verificó por separado: [validación de canciones descargadas sin consultas externas](downloaded-resources-validation.md).
