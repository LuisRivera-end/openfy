# Validación de descargas

Comprobaciones del 14 de noviembre de 2026, zona America/Mexico_City. Se utilizaron bibliotecas y estados temporales independientes; no se reinició la aplicación del usuario ni se modificó su biblioteca.

| Comprobación | Resultado |
|---|---|
| TypeScript / Nuxt typecheck | Correcto con el Node privado del proyecto |
| Vitest | 147 pruebas correctas en 17 archivos |
| Batería completa Playwright | 110 pruebas correctas, Chromium y WebKit móvil |
| Solicitud manual pendiente tras reapertura | 2 comprobaciones adicionales correctas, una por motor |
| Contratos y lógica .NET | 28 pruebas correctas |
| Audio y recuperación de backend .NET | 9 pruebas correctas |
| Descarga real con el backend final | Dos canciones completas; SHA-256, playlist automática, conservación al quitar canciones y recuperación tras reiniciar correctos |
| Aplicación nativa empaquetada | WASAPI local, seek al segundo 98,33 y seek pausado correctos; identidad y favorito conservados |
| Instalador | Compilado, comprobación de arranque y SHA-256 verificados |

Las pruebas completas de navegador cubren también importación, letras, sesiones, estadísticas, rangos HTTP, cuota, integridad de descargas y actualizaciones. Las dos comprobaciones añadidas después verifican que una solicitud explícita pendiente conserva su intención manual al volver a abrirse sin conexión y contactar después con el PC.

Se corrigieron durante la validación el desbordamiento del control de descarga en móvil y la clasificación de fallos de integridad como fallos transitorios de red. La comprobación real de descargas se repitió contra el backend final.

## Artefactos

- Informe real: `output/downloads-check/final-real.json`.
- Informe de la aplicación empaquetada: `output/downloads-check/packaged-native-state/offline-smoke.json`.
- Resumen verificable: `output/downloads-check/validation.json`.
- Instalador: `output/desktop/Openfy-Setup-0.3.0-1794714392-x64.exe`.
- Manifiesto: `output/desktop/openfy-update.json`, protocolo 1, SQLite compatible de v1 a v5.

El instalador se generó y comprobó primero en un canal de prueba separado. Después se publicó la compilación `1794714392` en `%LOCALAPPDATA%\Openfy\updates\feed`, verificando tamaño y SHA-256 y sustituyendo el manifiesto de forma atómica. Su aplicación queda a cargo del actualizador de Openfy.

## Pendiente físico

WebKit automatizado no confirma las políticas de suspensión de iOS. Falta comprobar en un iPhone físico las descargas, reapertura y reproducción prolongada con pantalla bloqueada, modo avión, controles de auriculares e interrupciones. Las transferencias de la PWA requieren mantenerla abierta; los trabajos incompletos se recuperan al abrirla de nuevo.
