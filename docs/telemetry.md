# Escucha y descubrimiento

El alcance incluye el servidor compartido, Windows nativo, la PWA y el filtrado de biblioteca, favoritas, playlists y colecciones por artista/álbum. Hay un solo perfil por biblioteca. Los contadores comienzan con esta actualización; no se reconstruyen a partir de los diagnósticos anteriores.

## Conteo y recuperación

Los minutos proceden del avance efectivo del audio. Una reproducción exige acumular el 90 % de la duración medida por el reproductor. Cada sesión aporta como máximo una reproducción; pausa, reintento y seek conservan su identidad. Elegir una canción, avanzar o repetir inicia otra sesión. Restaurar una cola siempre comienza pausado y no cuenta la posición guardada como escucha nueva.

Se guarda un checkpoint cada diez segundos, y también al pausar, cambiar canción o cerrar. Un cierre forzado puede perder el progreso posterior al último checkpoint. La PWA conserva una cola en IndexedDB v3 y Windows conserva `listening.json` con escritura atómica. Un error de almacenamiento se muestra sin bloquear el audio. El sistema no promete persistencia después de que el navegador elimine su almacenamiento.

Cada checkpoint contiene UUID de sesión/dispositivo, versión creciente, referencia musical, duración medida, milisegundos acumulados por día y fecha de calificación. La aplicación conserva versiones pendientes hasta recibir confirmación; el servidor actualiza sesión y acumulados diarios en una transacción. Versiones repetidas o antiguas se confirman sin sumarlas otra vez; un cambio de identidad o un acumulado regresivo se rechaza. Las sesiones de distintos dispositivos se suman.

## Escuchado recientemente por contexto

Cada entrada de la cola puede guardar un origen opcional (`context`), que el acumulador copia a la sesión de escucha. Reordenar, repetir, activar aleatorio o restaurar la cola conserva el origen de cada entrada. Una reproducción nueva reemplaza el origen anterior por el de la acción actual; añadir desde el buscador durante una playlist registra esa canción como suelta.

El buscador y las canciones concretas de los populares de un artista de YouTube Music generan tarjetas de canción. Favoritas, playlists y álbumes generan su tarjeta de colección. Los botones Reproducir/Aleatorio del artista generan su tarjeta de artista; las canciones de un artista de la biblioteca conservan ese contexto. Biblioteca general, descargas, sugerencias y Más escuchadas no generan tarjetas, pero toda la escucha sigue contando para estadísticas y para la regla del 90 %.

`GET /api/telemetry/recent?limit=12` devuelve `{ items: RecentCard[] }`, con límites de 1 a 24. Cada tarjeta contiene `kind`, `key`, `id`, `title`, `subtitle`, `artwork`, `lastPlayedAt` e `item`; este último solo contiene un `LibraryItem` para canciones y es `null` en colecciones. Las claves son `song:<trackKey>`, `favorites`, `playlist:<id>`, `album:<id>` y `artist:<id>`. Los identificadores de álbum/artista de YouTube Music llevan el prefijo `youtube:`.

Solo se incluyen sesiones con contexto y tiempo escuchado mayor que cero. Se conserva la escucha más reciente de cada origen, se ordena por `updatedAt` descendente y se desempata por clave ascendente. Las playlists usan su nombre actual y desaparecen si se borran; las canciones locales eliminadas tampoco aparecen. Favoritas muestra su cantidad actual, incluso cero. Álbumes y artistas conservan los metadatos registrados al iniciar la reproducción.

Las tarjetas de colección abren su página. Reproducir una canción reciente inicia una cola con las canciones sueltas de esa fila y mantiene el origen `song`. PWA y Windows guardan la respuesta en `listening-recent-v2`; ignoran el formato anterior. Sin conexión se conserva la última respuesta guardada y las escuchas pendientes aparecen después de sincronizarse. Las sesiones antiguas sin contexto siguen aportando estadísticas, pero no se reinterpretan para recientes; la fila puede comenzar vacía tras actualizar.

Este cambio añade campos opcionales al JSON existente; no introduce migraciones ni cambia las versiones actuales de SQLite (5), IndexedDB (4) o los snapshots de cola.

Las fechas se guardan en UTC. Los días y el año se delimitan en `America/Mexico_City`: siete días incluyen hoy y los seis días naturales anteriores; treinta incluyen hoy y los veintinueve anteriores. Si una sesión cruza medianoche, los minutos se reparten entre ambos días y la reproducción pertenece al día en que alcanzó el umbral.

SQLite v4 incorpora `listening_sessions`, `listening_days` y `recommendation_cache`, además de la marca de revisión de géneros. La importación conserva géneros de etiquetas; el trabajador revisa los originales existentes una vez, con prioridad para importaciones y conversiones y respetando la pausa por reproducción. Los datos ausentes aparecen como «Sin género».

