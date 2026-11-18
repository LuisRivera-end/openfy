# Logs temporales por sesión de Openfy

Guía para agentes que investiguen fallos de peticiones, portadas y comunicación entre el cliente nativo y el servidor.

## Ubicación

En la instalación normal de Windows:

`%LOCALAPPDATA%\Openfy\desktop\session-logs\`

En este equipo: `C:\Users\lelie\AppData\Local\Openfy\desktop\session-logs\`.

- `native.jsonl`: peticiones HTTP del cliente, operaciones del puente y resultado del renderizado de imágenes.
- `backend.jsonl`: peticiones HTTP recibidas, peticiones externas realizadas con `fetch`, preparación de portadas y aciertos/fallos de caché.

Cada línea es un objeto JSON. Ambos archivos pertenecen a la sesión actual y pueden leerse mientras Openfy está abierto. No se envían a ningún servicio.

## Ciclo de vida

El proceso nativo inicia una sesión después de adquirir el mutex de instancia única. Vacía los dos archivos y genera un identificador de sesión nuevo. Los archivos permanecen disponibles después de salir y se vacían en el siguiente arranque real.

Abrir otra vez el acceso directo mientras Openfy sigue ejecutándose solo activa la instancia existente: no reinicia ni elimina los logs. Cerrar la ventana puede dejar la aplicación en la bandeja; para iniciar una sesión nueva se necesita salir de Openfy y volver a abrirlo.

Una recuperación automática de Node conserva los logs y el identificador de la sesión. Los registros persistentes anteriores de `%LOCALAPPDATA%\Openfy\logs` son independientes y no se eliminan con este mecanismo.

Las pruebas con `--state-dir` escriben en `<state-dir>\session-logs`, sin vaciar los logs del usuario. Los argumentos `--shutdown` y las segundas instancias no reinician el registro.

## Campos y eventos

Campos habituales: `at` (UTC), `session`, `operation`, `outcome`, `target`, `elapsedMs`, `status`, `errorType`, `error` y, cuando está disponible, `code`.

- `http.GET` / `http.PUT`, etc.: solicitudes del cliente; `started`, `completed` o `failed`.
- `bridge.prepareArtwork`, etc.: resultado y tiempo del comando del puente. `target` es el ID de la solicitud del puente.
- `http.incoming`: método, ruta local, estado HTTP y duración de la respuesta del backend.
- `http.outgoing`: método, host/ruta del proveedor, estado HTTP o error de red y tiempo hasta recibir las cabeceras.
- `artwork.cache`: `hit` o `miss`. Se comprueba que exista también el archivo de imagen.
- `artwork.prepare`: inicio, resultado y duración; incluye fallos de descarga, lectura y conversión de imagen.
- `artwork.render`: apertura de la imagen o fallo de decodificación en WinUI; el destino identifica el archivo local de caché.
- `motion.render`: fallo al copiar o dibujar un fotograma de la portada animada en Windows; se vuelve a la imagen fija. Los eventos `motion.resolve` del backend distinguen el vídeo descargado (`ready`), una ausencia verificada de vídeo (`none`), un álbum sin resolver (`unmatched`) y un fallo del proveedor o almacenamiento (`failed`); `retryAfterMs` indica la espera.
- `motion.search`: método `itunes` o `apple-music`, resultado, número de candidatos y duración. `motion.candidate` registra el ID de álbum verificado y su resultado (`none`, `missing` o `failed`); `ready` en la búsqueda identifica el método y el ID que encontró el vídeo. No se registran términos de búsqueda, títulos, tokens ni URLs de vídeo firmadas.
- `lyrics.backfill`: recuperación de letras faltantes en descargas antiguas. El destino es el ID de YouTube y `lyricsStatus` indica el resultado, sin registrar el texto de la letra. Los fallos aplican una pausa antes del siguiente intento.
- `discord.connection`: estado de la conexión local (`waiting`, `connected`, `disabled` o `error`) y fallos al crearla. `connected` solo acredita la conexión RPC; no garantiza visibilidad en otros perfiles.
- `discord.presence`: solicitud de actualización (`updated`) o retirada (`cleared`). No registra títulos, artistas, portadas ni información de la cuenta; no acredita por sí sola la presentación visual.
- `discord.rpc` / `discord.worker`: errores del adaptador o del trabajador. En `discord.rpc`, `status` contiene un código de Discord RPC, no un estado HTTP. Los mensajes y payloads del SDK no se vuelcan al registro.
- `startup`, `startup.essential`, `startup.content` y `startup.window`: preparación y revelado de la interfaz. `startup.content: deferred` significa que se agotó la espera opcional de 5 segundos; la petición puede seguir activa. Véase [startup.md](startup.md).

El tiempo de `http.outgoing` no mide la descarga completa del cuerpo. Una respuesta HTTP correcta puede ir seguida de un fallo de lectura o conversión; revisar también `artwork.prepare` y `artwork.render`. Las solicitudes concurrentes pueden intercalarse: relacionarlas por sesión, destino y proximidad temporal. No interpretar una línea `started` aislada como prueba de fallo mientras la solicitud sigue activa.

## Cómo investigar

1. Leer estos archivos antes de reiniciar Openfy: un arranque real destruye la evidencia anterior. Si hace falta conservarla, copiar ambos archivos a una carpeta de diagnóstico del workspace antes del reinicio.
2. Reproducir el fallo en la sesión actual y anotar la hora aproximada, canción y acción.
3. Buscar `outcome: failed` y estados HTTP 4xx/5xx. Revisar eventos próximos del mismo destino.
4. Para una portada: seguir `artwork.cache` → `http.outgoing` (si hace falta descargar) → `artwork.prepare` → `artwork.render`. Una portada en caché no requiere petición externa.
5. Conservar el mensaje y tipo de excepción: `TimeoutError`, cancelaciones, códigos de red y estados HTTP distinguen problemas distintos. No afirmar una causa que los registros no demuestren.

No se registran cuerpos de solicitudes/respuestas, cabeceras de autenticación, cookies ni parámetros de consulta de las URLs. Las URLs se conservan como host/ruta; se retiran usuario, contraseña, query y fragmento. Los logs sí pueden contener identificadores del catálogo y rutas locales de imágenes. No añadir tokens ni URLs firmadas completas a futuros eventos.

El registro es de mejor esfuerzo: un fallo al escribirlo nunca debe impedir escuchar música ni sustituir el error original. Si falta un archivo o evento, comprobar permisos/espacio y no asumir que la petición tuvo éxito.

## Implementación

- `desktop/Openfy.Core/SessionLog.cs`: inicio, reinicio y escritura del registro nativo.
- `desktop/Openfy.Windows/App.xaml.cs`: inicio único de la sesión.
- `desktop/Openfy.Windows/Services/BackendHost.cs`: entorno compartido con Node y comandos del puente.
- `desktop/Openfy.Core/BackendClient.cs`: solicitudes HTTP del cliente.
- `desktop/Openfy.Windows/Views/Ui.cs`: apertura/fallo de imágenes.
- `server/plugins/diagnostics.ts`: instrumentación HTTP entrante y `fetch` saliente.
- `server/utils/session-diagnostics.ts`: escritura y eliminación de datos sensibles de URLs.
- `server/utils/desktop-bridge.ts`: etapas de preparación y caché de portadas.

Node recibe `OPENFY_SESSION_LOG_DIR` y `OPENFY_SESSION_ID` del proceso nativo. No vaciar archivos al iniciar Node: se perdería evidencia cuando el backend se recupera dentro de la misma sesión.
