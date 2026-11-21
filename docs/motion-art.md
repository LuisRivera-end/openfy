# Portadas animadas (motion art)

La portada grande del reproductor ampliado se sustituye por el vídeo corto en bucle del álbum cuando Apple Music tiene uno. Aplica a la web y la PWA (escritorio y teléfono, también en el Big Picture girado), a la ventana `fullscreen` de Windows y a Android nativo.

## Origen y riesgo

Apple no ofrece una API pública para estas portadas. Openfy usa lo mismo que recibe el reproductor web de Apple Music:

1. Busca el álbum en la iTunes Search API pública (`entity=album`).
2. Si iTunes no produce un Motion válido, busca también en el catálogo de Apple Music (`/v1/catalog/<tienda>/search?types=albums`). Ambas búsquedas reciben el artista y el álbum, con hasta 25 resultados y tres candidatos coincidentes por método. No se repiten consultas de detalle para un mismo ID.
3. Lee el token de desarrollador que el reproductor web incluye en su script principal. Se comparte entre la búsqueda de Apple y las fichas, con una renovación si se rechaza.
4. Pide la ficha del álbum a `amp-api.music.apple.com` con `extend=editorialVideo` y toma `motionDetailSquare` (o `motionSquareVideo1x1`). Un resultado válido del respaldo puede recuperar un fallo del primer método.
5. Descarga la variante H.264 más grande hasta 1080 px desde el HLS, que no está cifrado. El ID se obtiene del resultado real, sin excepciones fijadas para álbumes concretos.

El endpoint del catálogo y el token no tienen contrato para terceros. Pueden cambiar o cerrarse sin aviso, y su uso probablemente no está contemplado en los términos de Apple. Los vídeos son contenido con licencia: esta función está pensada para una biblioteca personal, no para redistribuir.

Si algo cambia, Openfy deja de encontrar vídeos y sigue con la portada estática. No muestra errores. Solo salen del servidor el nombre del artista y el del álbum.

## Coincidencia

Solo se acepta un álbum con el mismo título y uno de los mismos artistas, comparados sin mayúsculas, acentos ni puntuación (`metadataKey`). Se ignoran los sufijos ` - Single` y ` - EP`. Una edición distinta, como «(Deluxe)», no coincide. Con duda no se muestra nada. Las canciones sin álbum o sin artista no se consultan.

Los nombres compuestos únicamente por símbolos conservan esos símbolos como clave: el álbum «?» y el artista «¥$» también se consultan y no se confunden con otros nombres de puntuación. Las claves de los demás álbumes se conservan para reutilizar los vídeos existentes.

## Almacenamiento

Todo ocurre en el servidor (`server/utils/apple-motion.ts`, `server/utils/motion-art.ts`). No hay cambios en SQLite.

- `motion-cache/<clave>/motion.mp4` y `metadata.json`, dentro del directorio de datos. La clave es el SHA-256 del artista principal y el álbum normalizados.
- El HLS se guarda como MP4 normal, sin audio, con FFmpeg (`-c:v copy -movflags +faststart`).
- `none` es una ausencia verificada de vídeo cuadrado después de completar ambas búsquedas; se recuerda 30 días. `unmatched` significa que no pudo resolverse el álbum o quedaron candidatos sin verificar; se recuerda un día. Un fallo en una consulta necesaria impide guardar una ausencia.
- Los errores temporales no se convierten en negativos: aplican esperas de 15 minutos que crecen hasta seis horas. La cola conserva un temporizador para el próximo vencimiento aunque no cambie la biblioteca.
- Los negativos nuevos incluyen `resolverRevision: 2`. Los negativos antiguos se revisan automáticamente de nuevo. Los MP4 válidos se reutilizan aunque sean de una revisión anterior; no se borra la caché para migrar. Una carpeta vacía o un MP4 faltante no se consideran un álbum resuelto.
- **Permanentes:** los álbumes de la biblioteca local y de las canciones descargadas al PC. Un paso de fondo de mínima prioridad los completa de uno en uno, con unos segundos entre peticiones y esperas crecientes ante fallos. Espera a que termine la consulta de géneros de las canciones guardadas, porque ambas usan la iTunes Search API y comparten su límite de peticiones.
- **Caché:** lo que solo se ve en streaming. Al superar 1 GB se eliminan los vídeos mostrados hace más tiempo.
- La copia de seguridad de las actualizaciones no incluye esta carpeta: se puede regenerar.

