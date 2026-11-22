# Openfy

Biblioteca musical personal para Windows, Android e iPhone. Windows dispone de una aplicación nativa .NET 10/WinUI 3 con audio WASAPI y fondos Direct3D. Android tiene una aplicación Kotlin/Compose autónoma distribuida por APK. Node/Nitro y SQLite sirven la biblioteca del PC y la PWA del iPhone.

**Android nativo:** abre `android/` en Android Studio. `scripts/package-android.ps1` genera el APK firmado y el manifiesto para actualizar desde GitHub. El teléfono reproduce archivos locales y YouTube Music, conserva descargas y sincroniza opcionalmente favoritos/playlists de YouTube con Windows. Consulta [arquitectura, compilación e instalación Android](docs/android-native.md) y [resultados de validación Android](docs/android-validation.md).

**Escritorio nativo:** ejecuta `scripts/package-desktop.ps1` para generar el instalador indicado en `output/desktop/openfy-update.json`. Node arranca con la aplicación; cerrar la ventana la envía a la bandeja. Consulta [instalación, desarrollo y arquitectura nativa](docs/windows-native.md) y [resultados de validación](docs/windows-validation.md). Para desarrollar: `scripts/setup-desktop.ps1`, `scripts/start-desktop.ps1` y `scripts/package-desktop.ps1`.

**Linux:** cada release incluye un paquete `.tar.gz` (x64 y arm64) con el servidor y la PWA, Node y FFmpeg incluidos, que se instala como servicio de systemd del usuario. No hay aplicación nativa para Linux. Consulta [instalación y publicación en Linux](docs/linux.md).

**Estado:** primera implementación funcional. Importación, biblioteca, favoritos, playlists, cola, reproductor ampliado, letras, conversiones y descargas están implementados. **El usuario confirmó en su iPhone la descarga y la reproducción con pantalla bloqueada y en modo avión.** Las pruebas prolongadas, de controles e interrupciones y la aceptación física de letras permanecen en [el protocolo de validación](docs/iphone-validation.md).

## Servidor y PWA en Windows

Con Node/npm ya disponibles en tu PC, desde PowerShell en la carpeta del proyecto:

```powershell
.\scripts\setup.ps1
.\scripts\start.ps1
```

`setup.ps1` instala Node 22.22.3 y npm 11.6.2 **solo para Openfy**, en `%LOCALAPPDATA%\Openfy\runtime`; no cambia tu Node global. Instala las dependencias del lockfile y compila. Requiere acceso a npm y a la descarga del binario FFmpeg durante la preparación. Los iconos generados ya están incluidos en el repositorio.

