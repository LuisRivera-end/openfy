# Recursos locales de canciones descargadas

Verificación del 15 de noviembre de 2026, zona America/Mexico_City. La implementación se comprobó primero con bibliotecas temporales. Después se aplicó la compilación final a la instalación personal, conservando sus logs y verificando la biblioteca tras el reinicio.

## Comportamiento

- El backend reconoce una descarga por su asociación persistida, incluso si falta el archivo. Las URLs antiguas de streaming redirigen al asset local y mantienen HEAD y rangos HTTP. Un archivo local que no abre no activa streaming.
- Las nuevas descargas consultan y guardan la letra antes de publicar el audio local. Las letras disponibles se leen del almacenamiento sin renovar por caducidad ni versión de formato. Las descargas antiguas sin letra se completan gradualmente en segundo plano, y también al abrir el panel con conexión; **Reintentar letras** permite consultar otra vez y guardar el resultado. El modo explícito `localOnly` nunca consulta proveedores y un fallo al reintentar conserva la letra guardada. La recuperación espera cinco segundos tras el arranque, procesa una canción a la vez, respeta las ausencias recientes y aplica una pausa ante fallos del proveedor; no vuelve a descargar audio. `OPENFY_LYRICS_BACKFILL=off` desactiva solo este trabajo de fondo en las pruebas aisladas.
- Las vistas usan la portada local. Las URLs remotas antiguas se resuelven contra la descarga persistida; si falta su portada, no se descarga un reemplazo. Las copias antiguas de la PWA que guardaban una URL externa muestran una portada neutra.
- Si una descarga termina durante la reproducción por streaming, Windows y web cambian a la copia local conservando la posición y la intención de reproducir o mantener la pausa.
- Las búsquedas y páginas externas del catálogo siguen siendo funciones con conexión. Esta política cubre los recursos de las canciones descargadas.

## Comprobaciones

| Comprobación | Resultado |
|---|---|
| Vitest completo | 175 pruebas correctas en 21 archivos |
| Descargas tras el último ajuste | 12 pruebas correctas |
| Nuxt typecheck | Correcto |
| Compilación Nuxt de producción | Correcta |
| Contratos y lógica .NET | 48 pruebas correctas |
| Compilación Windows Release | Correcta, sin errores ni advertencias |
| Descargas y letras en Chromium y WebKit móvil | 32 escenarios únicos verificados; el cambio de streaming a archivo se repitió de forma aislada en ambos motores después del último ajuste |

Las pruebas del servidor sustituyen tanto `fetch` como los proveedores de letras por funciones que fallan ante cualquier consulta inesperada. Comprueban reutilización después de cerrar y abrir SQLite, letras caducadas y de formato anterior, duración o metadatos de una cola antigua, portadas de distintos tamaños y ausencia de audio, portada o letra.

Las pruebas HTTP verifican redirección local, HEAD y rangos. Las pruebas de navegador verifican reproducción con conexión, letra guardada, ausencia de peticiones de portada remota o streaming y fallos reales del endpoint local de audio. También comprueban el cambio de una canción que ya estaba sonando por streaming al asset recién descargado, conservando la posición.

Durante estas comprobaciones se corrigió también la eliminación de una asociación sin trabajo de descarga: dos identificadores ausentes se comparaban como si hubiera un trabajo activo. Ahora una asociación antigua o creada sin trabajo puede eliminarse sin ese falso bloqueo.

WebKit automatizado no sustituye una comprobación en iPhone físico.

## Paquete instalado

La compilación **1794734301** de Openfy 0.3.0 está publicada en el canal local e instalada en `%LOCALAPPDATA%\Programs\Openfy`. El backend confirmó esa compilación en el puerto habitual **3187**, con mantenimiento desactivado.

El paquete se instaló primero en una carpeta aislada. Se verificaron reproducción WASAPI, seek, seek en pausa e identidad de YouTube. El backend del paquete sirvió audio local con HEAD y rangos, la letra guardada de formato anterior y caducada, y la portada local a partir de una URL remota antigua. Los logs de esas dos sesiones de prueba registraron **cero peticiones externas**. Las recomendaciones del inicio se mantuvieron en caché en la biblioteca de prueba para medir únicamente los recursos de la canción.

La comprobación final del smoke nativo se actualizó para consultar la asociación local y los trabajos de descarga: la pantalla de Descargas virtualizada ya no utiliza la colección general `Songs` que consultaba la comprobación anterior.

Después de actualizar la instalación personal, la respuesta completa de biblioteca coincidió exactamente con la previa: **558 canciones guardadas, 500 descargadas y una playlist**. Se conservaron las 500 apariciones de la cola, su orden original, contexto, volumen, repetición, aleatorio y preferencia de efectos. La portada inicial correspondió a la selección guardada; la selección y posición observadas después pertenecen a la sesión en ejecución y se conservan en el informe sin atribuirles una causa.

Los binarios nativos y el backend instalado coinciden por SHA-256 con la copia que pasó la prueba aislada. Se conservaron los logs previos y el instalador realizó su respaldo transaccional de SQLite y del estado del escritorio.

- Instalador: `output/desktop/Openfy-Setup-0.3.0-1794734301-x64.exe`.
- SHA-256: `5cf3ef582b0434dfaa767ff2b9f7400885c4151a99850c07160a04285ec93135`.
- Resultado del paquete aislado: `output/offline-resources-release/installed-verification.json`.
- Resultado de la instalación personal: `output/offline-resources-release/personal-installation.json`.
- Logs de prueba: `output/offline-resources-release/installed-api.jsonl` y `installed-native-backend.jsonl`.
- Compilación y empaquetado: `output/offline-resources-release/package.log`.

## Espacio de compilación

La unidad E: se quedó sin espacio durante la validación. Se conservaron seis instaladores antiguos generados por el proyecto en `C:\Users\lelie\AppData\Local\Openfy\development\workspace-archives\openfy-20261115`, liberando aproximadamente 1,5 GB. El registro con las rutas originales y actuales está en `output/offline-resources-archive.json`. Los instaladores recientes permanecen en su ubicación original.

Posteriormente, por petición explícita del usuario, se eliminaron esos seis instaladores de C:. El registro conserva la fecha y el motivo de la eliminación. También se retiró la instalación temporal utilizada para comprobar el paquete final, después de verificar las copias del instalador conservadas en `output/desktop` y en el canal local.