Tamaño orientativo: entre 5 y 15 MB por álbum con vídeo.

## Clientes

- `POST /api/motion/resolve` con la entrada en reproducción devuelve `{ status: 'ready', url, width, height }`, `{ status: 'none', retryAfterMs }` o `{ status: 'unmatched', retryAfterMs }`. Los clientes siguen admitiendo `none` sin tiempo de espera para compatibilidad. Si el proveedor no responde, devuelve 503 con `Retry-After` y `data.retryAfterMs`; se conserva la portada fija.
- `GET /api/motion/<clave>.mp4` sirve el archivo con Range.
- Web: `useMotionArt.ts` y `MotionArt.vue`. El vídeo aparece con un fundido cuando empieza a reproducirse y se detiene con la música o al ocultar la pestaña. En el teléfono se muestra en la portada grande del reproductor ampliado, igual que en Android; si el navegador informa ahorro de datos o red móvil (`navigator.connection`), se queda la portada fija. Safari en iPhone no expone ese dato, así que allí el vídeo también se pide con datos móviles. El service worker deja `/api/motion/*` en la red sin despertarse, como el audio en streaming.
- Windows: `Views/PlayerWindow.Motion.cs`, con `MediaPlayer` en bucle, silenciado y fuera de los controles multimedia del sistema. Win2D dibuja los fotogramas en una superficie XAML con el mismo radio que la portada; los fotogramas permanecen en la GPU y solo se solicita dibujo al recibir uno nuevo o al cambiar de tamaño. En pausa se conserva el último fotograma sin un bucle de renderizado.
- La portada de 56 px del diseño apilado, la tarjeta «A continuación» y el fondo ambiental usan siempre la imagen fija.
- Las cachés de web y Windows vencen los negativos y los errores; un resultado temporal vuelve a consultarse cuando corresponde si el mismo álbum sigue visible. Ocultar/cerrar la vista detiene el temporizador; volver a abrirlo respeta o reactiva la espera restante.
- Se desactiva con **Ajustes → Portadas animadas**, con «Movimiento ambiental» apagado o con el movimiento reducido del sistema.
- Android nativo no usa este servidor. `ui/MotionRepository.kt` resuelve desde el teléfono con la misma secuencia (iTunes Search, catálogo de Apple Music y `editorialVideo`) y la misma coincidencia estricta.
  - Vive en la aplicación: el token y los resultados sobreviven al cerrar el reproductor.
  - Los resultados se guardan en disco con los mismos plazos que aquí: `none` 30 días, `unmatched` 1 día, y los errores temporales no cuentan como negativos.
  - El vídeo pasa por una caché LRU de 300 MB de Media3. Con red medida solo se reproduce lo que ya está en caché; si no hay nada, se queda la portada fija.
  - `MotionArtwork` lo muestra en el reproductor ampliado y en la cabecera de álbum, con un único decodificador a la vez (el reproductor ampliado tiene prioridad). Se pausa con la música y al ocultarse.
  - Lo controlan **Ajustes → Portadas animadas con Wi-Fi**, «Movimiento ambiental» y la escala de animación del sistema.
  - El 17 de noviembre de 2026, `music.apple.com/us/browse` empezó a responder 301 hacia `/us/new`. El cliente Android no sigue redirecciones de forma general, así que no obtenía el token y nunca mostraba vídeos. Ahora sigue manualmente hasta tres redirecciones, y solo hacia URL HTTPS de Apple. Tras el cambio, en el emulador «Un Verano Sin Ti» resolvió un vídeo de 1080 × 1080, y dos álbumes sin Motion quedaron como ausencia verificada.
  - La variante se elige por la capacidad declarada del decodificador H.264 del dispositivo (hasta 1080 px y 30 FPS).
  - Si la reproducción falla con un error de decodificación, se marca ese decodificador como fallido para esta versión de la app y se reintenta la misma variante con el siguiente (por ejemplo, el de software). Solo al agotarlos se baja de resolución, y el tope por dispositivo se recuerda en DataStore.
  - En el emulador API 37, `c2.goldfish.h264.decoder` falló con todas las variantes de Apple (`avc1.64001F`/`avc1.640020`). `c2.android.avc.decoder` reprodujo el vídeo: la cabecera del álbum cambió 121 679 píxeles en 0,7 s (`DesignQaTest#motionPlays`).

