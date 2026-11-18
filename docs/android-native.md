# Openfy nativo para Android

Abrir `android/` en Android Studio. Producción usa `app.openfy.android` y debug `app.openfy.android.debug`, con datos separados. Se admiten Android 10 (API 29), ARM64 y x86_64; compilación/destino API 37.

## Compilar y verificar

Requiere Android SDK Platform 37, Build Tools 36, JDK 25 (JBR de Android Studio funciona), Node compatible con el repositorio y `npm ci`. Gradle Wrapper fija 9.4.1 y el catálogo fija las bibliotecas Android.

```powershell
$env:JAVA_HOME='D:\Android\jbr'
$env:ANDROID_HOME='D:\SDK'
.\android\gradlew.bat -p android :app:assembleDebug
.\android\gradlew.bat -p android :provider-smoke:run
.\scripts\test-android.ps1 -Serial emulator-5554 -RealProvider
.\scripts\package-android.ps1
```

La interfaz, importación, datos, servicios y audio son Kotlin. YouTube.js y los adaptadores existentes se empaquetan dentro del APK y se ejecutan en QuickJS-KT; no se necesita Node, WebView ni el PC en el teléfono. Kotlin proporciona HTTP y las APIs necesarias. Los bytes de audio no atraviesan JavaScript.

Catálogo y audio utilizan máquinas independientes para que una búsqueda no bloquee la renovación de audio. Una cancelación descarta la máquina afectada; una continuación caducada ofrece actualizar. El evaluador de firmas usa otra máquina, con límite de un segundo y sin acceso a red o archivos. Las respuestas de metadatos tienen tamaño limitado. La prueba JVM de búsqueda/rangos no sustituye la decodificación real en Android.

## Datos y audio

Room conserva canciones, playlists, descargas, letras, estadísticas y operaciones pendientes. La migración 1→2 añade pertenencia explícita a la biblioteca conservando identificadores y archivos. DataStore conserva sesión, efectos y filtros por vista. La sesión se restaura pausada sin consultar YouTube hasta que se solicita reproducir.

La importación copia MP3, AAC/M4A y FLAC desde el selector de archivos/carpetas. Calcula SHA-256 por bloques, deduplica y extrae etiquetas/portadas. Los temporales fallidos no se publican como canciones terminadas.

MediaSessionService es el propietario del audio, con controles del sistema y Bluetooth, foco de audio, desconexión de auriculares y bloqueo de CPU/Wi-Fi. YouTube se lee en rangos acotados y permite una renovación de URL conservando posición y formato.

El caché persistente pertenece a descargas explícitas y no se vacía automáticamente. La reproducción puede leerlo, pero no escribirlo: el streaming no crea descargas. DownloadService conserva trabajos/progreso. Una copia se anuncia disponible tras comprobar longitud, SHA-256 local y lectura del formato; el hash no es una firma del proveedor. Letras y portadas se intentan guardar por separado y sus fallos no invalidan el audio. Android puede limitar trabajos en segundo plano; se conservan para reanudarse.

Antes de completar bytes parciales se compara la identidad del recurso (video, itag, revisión `lmt`, longitud y MIME), independientemente de la firma temporal de la URL. Si cambia o no puede identificarse, la copia parcial falla y Reintentar comienza desde cero. Una pausa del mismo recurso conserva sus bytes.

La escucha cuenta avance real, excluye saltos/buffering y califica al 90 %. Los días usan America/Mexico_City. Las pruebas Android reutilizan contratos de letras y escucha de Windows/web. El movimiento se limita y se detiene cuando la vista queda oculta; las portadas animadas son opcionales y mantienen respaldo fijo.

## Sincronización privada

Windows: Ajustes → Android → Generar código. Android: Ajustes → Vincular con Windows. Introducir el origen HTTPS de Tailscale y el código de un solo uso, válido cinco minutos. Ambos necesitan acceso a la misma red privada para sincronizar; buscar y reproducir son independientes. Las credenciales se cifran mediante Android Keystore y se revocan desde Windows.

