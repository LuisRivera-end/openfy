# Verificación de YouTube Music

La corrección del 13 de noviembre para respuestas 503 y reproducción nativa de “Bad Romance” está documentada en [el informe de la pista reportada](youtube-native-fix.md).

Comprobaciones realizadas en Windows el 12 de noviembre de 2026 con Node 22.22.3, YouTube.js 18.3.0 y QuickJS 0.32.0.

## Implementación

El catálogo se consulta con el cliente de música del SDK, en español y región México. La resolución de audio usa el cliente VISIONOS del mismo SDK: durante la verificación, los clientes de música y TV permitían leer el inicio de la canción pero rechazaban rangos posteriores. La integración permanece encapsulada en el servidor y no requiere cuentas ni una API intermediaria.

El proxy transmite AAC/M4A mediante rangos de hasta 1 MB hacia YouTube y presenta al navegador una respuesta HTTP continua. Valida los rangos recibidos, conserva la contrapresión y cancela el flujo al desconectarse el dispositivo. HEAD comprueba un byte mediante GET porque algunos servidores de video rechazan HEAD directamente. Las URLs temporales y el código de resolución no se envían al navegador. QuickJS limita memoria y ejecución y no recibe APIs del sistema o de red.

## Resultados

| Comprobación | Resultado |
| --- | --- |
| TypeScript / Vue | Correcto |
| Compilación Nuxt de producción | Correcta |
| Pruebas unitarias e integración local | 58 correctas |
| Flujos de navegador con proveedor simulado | 54 correctos: 27 Chromium y 27 WebKit móvil |
| Restauración local en WebKit, repetida por una carrera detectada durante seek | 3 repeticiones consecutivas correctas |
| Búsqueda real «Daft Punk Get Lucky» | 20 canciones |
| HEAD de audio real mediante Openfy | HTTP 200 |
| Rangos inicial y a mitad de canción | HTTP 206, 1024 bytes cada uno |
| Transmisión completa de la canción comprobada | HTTP 206, 5 983 881 bytes recibidos de 5 983 881 anunciados |
| Reproducción real en Chromium | El tiempo avanza; salto al segundo 120 y continuidad confirmados |
| Caché de descargas tras reproducción real en Chromium | Sin entradas de `/api/music/` |
| Diseño en escritorio y móvil | Capturas revisadas, sin desbordamiento horizontal |
| Reproducción real en el motor WebKit de Windows | No aceptada como validación: el decodificador anuncia el final sin iniciar reproducción sostenida. Openfy conserva la canción y permite reintentar |
| Safari/PWA en un iPhone físico, controles y pantalla bloqueada | Pendiente |

Los flujos simulados usan audio AAC sintético servido por un servidor HTTP exclusivo de pruebas. Ese servidor permite que el motor multimedia nativo de WebKit reciba audio real por HTTP, ya que evita las interceptaciones de red de Playwright. La aplicación de producción no contiene los endpoints de fixtures. Las pruebas originales de descarga y reapertura offline siguen utilizando el service worker real.

Las capturas se encuentran en `output/playwright`, incluido `chromium-youtube-live.png`. No se confunden los resultados con audio sintético, las pruebas del catálogo real ni la aceptación física en iPhone.

## Repetir la comprobación real

La búsqueda también devuelve artistas en solicitudes independientes (`type=artist`). Se comprobó el perfil real de Daft Punk: cinco canciones populares, seis álbumes y seis singles/EPs iniciales; ampliación a 20 canciones y después 10 más; once álbumes en la primera carga ampliada; y doce singles/EPs con continuación. El álbum «Random Access Memories (Drumless Edition)» entregó sus trece pistas, con artistas, portada y referencia al álbum heredados incluso cuando YouTube las etiqueta como vídeos.

Los diez nuevos casos de navegador (cinco por motor) cubren búsqueda combinada, ampliaciones, errores independientes, recuperación de consultas caducadas, artistas sin catálogo, imágenes ausentes, desconexión, reproducción de álbumes y regreso a la búsqueda conservando sus resultados y posición. Las capturas de artista y álbum de ambos motores están en `output/playwright`.

Con Openfy iniciado:

```powershell
npm run test:youtube
```

Comprueba artistas, perfil, continuaciones de canciones, discografía, apertura de álbum, búsqueda de canciones, HEAD y rangos al principio y a mitad de una canción, sin guardar audio en archivos. Se puede cambiar dirección y consulta:

```powershell
npm run test:youtube -- http://127.0.0.1:3187 "Daft Punk Get Lucky"
```