El vídeo nativo de `MediaPlayerElement` ignoraba el radio del marco y los recortes de composición con Windows App SDK 2.6.5. El modo de fotogramas de `MediaPlayer` y la superficie Win2D sustituyen esa ruta para conservar las esquinas redondeadas, también al redimensionar y pausar.

## Vídeo de cabecera del artista

Desde la 0.5.5, la cabecera de la página de artista muestra el vídeo editorial del artista cuando Apple Music lo tiene (por ejemplo, Rauw Alejandro). Diseño completo: [Identidad visual de artista](superpowers/specs/2026-11-19-artist-identity-design.md).

- **Búsqueda:** catálogo de Apple Music con `types=artists` y el nombre normalizado exacto (`metadataKey`). Para descartar homónimos, la ficha `artists/<id>?extend=editorialVideo&include=albums` debe incluir al menos uno de los álbumes o singles que YouTube Music muestra para ese artista (sin los sufijos ` - Single`/` - EP`). Sin títulos que comparar no se consulta nada.
- **Vídeo:** `motionArtistWide16x9` y, si falta, `motionArtistFullscreen16x9`. Variante H.264 de hasta 1920 px de ancho (las portadas siguen limitadas a 1080 px).
- **Servidor (web y Windows):** `POST /api/motion/resolve` con `{ entry: { source: 'artist', artistId, name, albums } }` devuelve el mismo `MotionArtResult`. La clave SHA-256 incluye el identificador de origen, el nombre normalizado y los lanzamientos normalizados que acreditan la coincidencia. Las respuestas negativas mantienen su vencimiento original al consultarse. Los vídeos de artista nunca se fijan, quedan fuera del repaso en segundo plano y se expulsan con el resto por encima de 1 GB.
- **Android:** `MotionRepository` resuelve el artista en el teléfono con la misma regla, con resultados en disco y la caché LRU de Media3. `MotionArtistArtwork` lo muestra en la cabecera; el reproductor ampliado conserva la prioridad del único decodificador.
- **Clientes:** el vídeo se reproduce silenciado y en bucle, con un fundido al primer fotograma, solo mientras la cabecera está en pantalla y la ventana o pestaña está visible. Lo desactivan «Portadas animadas», «Movimiento ambiental», el movimiento reducido, el ahorro de datos o la red medida, y `OPENFY_MOTION_ART=off`. Respaldo: el banner fijo de YouTube Music.
- **Windows:** `Views/LoopingVideo.cs` reutiliza el modo de fotogramas de `MediaPlayer` con Win2D. Una reconstrucción de la misma página mueve el vídeo en curso en vez de reiniciarlo.

## Presentación de la página de álbum

