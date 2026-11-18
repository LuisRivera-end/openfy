# Validación de Android nativo

Fecha: 17 de noviembre de 2026. Primera implementación funcional; la aceptación física ARM64 permanece pendiente.

## Entrega

APK de producción: `output/android/0.5.1-1794906885-release-8c4f14a6/Openfy-0.5.1-1794906885-release.apk`.

- Versión: **0.5.1+1794906885**, identificador `app.openfy.android`, Android 10+, ARM64 y x86_64.
- Tamaño: **8 264 907 bytes**.
- SHA-256: `9d2e84528a55dba01c46fabe271b870dd55202f37f569094443875041408048c`.
- Firma APK v2 verificada mediante `apksigner`; alineación del ZIP de 16 KiB comprobada mediante `zipalign`.
- Certificado SHA-256: `6f57ea7b7b654bb1ba86926fb07daf87157cd960dda339376f50593ab44f69da`.
- El mismo directorio contiene `openfy-android-update.json`, firma, logs y reportes. La clave privada permanece fuera del repositorio.

Publicada como [release estable 0.5.1](https://github.com/LuisRivera-end/openfy/releases/tag/v0.5.1-build.1794906885), junto al instalador Windows y sus dos manifiestos. Los cinco assets se compararon por tamaño y digest de GitHub contra los archivos locales antes de publicar. La compilación Android inicial 1794905713 quedó como preliminar, conservando sus archivos, al encontrar y corregir la lectura de certificados en Android 10.

El APK se instaló desde el actualizador de GitHub sobre la base de prueba 1794905714, con el mismo identificador y certificado. Android mostró «App installed» y confirmó `versionCode=1794906885`. La playlist «GitHub conserva datos», creada antes de actualizar, permaneció visible. La migración Room 1→2 se comprobó por separado en debug, conservando identificadores y biblioteca; la descarga verificada continuó siendo reproducible tras reemplazar el APK y reiniciar el proceso.

## Comprobaciones

| Área | Evidencia y resultado |
|---|---|
| Contratos Kotlin | 7 pruebas JUnit correctas: fixtures compartidas de escucha y letras, proyección mixta, identidad de recursos y reglas de actualización/hash. Reportes en el directorio del APK. |
| Android lint | 0 errores, 30 advertencias; incluye avisos de versiones/deprecaciones y sugerencias KTX. |
| Importación y audio local | MP3, M4A y FLAC reales con etiquetas sintéticas: copia, deduplicación SHA-256, duración, reproducción, búsqueda de posición y limpieza de una importación inválida. Ejecutado en API 29 y API 37. Letras incrustadas de M4A/FLAC comprobadas. |
| YouTube autónomo | QuickJS ejecutó búsqueda real; Media3 reprodujo más de 20 segundos, saltó a la mitad de la canción y continuó. Se descargó y verificó el audio, incluida la identidad del recurso. La prueba no utiliza la API musical de Windows. |
| Catálogo QuickJS | Prueba JVM ampliada: 20 canciones iniciales, continuación con resultados, 6 artistas, 6 álbumes, perfil y álbum de 13 canciones; resolución AAC y rangos al inicio/mitad. `output/android-catalog-smoke.log`. |
| Arranque sin red | Tras detener el proceso y desactivar Wi-Fi/datos del emulador API 37, reprodujo la descarga verificada desde caché y continuó al apagar la pantalla. `output/android-tests/api37-cold-offline-final.txt`. |
| Interfaz | Dos pruebas Compose correctas tanto en API 29 como en API 37: navegación, creación de playlist, ajustes, reproductor ampliado, letras y controles tras rotación. Capturas revisadas en `output/android-screens`. |
| Sincronización Android | Vinculación y credencial Keystore contra el protocolo Node real con SQLite aislado. Edición de playlist mixta conservó referencias locales del PC. Favoritos locales excluidos. Se cortó la conexión después de confirmar una transacción y el reintento no duplicó operaciones. `output/android-tests/api29-sync-final.txt`. |
| Contratos del servidor | Suite Vitest completa: 228 casos correctos. Incluye migración aditiva, códigos de vinculación, revocación, revisiones incompatibles, borrados, preservación local e idempotencia tras reabrir SQLite. Tipos y compilación Nuxt correctos. |
| Windows | 99 pruebas Core y 17 Audio correctas. Paquete nativo aplicado; `/api/status` confirma **0.5.1+1794904642**. La respuesta completa de biblioteca coincide antes/después: 560 canciones de YouTube y una playlist. |
| GitHub | Release estable publicada, cinco assets verificados. Consulta, descarga, comprobación de certificado, autorización de origen en el emulador e instalación con el instalador del sistema: correctas en API 29. Se conservó la playlist de prueba. Pruebas de rechazo de downgrade, ABI/API/certificado incompatible, origen ajeno y APK alterado/incompleto. Capturas/árboles `output/android-screens/github-*`. |

Los ensayos de sincronización usan exclusivamente la fixture aislada `scripts/android-sync-host.ts`; no se añadieron canciones ficticias a la biblioteca instalada. Las pruebas locales Android emplean archivos sintéticos de ocho segundos, no audio distribuido dentro del APK de producción.

## Incidencias resueltas durante la verificación

- El DNS que tomó inicialmente el emulador no resolvía `www.youtube.com`. Se reiniciaron los emuladores de prueba con un DNS explícito; la aplicación no impone uno.
- Se separó el origen de red de DownloadManager del caché de reproducción. El streaming solo lee descargas explícitas y no las crea.
- Las pruebas Compose de API 37 encontraron la reflexión antigua de `InputManager` en Espresso transitivo. Se fijó Espresso estable 3.7.0 y ambas pruebas pasaron.
- El servicio de inspección de Android CLI puede retener UiAutomation. `test-android.ps1` lo detiene antes de iniciar el runner. La repetición de la prueba offline pasó.
- La descarga real de GitHub detectó que Android 10 no recogía el certificado del archivo con solo `GET_SIGNING_CERTIFICATES`. Se solicitan ambos flags y se sigue comparando `SigningInfo`. La prueba instrumentada descarga el APK publicado, verifica hash, versión, SDK y certificado contra la instalación de producción. La limitación está presente en [PackageManager de Android 10](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android10-release/core/java/android/content/pm/PackageManager.java).
- Un primer empaquetado de Windows encontró un directorio `refint` inexistente; no se reprodujo al repetir la publicación. Otro primer arranque excedió el plazo del instalador y se revirtió. La transacción posterior tiene `startup.json` y `success.json` correctos; se verificaron compilación instalada y conservación íntegra de biblioteca. No se atribuye una causa al timeout sin evidencia adicional.

## Pendiente de aceptación

- Teléfono ARM64 físico: 45 minutos de audio, Bluetooth, llamadas/interrupciones, cambios de red, batería y restricciones reales del fabricante.
- Reproducción con el PC físicamente apagado en un teléfono. El emulador demuestra acceso directo al proveedor, pero se ejecuta en este PC.
- Reanudar una descarga parcial a través de un reinicio completo del dispositivo y cambios reales de recurso/red; la persistencia y la comprobación de identidad están implementadas, pero este escenario físico completo todavía no se certifica.
- TalkBack físico, Atrás predictivo mediante gestos y disponibilidad real de portadas animadas para distintos álbumes.

Consulta [arquitectura y distribución](android-native.md) para reproducir compilaciones y preparar las siguientes releases. Estas pruebas no acreditan que YouTube mantenga su API privada o la disponibilidad futura de una canción.

## Rediseño visual (17 de noviembre de 2026, noche)

Rediseño de la interfaz Android y portadas animadas, descrito en [Openfy nativo para Android](android-native.md#interfaz). Commits locales `04640fa`, `9bb0f80`, `bc236c3` y `b851709` sobre la base `e411245`, sin publicar.

APK de producción: `output/android/0.5.3-1794978869-release-a4deb691/Openfy-0.5.3-1794978869-release.apk`.

- Versión **0.5.3+1794978869**, `app.openfy.android`, Android 10+, ARM64 y x86_64; **8 053 225 bytes**.
- SHA-256 `e86b953a22378b6f6ba60811b47b4f6c3127ee3c9e4cf52cbfeac8fd2ad2cef8`.
- Firma APK v2 verificada, con el mismo certificado `6f57ea7b…69da`, así que se instala sobre la versión anterior conservando datos.
- Empaquetado con `-SkipTests` porque las comprobaciones se ejecutaron justo antes con `test-android.ps1`.

| Área | Evidencia y resultado |
|---|---|
| JVM | 20 pruebas correctas: contratos (escucha, letras, portadas, iluminación), modelo del inicio, lector del export de Spotify, actualizaciones y búsqueda. |
| Instrumentadas API 37 | `test-android.ps1 -Serial emulator-5554`: 14 pruebas correctas, incluidas `UiSmokeTest`, `NativeSmokeTest` y `ProviderThreadingTest`. Las de sincronización, GitHub y diseño se omiten sin sus argumentos. |
| Lint | 0 errores, 37 advertencias (antes 30). |
| Vitest | 250 casos, incluidos los contratos nuevos de portadas y la coincidencia de Spotify. `motion-art.test.ts` falló de forma intermitente una vez de cuatro con «Motion storage», un error de escritura de archivos temporales del servidor; las otras tres ejecuciones pasaron. El código de ese test y de la caché del servidor no cambió. |
| Revisión visual | `DesignQaTest` sobre una copia consistente de la biblioteca real (560 canciones, 502 favoritas, una playlist, historial real), servida por `scripts/android-design-host.ts`. Cinco rondas de capturas en API 37 y dos en API 29 (respaldo de iluminación sin AGSL), en `output/android-design/`. La copia se borró al terminar. |
| Portadas animadas | `music.apple.com/us/browse` redirige a `/us/new`; con las redirecciones Apple-only, «Un Verano Sin Ti» resuelve 1080 × 1080. `c2.goldfish.h264.decoder` falla con los streams de Apple; el respaldo a `c2.android.avc.decoder` reproduce el vídeo y la cabecera del álbum cambió 121 679 píxeles en 0,7 s. |
| Arranque | `DesignQaTest#playbackLatency`: la primera canción tras un arranque en frío tarda unos 22 s en el emulador; las siguientes, entre 1,5 y 3 s. El tiempo está en la primera resolución de YouTube; evaluar antes el paquete del proveedor no lo redujo de forma apreciable. |

Pendiente de aceptación:

- **Teléfono físico:** portadas animadas con el decodificador por hardware, latencia de la primera canción, contraste del reproductor con portadas claras y gestos del minirreproductor.
- **Spotify:** importación con un export real de la cuenta.
- **Pantalla de bloqueo:** prototipo del fondo animado propuesto en [Pantalla de bloqueo animada](android-lock-screen.md).