Un tercer argumento permite cambiar la consulta de artistas: `npm run test:youtube -- http://127.0.0.1:3187 "Daft Punk Get Lucky" "Daft Punk"`.

Los bloqueos o cambios del proveedor pueden hacer fallar estas comprobaciones aunque los tests con fixtures sigan pasando. Para la nueva fuente debe completarse también el protocolo de iPhone; la validación anterior de archivos locales no confirma la reproducción de YouTube.

## Scroll continuo y diagnóstico de fallos intermitentes

La búsqueda devuelve 20 canciones inicialmente y bloques de 10 al acercarse al final de la lista. Las continuaciones originales de YouTube y los resultados sobrantes se conservan en el servidor; el navegador recibe un cursor opaco. Repetir un cursor devuelve el mismo bloque, también después de un fallo temporal. La caché conserva hasta 100 búsquedas y caduca tras 15 minutos sin uso. El final se determina por la continuación del proveedor. Los duplicados se eliminan en orden y las respuestas tardías de otra consulta se descartan.

La comprobación real con «The Neighbourhood» entregó 20, 10 y 10 canciones: 40 identificadores únicos. Las pruebas de navegador cubren scroll, continuidad de reproducción, error y reintento sin perder resultados, cambio de consulta durante una continuación y actualización tras caducidad.

El usuario reportó que «A Little Death» fallaba mientras «Sweater Weather» funcionaba, y después confirmó que la primera volvió a reproducirse. En las comprobaciones posteriores, los identificadores `474DkoBg4q8` y `cULQhvuq1Zc` respondieron con HEAD 200 y rangos 206. Se recibieron completos 3 395 416 y 3 892 329 bytes, respectivamente. Ambas pistas se reprodujeron en Chromium y permitieron saltar hasta su mitad. La causa original no pudo reproducirse y no hay evidencia que permita atribuirla a anuncios.

Los registros anteriores no conservaban el detalle de estos fallos. Ahora las incidencias incluyen la canción, etapa, código, estado HTTP y rango cuando corresponde, con URLs y tokens excluidos. Si un fragmento posterior recibe 401, 403, 410 o determinados errores 5xx, se renueva la dirección y se reintenta ese fragmento una vez. Se comprueba que el tamaño y el formato coincidan para conservar los bytes ya enviados. Las pruebas cubren un 403 en un fragmento posterior y la continuación correcta sin repetir audio anterior.

## Versiones de álbum y duraciones

Se reprodujo la diferencia reportada con «Lo Siento BB:/». La página de DATA entregaba el video oficial `NO7EtdR3Dyw` (251 segundos) con la duración de la pista del álbum (207 segundos). La lista canónica del mismo álbum devuelve el audio `RGXHqQR9XrQ`. Los álbumes ahora usan esa lista oficial, con todas sus continuaciones, conservando orden, créditos y referencias; no se buscan coincidencias por título. Las respuestas antiguas sin lista canónica conservan su tratamiento anterior.

Las canciones populares del perfil de Tainy llegaban sin duración. Se completan por identificador desde la lista de canciones del artista, compartiendo su caché con «Ver todas las canciones». La comprobación real devolvió 4:31, 4:11, 3:53, 2:38 y 3:27 para sus cinco canciones iniciales. Si falla esa consulta complementaria, el perfil sigue disponible y no se inventan duraciones.

El reproductor escucha `loadedmetadata` y `durationchange`, conserva únicamente duraciones finitas positivas y comparte la duración medida con las listas y la cola guardada. Chromium reprodujo el audio correcto desde DATA: 206.343741 segundos reales, que se muestran como 3:26 tanto en la lista como en el reproductor. Se comprobó un salto al segundo 100 y la continuación del audio sin errores. El segundo de diferencia respecto al catálogo corresponde a su redondeo.

Validación de esta corrección: 66 pruebas unitarias correctas, revisión de tipos y compilación de producción correctas, y 36 pruebas de catálogo y YouTube correctas en Chromium y WebKit móvil. La regresión nueva comprueba una duración de catálogo incorrecta, su corrección al cargar el audio, el rango de seek y la duración al restaurar la cola pausada. WebKit utiliza audio de prueba; esta comprobación no sustituye la validación física de YouTube en iPhone.

Capturas de la comprobación real en `output/playwright/tainy-popular-durations.png` y `output/playwright/lo-siento-audio-player.png`. Para aplicar el cambio a una cola antigua hay que volver a elegir la canción desde la página actualizada; sus identificadores guardados no se sustituyen a ciegas.