Se comparten favoritos de YouTube y nombre/orden/referencias de YouTube de playlists. Los archivos locales, audio, historial, descargas y cola permanecen en cada dispositivo. En playlists mixtas se reemplazan solo posiciones de YouTube y se conserva el orden relativo de las locales. El borrado compartido conserva una playlist local cuando corresponde; los conflictos mantienen copias. El outbox y las confirmaciones son idempotentes.

El backend migra aditivamente a SQLite v6. Nuevos endpoints: `POST /api/sync/v1/pair` y `POST /api/sync/v1/exchange`. El código se emite por el puente nativo; no existe una ruta pública para generarlo. Los handlers anteriores de favoritos/playlists alimentan el diario, incluyendo cambios de la PWA. Aplicar a la instalación Windows requiere `scripts/package-desktop.ps1`; una compilación web solo actualiza `.output` del repositorio.

Para pruebas, `scripts/android-sync-host.ts` levanta el protocolo real contra una biblioteca aislada y escucha únicamente en loopback. Solo debug admite HTTP a `127.0.0.1` mediante `adb reverse`; producción exige HTTPS privado.

## APK y firma

`package-android.ps1` ejecuta pruebas unitarias y lint, compila y verifica firma/alineación de 16 KiB. Publica APK, manifiesto SHA-256 y reportes en un directorio exclusivo de `output/android`. `-Debug` genera desarrollo; `-SkipTests` permite reutilizar verificaciones y queda registrado.

La primera compilación puede generar la clave en `%LOCALAPPDATA%\Openfy\development\android-signing`; las contraseñas se cifran con DPAPI fuera del repositorio. También admite `OPENFY_ANDROID_KEYSTORE`, `OPENFY_ANDROID_STORE_PASSWORD`, `OPENFY_ANDROID_KEY_PASSWORD` y `OPENFY_ANDROID_KEY_ALIAS`. Respaldar la clave permite firmar futuras actualizaciones. Instalar el siguiente APK sobre el anterior conserva datos; desinstalar elimina los datos privados de esa instalación.

## Actualizaciones por GitHub

Producción comprueba una vez al día las últimas 30 releases estables de `LuisRivera-end/openfy`, el mismo repositorio de Windows. Ajustes permite comprobar manualmente, descargar y abrir el instalador de Android. Una versión nueva aparece también en la pantalla principal. La comprobación no depende de Windows ni de la vinculación. Debug conserva su identificador independiente y se actualiza mediante herramientas de desarrollo.

Cada release debe adjuntar el APK de producción y `openfy-android-update.json`, ambos generados por `package-android.ps1`, junto a los artefactos de Windows/PWA. Publicar los archivos en GitHub es un paso de distribución; el script local no publica una release. Se exige el digest SHA-256 de los assets de GitHub, tamaño y hash del APK, versión creciente, ABI/API compatibles, identidad del paquete y el mismo certificado que la instalación existente. El instalador del sistema vuelve a verificar el APK y pide confirmación. Si Android solicita autorizar Openfy como origen, el usuario puede hacerlo en Ajustes y regresar al botón Instalar. No se desinstala la versión anterior.

Una descarga interrumpida se descarta y puede iniciarse de nuevo. Un APK ya verificado se reconoce al volver a comprobar GitHub. Los APK se guardan en el directorio privado de actualizaciones, separado del audio; al completar uno nuevo se retiran los APK anteriores de ese directorio. La clave externa debe conservarse: regenerarla impide actualizar las instalaciones existentes.

`scripts/test-android.ps1 -GitHubUpdate` añade la descarga y comprobación instrumentada del APK publicado; requiere que producción esté instalada en el emulador para comparar su certificado. Las pruebas de desarrollo conservan sus datos y paquete independientes.

El audio no se distribuye en el APK. Los avisos de terceros se incluyen y pueden consultarse en Ajustes. La aceptación física prolongada de ARM64, batería, Bluetooth e interrupciones se distingue de las pruebas del emulador.