La misma ficha de Apple que da el vídeo aporta también la nota editorial (`editorialNotes`, pedida en `es-MX` y en `en-US` si no hay texto) y el color de la portada (`artwork.bgColor`). `POST /api/albums/presentation` devuelve los tres datos juntos y guarda la nota y el color en la caché de archivos del motion art: 7 días si existen, 24 h si Apple confirma que no hay y 15 min tras un fallo. El vídeo solo se resuelve si la petición lleva `motion: true`, y los clientes solo la envían cuando se permiten las portadas animadas. Si Apple no tiene nota, los álbumes de YouTube Music usan la descripción del propio álbum. Con `OPENFY_MOTION_ART=off` no se consulta a Apple, pero se puede leer lo que ya esté en caché. Diseño completo: [páginas de álbum](superpowers/specs/2026-11-19-album-pages-design.md).

En la cabecera del álbum, el vídeo aparece con un fundido tras el primer fotograma, se pausa fuera de la vista, con la pestaña o ventana oculta, o bajo el reproductor ampliado, y vuelve a la portada fija tras 8 s sin fotogramas mientras debería reproducirse.

## Configuración

| Variable | Efecto |
| --- | --- |
| `OPENFY_MOTION_ART=off` | No se contacta nunca con el proveedor. Los vídeos ya guardados se siguen sirviendo. |
| `OPENFY_MOTION_STOREFRONT=mx` | Tienda de Apple Music para la búsqueda (dos letras; por defecto `us`). |

Playwright y las comprobaciones autoejecutables de Windows arrancan el servidor con `OPENFY_MOTION_ART=off`.

## Verificación

- `tests/unit/motion-art.test.ts`: elección de variante, rangos de bytes, medios cifrados u hosts ajenos, coincidencia estricta, renovación del token, caché, fijados, expulsión y paso de fondo. Doce canciones descargadas previamente del mismo álbum, con invitados distintos, se completan con un solo archivo y no vuelven a descargarlo al reiniciar. Todo con `fetch` simulado.
- `tests/e2e/motion-art.spec.ts`: respuestas simuladas. En `chromium` el vídeo sustituye a la portada, sigue a la pausa y al cambio de canción, y respeta el interruptor y el movimiento reducido. En `mobile-webkit` la portada grande del reproductor ampliado pide el vídeo, la vista apilada con letras lo retira, el ahorro de datos lo evita y el Big Picture girado lo conserva.
- Windows, con datos y estado aislados y el vídeo de al menos un álbum de prueba ya presente en `motion-cache`:

```powershell
Openfy.exe --workspace E:\openfy --state-dir <estado-aislado> --data-dir <datos-aislados> --port <puerto-libre> --visual-players <informe> --visual-fixtures <audios-de-prueba> --motion-check
```

Las pruebas automáticas no contactan con Apple. La estabilidad del token en el tiempo y el comportamiento en un iPhone físico (reproducción automática del vídeo silenciado, modo de bajo consumo) no están comprobados.

La comprobación nativa guarda capturas del vídeo en reproducción y redimensionado en pausa. Lee los píxeles del mismo dibujo Win2D en ambos tamaños y exige cuatro esquinas transparentes y un centro opaco; también exige fotogramas nuevos en reproducción y ningún fotograma nuevo en pausa, además del cambio a portada fija y los ajustes de movimiento.

Para comprobar el bucle, las canciones de prueba deben durar más que el clip de vídeo. La prueba exige nuevos fotogramas después de esperar una duración completa del clip; no usa `PlaybackSession.Position`, que permaneció en cero en la reproducción de vídeo silenciado por fotogramas de este equipo. El empaquetado verifica que incluya las dos DLL de Win2D (`Microsoft.Graphics.Canvas.dll` y `Microsoft.Graphics.Canvas.Interop.dll`).

## Revisión del 16 de noviembre de 2026

