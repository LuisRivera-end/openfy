# “Bad Romance”: errores intermitentes y reproducción nativa

El 13 de noviembre de 2026 se reprodujeron respuestas 503 para `J2kPH11Z4cM`, la pista reportada por el usuario. El catálogo seguía respondiendo. El registro de ese intento mostró `TypeError: fetch failed` al abrir el audio; una comprobación posterior del mismo identificador devolvió HEAD 200 y rangos 206. No se conserva evidencia suficiente para atribuir el intento original de madrugada a una causa de red concreta.

El proxy renovaba las URLs ante algunos estados HTTP, pero propagaba directamente las excepciones de conexión. Ahora admite una renovación y un reintento también para esas excepciones, al inicio y al abrir fragmentos posteriores. Distingue cancelación del usuario y timeout del proveedor. Los registros añaden el código de red disponible sin revelar la URL firmada. Vitest comprueba el fallo inicial y el de un fragmento posterior, sin repetir los bytes ya enviados.

En el cliente nativo existía un segundo fallo reproducible: el MP4 fragmentado de Google contenía AAC válido y duración correcta, pero Media Foundation devolvía fin de stream antes de la primera muestra. Se comprobó tanto sobre la caché HTTP como sobre un stream completo en RAM para aislar el contenedor del transporte. No se escribió audio remoto en disco.

`FragmentedMp4Stream` reconstruye un índice M4A virtual a partir de `tfhd`/`trun`, conservando los mismos bytes AAC y sus tiempos. Obtiene los metadatos con rangos pequeños, sin precargar los bloques de audio de toda la canción. Media Foundation conserva la decodificación y WASAPI la salida. Una regresión generada con FFmpeg comprueba AAC fragmentado, decodificación y seek; otra cubre lecturas que cruzan el límite de un bloque HTTP.

Resultados reales posteriores a la corrección:

| Cliente | Comprobación |
|---|---|
| Chromium | Reproducción continuada hasta 12 s, salto a 162,96 s, duración 294,466667 s y sin error de audio |
| Nativo | Reproducción hasta 3,39 s, salto y avance hasta 163,85 s, salto pausado conservado; duración 294,466644 s |

Artefactos: `output/playwright/youtube-real.json`, `output/playwright/bad-romance-real.png` y `output/youtube-qa/native/youtube-smoke.json`. El script `scripts/check-youtube-playback.mjs` repite la prueba real en el navegador; la opción nativa `--youtube-test <id>` repite la prueba del motor de Windows. Las fixtures de navegador no consultan YouTube y no sustituyen estas comprobaciones.

La reproducción real con Safari, pantalla bloqueada y cambios de red en un iPhone necesita validación en ese dispositivo. Las restricciones de una pista o cambios futuros del proveedor siguen siendo errores recuperables, no una garantía de disponibilidad de todo el catálogo.
