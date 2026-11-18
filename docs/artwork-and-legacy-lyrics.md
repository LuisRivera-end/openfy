# Portadas oscuras y letras de descargas antiguas

Corrección del 15 de noviembre de 2026.

## Diagnóstico

La miniatura de «Si Estuviésemos Juntos» (`r8OPcBFATtU`) tiene fondo negro, un ojo en el centro y un logo en la esquina inferior. El recorte anterior eliminaba el fondo hasta un rectángulo de 683 × 363 y después lo centraba como cuadrado. La reproducción de ese procesamiento produjo el mismo SHA-256 que la copia defectuosa guardada.

«COQUETA» (`fPczdTA1xU0`) no tenía una fila de letras en SQLite. El resolvedor trataba cualquier descarga como una copia cerrada: devolvía una ausencia sin consultar proveedores, incluso al reintentar. Antes de la actualización, 383 de las 500 descargas no tenían letras guardadas; las otras 117 sí tenían una fila de letras.

## Cambios

- El recorte acepta únicamente pares de franjas simétricas que abarcan el borde completo. Una composición oscura asimétrica conserva el centro original. La caché de imágenes pasa a v3 y las URLs remotas de la web cambian de versión; las fuentes v2 ajenas a miniaturas de video siguen disponibles sin conexión.
- Se regeneró la portada local afectada desde la miniatura original conservada. La nueva copia mide 720 × 720 y tiene otra identidad de contenido; la imagen anterior se conserva. La transacción verificó que solo cambiaron la portada y su paleta, con respaldo previo de SQLite.
- Las letras útiles de descargas se reutilizan aunque hayan caducado o tengan un formato anterior. Las letras faltantes se pueden consultar y guardar sin repetir el audio. Reintentar fuerza una consulta y conserva las letras útiles si el proveedor falla. `localOnly` mantiene el acceso estrictamente local.
- Un trabajo independiente completa las descargas antiguas en segundo plano, sin bloquear reproducción ni trabajos de audio. Comienza cinco segundos después del arranque, consulta una canción a la vez y hace una pausa ante errores. Las ausencias recientes respetan su caducidad. Windows actualiza el panel abierto cuando se completa la letra de la canción actual.

## Verificación

- 194 pruebas Vitest correctas, incluida la regresión de fondos negros, franjas, actualización de caché, recuperación de letras y pausas del trabajo de fondo. Tras añadir la notificación al escritorio se repitieron las 15 pruebas de descargas, correctas.
- Revisión TypeScript/Vue correcta.
- 51 pruebas .NET de contratos y lógica correctas.
- 34 escenarios de letras y descargas correctos en Chromium y WebKit móvil, incluida una descarga antigua con ausencia guardada, reintento y reapertura con la letra recuperada.
- Evidencia y respaldo: `output/diagnostics/si-estuviesemos-juntos-1794737108479/`.

## Publicación e instalación

Se publicó e instaló **Openfy 0.3.0+1794737915** mediante `scripts/package-desktop.ps1`. El ejecutable publicado pasó la comprobación de ventana y arranque antes de generar el instalador. La aplicación instalada confirmó el mismo número de compilación en `/api/status`, con mantenimiento desactivado; el SHA-256 del instalador coincide con el manifiesto del canal local. Los instaladores anteriores del directorio de salida y del feed se retiraron después de verificar la instalación nueva.

En la instalación real, «COQUETA» respondió con letras sincronizadas de LRCLIB (64 líneas), guardadas en SQLite. La portada nueva se sirvió correctamente desde su URL local. El resumen de identidades, favoritos, asociaciones de audio, assets y playlists coincidió exactamente antes y después de actualizar: siguen presentes las 558 canciones guardadas, 500 descargas y una playlist. Los primeros 44 trabajos de recuperación de letras terminaron sin errores; el resto continúa en segundo plano mientras Openfy permanece abierto y tiene conexión.

Los resultados de la instalación están en `installed-verification.json`, el empaquetado en `package.log` y la reparación y su respaldo en `cover-repair.json` y `before-cover-repair.sqlite`, dentro de la carpeta de evidencia.

La revisión automática rechazó por política la eliminación de `output/artwork-lyrics-check`, por lo que se conservó esa compilación de pruebas. La publicación y la instalación habían terminado correctamente antes de esa limpieza opcional.

Las pruebas de navegador usan letras y audio sintéticos. WebKit automatizado no equivale a verificar un iPhone físico. El trabajo de fondo solo puede guardar las letras que sus proveedores ofrezcan; una ausencia real o un fallo temporal no modifica la descarga de audio.