La corrección quedó instalada como **0.5.0+1794822143**, confirmada por `/api/status` y la versión del ensamblado nativo. El paquete aislado **0.5.0+1794821866** pasó la prueba visual a 1080 × 1080: entregó fotogramas después de una duración completa del clip, conservó el último al pausar, dejó de procesarlos en pausa y volvió a la imagen fija al cambiar de álbum. Las cuatro esquinas dieron alfa cero tanto a 520 × 520 como a 325 × 325 tras redimensionar. Pasaron 212 pruebas Vitest, 98 de lógica/contratos .NET y la comprobación de tipos. Las dos DLL de Win2D instaladas coinciden por hash con las del paquete de prueba. La revisión automática bloqueó abrir una segunda instancia del ejecutable instalado para repetir la prueba visual; la comprobación visual procede del paquete aislado.

La comparación anterior/posterior conserva sin cambios canciones, favoritas, asociaciones y hashes de audio, assets y playlists: 560 canciones guardadas y descargadas, una playlist. Tras consultar también los dos álbumes con nombres de símbolos, la biblioteca contiene 27 vídeos (310.506.304 bytes) compartidos por 46 canciones y no tiene duplicados por ID de álbum de Apple. Los otros 349 álbumes terminaron sin vídeo compatible; no quedan consultas pendientes. Eso describe la respuesta del proveedor y la coincidencia estricta en esta consulta, no una garantía de que Apple nunca tenga un vídeo para esos álbumes.

Las evidencias están en `output/motion-review-20261116`: logs anteriores al reinicio, capturas, informe de prueba del paquete, comparación de biblioteca, binarios instalados y `canciones-con-motion.md` con la lista por álbum. Se conservan las salidas de otras conversaciones.

Esa lista contaba vídeos ya guardados. Sus 349 resultados negativos procedían de iTunes como único buscador y no demostraban ausencia de Motion en Apple Music: la búsqueda de Apple sí devuelve `1622045624` para «Un Verano Sin Ti». La revisión 2 recupera automáticamente esos casos y distingue ausencias verificadas, álbumes sin resolver y errores.

## Verificación del respaldo de búsqueda

La revisión 2 quedó instalada como **0.5.0+1794849028**, confirmada por su backend. Pasaron 220 pruebas Vitest, 99 de contratos/lógica .NET, la comprobación de tipos y ocho pruebas de navegador (los casos de reintento de escritorio se omiten en el teléfono). Las comprobaciones nativas del workspace, del paquete aislado y del ejecutable instalado pasaron vídeo a 1080 px, bucle, pausa, esquinas transparentes, ajustes, cierre y recuperación de un negativo vencido sin cambiar de álbum. El cliente nativo conserva `Retry-After` al recibir errores HTTP.

En la instalación real, una solicitud con solo artista y álbum obtuvo «Un Verano Sin Ti» mediante el respaldo de Apple Music, ID **1622045624**, y guardó un único MP4 de **9.345.760 bytes**. Doce peticiones concurrentes, con cambios de mayúsculas e invitados, devolvieron la misma URL local. Las 21 canciones descargadas de ese álbum comparten ese archivo. Los logs acreditan cero candidatos de iTunes y el éxito de `apple-music`; el ID no está fijado en el código del servidor.

La comparación anterior/posterior conserva las 560 canciones guardadas y descargadas, favoritos, asociaciones de audio, assets y playlists. Los hashes de los 27 MP4 anteriores coinciden. A las 11:14 del 16 de noviembre de 2026 (America/Mexico_City), había 28 vídeos compartidos por 67 canciones, 19 ausencias verificadas, un álbum sin resolver y 328 álbumes pendientes del repaso automático. Es una instantánea, no el resultado final de la cola: el servidor continúa trabajando de uno en uno mientras Openfy permanezca abierto y conserva los resultados al reiniciar.

`output/motion-fallback-20261116` conserva el código anterior, logs previos al reinicio, resultados de pruebas, capturas del ejecutable instalado, evidencia de la búsqueda por ambos métodos, comparación de biblioteca/hashes y la lista `canciones-con-motion.md`. Los artefactos grandes de las pruebas se retiran después de conservar los informes; no se eliminan salidas de otras conversaciones.
