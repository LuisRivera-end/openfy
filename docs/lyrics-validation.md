# Verificación del sistema de letras

## Comportamiento

La vista de letras comparte el reproductor existente: usa su posición y su seek sin crear otro elemento de audio ni cambiar la pausa. El panel de escritorio alterna con la cola; el reproductor ampliado muestra la letra junto a la canción (a la derecha en pantallas anchas, bajo una cabecera compacta en estrechas) sin ocultar portada ni controles; en Big Picture solo aparece la letra sincronizada (ver [Big Picture](big-picture.md#sin-letra-sincronizada)). El desplazamiento manual suspende el seguimiento hasta pulsar **Seguir reproducción**. Los versos admiten teclado; los cambios de línea no se anuncian continuamente a lectores de pantalla y el desplazamiento respeta movimiento reducido.

El servidor resuelve archivos locales usando la biblioteca y canciones de YouTube mediante datos validados. La prioridad es letra incrustada sincronizada, LRCLIB sincronizado, texto incrustado y texto del proveedor; YouTube.js aporta un respaldo de texto. Las coincidencias mantienen palabras de versión como live o remix y rechazan diferencias de duración mayores de dos segundos. La duración medida del audio puede invalidar la coincidencia anterior.

## Sincronización por palabra (2026-11-14)

Solo se marca la palabra cuando la fuente trae sus tiempos: LRC mejorado (marcas `<mm:ss.xx>` dentro del verso, en la letra incrustada o en LRCLIB) o SYLT incrustado por fragmentos. No hay estimación ni alineación con el audio; sin esos tiempos se mantiene la sincronización por verso. Las marcas nunca se muestran como texto. Se descartan los tiempos que retroceden o pasan al verso siguiente. La regla de palabra activa está duplicada en `shared/utils/lyrics.ts` y `Openfy.Core` y fijada por `tests/fixtures/lyrics-contract.json`. Los resultados guardados con un formato anterior se vuelven a leer de forma perezosa (`format: 2`), sin migración de la base de datos.

SQLite se actualiza desde versión 1 a 2 sin reemplazar tablas de la biblioteca; las letras y el indicador de extracción se añaden de forma separada. Los archivos ya importados se leen de forma diferida. IndexedDB se actualiza de forma aditiva y conserva snapshots, descargas y eventos. Los resultados positivos caducan a los 30 días y las ausencias a las 24 horas. Las letras guardadas siguen siendo legibles sin conexión aun si caducaron. Los fallos temporales no se convierten en ausencias; una alternativa útil puede mostrarse durante un fallo sin guardarse como resultado fresco del servidor.

LRCLIB recibe las consultas de una en una con separación mínima de 300 ms e identificación de Openfy. Cada solicitud tiene un timeout de 12 segundos. Los estados 429/503 aplican un cooldown basado en `Retry-After` más jitter; durante ese plazo no se contacta de nuevo al proveedor. No se envía audio ni se requiere una clave de API. La documentación del servicio está en [LRCLIB](https://lrclib.net/docs.txt).

Las descargas de audio y las consultas de letras se completan independientemente. Al descargar y al recuperar conexión se intentan completar las letras de las descargas listas. La ausencia o el fallo de una letra no invalida el audio ni elimina archivos. Consultar letras de YouTube no descarga su audio.

## Validación automatizada

Comprobación realizada en Windows el 12 de noviembre de 2026. La compilación de producción y la revisión TypeScript/Vue son correctas. Las 82 pruebas unitarias e integración local pasan. Se verificaron los 56 escenarios de navegador existentes y 20 escenarios de letras, repartidos entre Chromium y WebKit móvil. La regresión completa detectó un problema en la preparación del caso de migración en WebKit: la fixture debe registrar primero el service worker para representar una PWA ya instalada. Tras corregir la fixture, las comprobaciones dirigidas de migración pasan en ambos motores.

Las pruebas unitarias cubren tiempos LRC, offsets, marcas múltiples, huecos, límites temporales, letras incrustadas, coincidencias, prioridad de fuentes, caché, migración desde SQLite v1, errores, instrumental y throttling del proveedor. Las pruebas de navegador utilizan letras y audio sintéticos propios, bases temporales y el servidor independiente en `127.0.0.1:4175`.

Los flujos nuevos comprueban validación del endpoint y acceso privado, letras locales, seek pausado, seguimiento manual/automático, respuestas tardías, duración medida de YouTube y reintento, texto sin tiempos, instrumental, ausencia, guardado con descargas y reapertura offline. Las pruebas de modo offline utilizan el service worker de producción; las pruebas de respuestas simuladas bloquean el service worker para que las interceptaciones sean deterministas en ambos motores.

El contrato añadido es `POST /api/lyrics/resolve`, con `{ entry, duration?, refresh? }`: `entry` usa el tipo compartido de reproducción local/YouTube y `duration` permite aportar los segundos medidos por el audio. La respuesta incluye clave de canción, firma de metadatos, estado (`synced`, `plain`, `instrumental` o `not_found`), texto, líneas con tiempos en segundos, fuente, atribución y fechas de caché. Datos inválidos devuelven 400, una pista local inexistente devuelve 404 y un fallo temporal devuelve 503 con `LYRICS_UNAVAILABLE`; los límites incluyen `Retry-After`.

Capturas: `output/playwright/chromium-lyrics.png` y `output/playwright/mobile-webkit-lyrics.png`.

Se comprobó también el endpoint de producción con una canción obtenida del catálogo real: «I Want to Live», de Borislav Slavov, con duración de catálogo de 234 segundos. LRCLIB entregó letra sincronizada con 47 marcas temporales. En una segunda consulta de diagnóstico, omitiendo los artistas para saltar deliberadamente LRCLIB, YouTube.js devolvió texto y atribución para el mismo identificador. Las comprobaciones se realizaron contra la base temporal del servidor de pruebas, sin importar música ni modificar la biblioteca personal; no se registró el texto de las letras.

## Límites

La disponibilidad y exactitud dependen del catálogo de letras, de sus tiempos y de los metadatos. Los resultados del proveedor externo pueden cambiar. Las pruebas con respuestas simuladas no acreditan cobertura del catálogo real. La sincronización por palabra depende de que la fuente traiga los tiempos; LRCLIB rara vez los incluye. No se implementa estimación por sílabas, alineación local con el audio, traducción, edición manual ni carga de archivos LRC independientes.

La aceptación física en Safari/PWA del iPhone permanece pendiente, incluyendo modo avión, bloqueo/desbloqueo y tamaño de texto aumentado. Seguir [el protocolo de iPhone](iphone-validation.md).