YouTube Music no informa el género. Las canciones de YouTube guardadas se completan una vez en segundo plano, con la prioridad más baja del trabajador: el álbum, si falta, sale del panel de cola de YouTube Music; el género, de la API de búsqueda de iTunes (tienda de México, nombres en español). Se busca primero la misma grabación por título y uno de sus artistas; si no aparece, el álbum de ese artista y, por último, el género principal del artista. Solo salen del PC el título, el artista y el álbum. Las consultas se espacian unos 3 s por petición y un fallo se reintenta a los 10 minutos. Una canción queda revisada cuando tiene `genres`, aunque sea vacío; sin coincidencia sigue «Sin género». Volver a guardar la canción desde un cliente no borra el álbum ni los géneros ya resueltos. `OPENFY_METADATA_LOOKUP=off` desactiva estas consultas (las pruebas E2E lo usan).

## Consultas y recomendaciones

| Ruta | Uso |
| --- | --- |
| `POST /api/telemetry/listening` | `{ sessions: ListeningSession[] }`, lotes de hasta 100; devuelve `{ accepted: [{ id, sequence }] }`. |
| `GET /api/telemetry/stats?period=30d` | Resumen de milisegundos, reproducciones y acumulados por identificador. |
| `GET /api/telemetry/top?period=30d&sort=plays&offset=0&limit=50` | Ranking con metadatos y total. Admite texto, artista, álbum, género, favorito y origen. |
| `GET /api/music/recommendations?refresh=true` | Actualiza las recomendaciones; sin `refresh` reutiliza resultados durante seis horas. |

Los períodos son `7d`, `30d`, `year` y `all`. El ranking admite `plays` y `minutes`, hasta 100 resultados por petición; la interfaz carga 50. El orden principal es descendente; los empates usan minutos, título e identificador. La vista por reproducciones incluye canciones calificadas; la vista por minutos también incluye escuchas parciales.

Las recomendaciones utilizan hasta tres semillas de artistas distintos, priorizando minutos recientes, después historial y favoritas. Las semillas locales se buscan por título y artista y se comparan por duración: una coincidencia ambigua se omite. YouTube Music aporta canciones relacionadas mediante YouTube.js. Se alternan las semillas, se eliminan videos duplicados y se muestran hasta veinte resultados, con un máximo de dos canciones por artista. Una caída del proveedor conserva las recomendaciones anteriores y permite reintentar.

El historial incluye referencias de YouTube no guardadas en la biblioteca; escucharlas no crea favoritas ni descarga audio. Los identificadores locales y `youtube:videoId` son independientes. Para recomendar, se envían al proveedor las consultas de título/artista y los identificadores de semillas; los acumulados, dispositivos y diagnósticos permanecen en el PC. No se vincula una cuenta de Google.

## Filtros y validación

La ordenación y los filtros cambian la vista y la cola que se inicia desde ella. Las modificaciones del orden persistente de una playlist siguen usando sus acciones explícitas y su revisión. Las agrupaciones de álbumes/artistas se construyen sobre canciones guardadas de ambas fuentes. Las estadísticas en las columnas de biblioteca son históricas; el ranking usa el período seleccionado. Sin conexión se conserva el último resumen consultado y se indica la escucha pendiente de sincronizar.

La fixture `tests/fixtures/listening-contract.json` ejecuta los mismos ejemplos en TypeScript y .NET: 89,9 %, 90 %, pausa, buffering, seek, restauración y eventos espaciados en segundo plano. Las pruebas de servidor cubren versiones fuera de orden, transacciones, caché de recomendaciones y filtros. E2E comprueba recuperación de la cola pendiente, biblioteca mixta y ranking en Chromium y WebKit móvil.

La comprobación nativa aislada `--listening-test <audio>` oculta la ventana en la bandeja, reproduce el archivo completo con volumen cero, prueba seek al final, sincronización, filtros y ranking. Escribe `listening-smoke.json` en el directorio indicado por `--state-dir`. Ejecutarla con `--data-dir`, `--state-dir` y puerto exclusivos para pruebas. La ejecución de desarrollo en `output/listening-qa-8d995550/state/listening-smoke.json` pasó y registró 7,997 segundos y una reproducción de una muestra de ocho segundos.

Validación de esta implementación: 117 pruebas unitarias TypeScript, 21 pruebas de núcleo .NET y nueve de audio/backend; compilación de Nuxt y Windows y comprobación de tipos. La suite general E2E ejecutó 86 escenarios: 84 pasaron inicialmente y los dos de migración se volvieron a verificar tras actualizar la versión esperada de IndexedDB. También pasaron los recorridos específicos de telemetría, filtros y diseño con la interfaz móvil final. La comprobación visual nativa pasó sus 18 capturas, incluido el ranking, en `output/listening-qa-8d995550/screenshots-2/visual-check.json`. La consulta pública real `getUpNext` devolvió 50 canciones con identificadores, títulos, referencias de artista y duraciones válidas.

Queda pendiente comprobar el nuevo conteo en un iPhone físico con pantalla bloqueada y escucha offline prolongada. WebKit de escritorio y los protocolos anteriores de descargas no sustituyen esta aceptación física.
