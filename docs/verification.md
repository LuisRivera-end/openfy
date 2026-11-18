# Verificación de la primera implementación

Verificada en Windows el 11 de noviembre de 2026, con Node 22.22.3.

| Comprobación | Resultado |
| --- | --- |
| Compilación Nuxt de producción y generación del service worker | Correcta |
| Comprobación TypeScript / Vue | Correcta |
| Pruebas unitarias e integración local | 22 de 22 correctas |
| Flujos en Chromium | 10 de 10 correctos |
| Flujos en WebKit con viewport móvil | 10 de 10 correctos |
| Scripts de Windows: inicio, respuesta HTTP y parada | Correctos |
| `setup.ps1` completo en Windows PowerShell 5.1: `npm ci` y compilación | Correcto; lockfile sin cambios tras instalar |
| Acceso desde el iPhone por la dirección HTTPS de Tailscale | Confirmado por el usuario |
| Descarga en el iPhone | Confirmada por el usuario |
| Reproducción con pantalla bloqueada en el iPhone | Confirmada por el usuario |
| Reproducción en modo avión en el iPhone | Confirmada por el usuario |
| Streaming mediante datos móviles | Pendiente |
| 45 minutos bloqueado, audífonos, llamadas y Bluetooth | Pendiente |

Las pruebas de navegador usan audio sintético, bibliotecas temporales y una instancia separada del servidor. Comprueban importación desde la interfaz, búsqueda, favoritos, creación/edición de playlists y conflicto entre revisiones, HTTP Range/HEAD, ausencia de caché implícita durante streaming, descarga con verificación, reapertura offline, seek desde caché, eliminación local, avance automático, continuidad entre rutas, rechazo de una descarga incompleta, cuota insuficiente simulada sin eliminar una descarga anterior y restauración de posición sin autoplay.

Las pruebas locales cubren además etiquetas ausentes, duplicados, archivos dañados y extensiones engañosas, portada incrustada y paleta, conservación del FLAC original, generación de AAC, fallo/reintento de FFmpeg y pausa de conversiones durante reproducción.

Las capturas están en `output/playwright` (no se versionan). La validación física inicial se basa en el reporte del usuario del 11 de noviembre de 2026: «funcionó perfectamente, descarga, bloqueo y avión». Este reporte confirma esas tres funciones; no especifica duración de la sesión, avance automático, reapertura con el PC apagado ni comportamiento ante llamadas o cambios de Bluetooth. Las comprobaciones restantes están en [el protocolo de iPhone](iphone-validation.md).