El puerto predeterminado es [3000](http://127.0.0.1:3000).

En este equipo se ha creado un `.env` local con `NITRO_PORT=3187`, porque el puerto 3000 ya está ocupado. La dirección actual es [http://127.0.0.1:3187](http://127.0.0.1:3187). El ejemplo de Tailscale de abajo debe usar también ese puerto si conservas esta configuración.

Para detenerlo:

```powershell
.\scripts\stop.ps1
```

`setup.ps1` detiene la instancia de Openfy iniciada por sus scripts antes de reinstalar y compilar. Si compilas manualmente, detén primero el servidor: Windows bloquea el módulo nativo de SQLite mientras se está utilizando. Tras preparar, ejecuta `start.ps1` de nuevo. El servidor se inicia oculto y los registros se guardan en `%LOCALAPPDATA%\Openfy\logs`.

Si ya utilizas un Node compatible (`^22.22.3`, `^24.15.0` o `>=26`):

```powershell
npm ci
npm run build
npm start
```

`npm run dev` inicia el desarrollo en localhost. El modo sin conexión se prueba con **la compilación de producción**, no con el servidor de desarrollo.

## Datos y formatos

La carpeta predeterminada es `%LOCALAPPDATA%\Openfy\data` (en otros sistemas, `~/Openfy/data`). Incluye `openfy.sqlite`, `originals`, `mobile`, `artwork` y `staging`. Los archivos importados se copian; no se mueven ni modifican tus originales. Los datos y el audio no se guardan en Git.

Copia `.env.example` a `.env` para personalizar el puerto o `OPENFY_DATA_DIR`. Usa una carpeta absoluta fuera del repositorio. Mantén esta ruta estable: cambiarla abrirá otra biblioteca.

- MP3 y AAC/M4A compatibles: reproducción directa.
- FLAC: original conservado; FFmpeg genera un AAC de 256 kbps para el iPhone. El PC puede reproducir FLAC si su navegador lo decodifica; de lo contrario usa AAC.
- Las importaciones por archivos o carpetas extraen etiquetas, duración y portada incrustada. Sin etiquetas se utiliza el nombre del archivo. Archivos idénticos se deduplican por SHA-256.
- Las conversiones son trabajos persistentes, de uno en uno. Al comenzar reproducción conectada se pausa/cancela la conversión actual y vuelve a la cola. Si el dispositivo que la pausó se cerró sin avisar, usa **Ajustes → Reanudar / reintentar** después de terminar de escuchar. No hay conversión al solicitar un stream.
- La biblioteca, favoritos y playlists se editan con conexión al PC. Cola, posición y descargas pertenecen a cada dispositivo. Al reabrir se restaura la posición sin reproducir automáticamente.

La biblioteca local se forma con tus archivos. Openfy también permite buscar canciones públicas de YouTube Music y escucharlas por streaming desde el campo superior **¿Qué quieres escuchar?**. Incluye letras para ambas fuentes. No incluye acceso al catálogo de Apple Music, ecualizador, crossfade ni sincronización de reproducción.

## Letras

En PC, el botón de micrófono del reproductor abre **Letras**, alternando con la cola. En iPhone, abre el reproductor ampliado y selecciona **Letras** junto a **Portada**. La línea actual se resalta siguiendo la posición real del audio; pulsa un verso para saltar a ese momento, incluso con la reproducción pausada. Al desplazarte manualmente aparece **Seguir reproducción**. Cuando solo existe texto se muestra completo, sin saltos por verso.

Se priorizan las letras sincronizadas incrustadas, después las sincronizadas de LRCLIB, el texto incrustado y el texto del proveedor. Los archivos ya importados se revisan la primera vez que se consulta su letra; no necesitas reimportarlos. Para YouTube Music se utiliza LRCLIB y, como respaldo, el texto disponible mediante YouTube.js. Las consultas externas se realizan desde el PC, usando título, artista, álbum y duración; no se envía el archivo de audio. LRCLIB funciona sin clave de API. La disponibilidad y los tiempos dependen de las fuentes y de que los metadatos identifiquen la grabación correcta.

Las letras consultadas se guardan en el dispositivo. Descargar una canción local también intenta guardar su letra; si falla o no existe, la descarga de audio continúa siendo válida. Al recuperar conexión con el PC se intentan completar las letras pendientes de tus descargas. Una letra guardada puede abrirse sin conexión y sin el PC; las descargas de YouTube siguen el mismo sistema de audio y letras. Si solo está guardado el audio, la vista lo indica. Las letras permanecen sujetas a las mismas limitaciones de almacenamiento del navegador que los demás datos locales.

El servidor conserva resultados positivos durante 30 días y ausencias durante 24 horas; los fallos temporales permiten reintentar y no se guardan como ausencias. Una duración real incompatible invalida la coincidencia anterior. La interfaz distingue canciones instrumentales, letras no encontradas y errores de consulta. No incluye edición, traducciones ni importación independiente de archivos LRC. Consulta [la verificación de letras](docs/lyrics-validation.md).

## YouTube Music

La búsqueda se escribe directamente en el campo superior. **Todo** presenta un resultado destacado, cuatro canciones y hasta seis artistas y álbumes; **Canciones**, **Artistas** y **Álbumes** muestran cada categoría con carga automática al desplazarte. Los artistas abren su perfil, con imagen, información, canciones populares, álbumes y singles/EPs. «Ver todas las canciones» carga 20 pistas y continúa en bloques de 10; la discografía muestra seis lanzamientos por sección y se amplía a 12 y después de 12 en 12. Cada álbum tiene su propia página con las pistas ordenadas y reproducción completa o desde una canción. Los nombres y álbumes con identificador del proveedor también son enlaces. Al volver a Buscar se conservan la consulta, los resultados y la posición durante la sesión.

Canciones y artistas se consultan en paralelo y tienen errores y reintentos independientes. Las continuaciones del catálogo permanecen en el PC, caducan tras 15 minutos y se pueden actualizar desde la interfaz. Las páginas externas usan `/music/artist/…` y `/music/album/…`; las colecciones importadas conservan sus direcciones y funciones actuales.

**La búsqueda global** consulta YouTube Music. La búsqueda local y «Solo descargadas» permanecen en los filtros de biblioteca y colecciones. Escribe al menos dos caracteres: en Canciones se muestran 20 resultados inicialmente y se añaden bloques de 10 al acercarte al final; Artistas y Álbumes avanzan en bloques de seis. Limpiar deja la búsqueda vacía y restablece Todo. Al visitar un artista o álbum y volver se conservan consulta, categoría y desplazamiento. Consulta [el diseño de búsqueda](docs/search-design.md). Se conserva el orden y se eliminan duplicados. Si una carga posterior falla, las canciones visibles permanecen y puedes reintentar; una búsqueda caducada ofrece actualizar. Puedes reproducir la lista desde una canción o añadir canciones individuales a la cola, combinándolas con archivos locales. También puedes marcar canciones de YouTube Music como favoritas y añadirlas a playlists junto con archivos locales, desde el corazón o las opciones de cada canción. Se guardan sus referencias y metadatos en la biblioteca del PC y se conservan el orden y las revisiones de las playlists. Las colecciones mixtas reproducen y descargan ambas fuentes en orden. Mantener descargada una playlist incorpora automáticamente sus canciones nuevas. Cada dispositivo conserva su propia preferencia de descarga; las copias terminadas pueden escucharse sin Internet.

La conexión utiliza YouTube.js instalado en el PC, detrás del adaptador de Openfy. No requiere una API intermediaria ni iniciar sesión. El PC y la conexión a Internet deben permanecer activos para buscar y reproducir. El audio se transmite mediante Openfy, con soporte para adelantar y retroceder. Descargar guarda una copia AAC/M4A en el PC asociada a la misma canción; el iPhone puede guardar después su propia copia verificada. Escuchar por streaming no crea descargas implícitas. Las colas se restauran pausadas y YouTube solo se consulta para reproducir cuando lo solicitas.

YouTube.js utiliza una interfaz no oficial. YouTube puede restringir canciones o cambiar sus respuestas: en esos casos Openfy muestra un error y permite reintentar. La reproducción real está comprobada en Chromium; el motor WebKit de Windows no mantuvo la reproducción de las pistas reales. Safari y la reproducción con pantalla bloqueada en el iPhone deben validarse por separado de los archivos locales; la validación previa de la biblioteca no confirma esta nueva fuente. Consulta [los resultados y límites de verificación](docs/youtube-validation.md).

Los fallos de audio se registran localmente en `%LOCALAPPDATA%\Openfy\logs\error.log` con la etiqueta `[youtube-music]`, identificador de canción, etapa, código y estado del servidor de YouTube cuando está disponible. No se registran URLs firmadas ni tokens. Un rechazo temporal de un fragmento admite una renovación y un reintento desde el mismo byte; si el formato cambia o vuelve a fallar, se muestra el error. El diagnóstico exportable de Ajustes conserva también el estado del motor de audio del navegador.

Con el servidor iniciado, `npm run test:youtube` comprueba búsqueda real, HEAD y rangos de 1024 bytes al principio y a mitad de la canción sin guardar archivos. Opcionalmente puedes indicar dirección y búsqueda: `npm run test:youtube -- http://127.0.0.1:3187 "Daft Punk Get Lucky"`.

## iPhone fuera de casa con Tailscale

1. Instala Tailscale para Windows y iPhone e inicia sesión con tu cuenta personal en ambos. Limita el acceso a tus dispositivos en la configuración de tu red privada.
2. Con Openfy iniciado, en una consola de administrador configura el proxy privado:

   ```powershell
   tailscale serve --bg http://127.0.0.1:3000
   tailscale serve status
   ```

3. Si Tailscale pide habilitar HTTPS para la red, sigue su configuración. No utilices Funnel: Serve debe permanecer accesible solo dentro de tu red privada. Consulta [la documentación oficial](https://tailscale.com/docs/features/tailscale-serve).
4. Copia la dirección HTTPS que devuelve Tailscale a `.env`, por ejemplo `OPENFY_ORIGIN=https://mi-pc.mi-red.ts.net`. Detén y reinicia Openfy para aplicar el cambio. La app solo acepta localhost y ese origen privado explícito.
5. En ambos dispositivos usa esa dirección HTTPS estable. En el iPhone, abre Safari → Compartir → **Añadir a pantalla de inicio**. Abre la app desde su icono y espera la primera carga. En Windows también puedes instalarla desde Edge o Chrome.

El servicio escucha exclusivamente en `127.0.0.1` cuando se inicia con los scripts o `npm start`. No se abren puertos del router, no se publica el catálogo en Internet y no hay un login adicional de Openfy: el acceso depende de Tailscale y sus permisos. No uses esta configuración para una red compartida con usuarios no autorizados.

Para **streaming**, PC, servidor y Tailscale deben estar activos y el iPhone necesita Internet. Para **descargas completas**, el PC y la VPN ya no son necesarios durante la escucha. Si Windows entra en suspensión, el streaming deja de estar disponible.

## Descargas

Descarga desde un álbum, playlist o las opciones de una canción, incluidos los resultados de YouTube Music. Una playlist marcada incorpora automáticamente las canciones nuevas cuando el dispositivo está activo y conectado. Quitar una canción o dejar de actualizar la playlist conserva sus archivos hasta eliminarlos manualmente. Consulta [funcionamiento, API y validación de descargas](docs/downloads.md). Solo se marca lista cuando el archivo completo coincide en tamaño y SHA-256. Los bytes se procesan en streaming sin cargar el archivo completo en memoria. El service worker responde a rangos desde la copia completa para poder adelantar offline.

Las descargas requieren la app abierta; no se promete continuidad de descargas con la pantalla bloqueada. La música escuchada por streaming no se almacena como descarga. Se conservan durante actualizaciones y solo se activa una versión nueva cuando la aceptas con la música pausada.

El almacenamiento del navegador tiene cuota y puede ser eliminado por el sistema o por el usuario. Openfy solicita persistencia, muestra el uso y comprueba la presencia de los archivos al abrir. No elimina descargas automáticamente para liberar espacio. Los originales del PC siguen siendo la copia principal. [Política de WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/).

## Pruebas y diagnóstico

La aplicación nativa crea logs temporales de peticiones y portadas por sesión. Se vacían al siguiente arranque real. Para investigarlos antes de reiniciar, consulta [la guía de logs de sesión para agentes](docs/session-diagnostics.md).

```powershell
npm test
npm run typecheck
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

Las pruebas usan directorios temporales independientes, audio sintetizado y un servidor en `127.0.0.1:4175`; no tocan la biblioteca personal. Cubren importaciones, duplicados, archivos dañados, conversión/reintento, rangos HTTP, playlists, reproducción entre rutas, avance automático, integridad de descargas, reapertura offline y falta de espacio. Las capturas de escritorio y móvil se guardan en `output/playwright`.

Para preparar la sesión física sin tener todavía archivos propios, con el servidor iniciado ejecuta `npm run test:audio`: genera e importa diez pistas sintéticas originales de cinco minutos. Son solo material de validación. `-- --duration=5` permite una prueba corta; la aceptación requiere al menos 45 minutos.

El protocolo de iPhone y la tabla de resultados están en [docs/iphone-validation.md](docs/iphone-validation.md). El informe de Ajustes se exporta a un JSON local. La telemetría de escucha se guarda en tu biblioteca del PC; los diagnósticos no se envían a terceros.

## Escucha, recomendaciones y filtros

Windows y la PWA registran minutos realmente escuchados de archivos locales y YouTube Music. Una reproducción cuenta al escuchar el **90 % de la duración real**; adelantar, pausar o esperar buffering no suma tiempo ficticio. Las escuchas sin conexión se conservan en el dispositivo hasta sincronizarse con el PC.

Inicio muestra el resumen, tus diez canciones más reproducidas y recomendaciones de YouTube Music basadas en la escucha de Openfy, sin vincular Google. **Más reproducidas** abre el ranking completo por 7 días, 30 días, año actual o historial; los días se calculan en `America/Mexico_City`.

Las bibliotecas mixtas, favoritas, playlists, artistas y álbumes incorporan filtros por texto, artista, álbum, género, favoritos y origen, más descargas en la PWA. Las columnas permiten ordenar también por duración, reproducciones y minutos. Reproducir usa los resultados visibles; ordenar una playlist no modifica su orden guardado. Los filtros se conservan por vista en cada dispositivo. Consulta [comportamiento, API y validación de telemetría](docs/telemetry.md).

## Respaldo

Detén Openfy y copia **toda** la carpeta de datos a otro disco. Incluye la base SQLite y los archivos `-wal`/`-shm` si existen. Para restaurar, con el servidor detenido devuelve esa carpeta a su ruta o configura `OPENFY_DATA_DIR` y reinicia. No copies únicamente la base de datos: los audios y portadas viven en carpetas separadas. El esquema se crea y actualiza mediante migraciones idempotentes (`PRAGMA user_version = 6`); las actualizaciones conservan biblioteca, audio y playlists, y añaden el diario de sincronización Android.
