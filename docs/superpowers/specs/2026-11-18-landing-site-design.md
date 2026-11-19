# Plan: página principal de Openfy (sitio informativo + descargas)

## Contexto

Openfy ya tiene app de Windows (instalador `.exe`), APK de Android y la PWA/web servida por el PC del usuario. Falta una **entrada pública**: una página que explique qué es Openfy y dé las descargas directas. Decisiones del usuario:

- **Público general**: cualquiera puede descargar y montar su propia biblioteca. La "versión web/PWA" no es un enlace a un servidor público (no existe): es una guía para instalar el servidor en Windows y abrir la PWA desde el iPhone/navegador por Tailscale.
- **Solo local por ahora** (sin hosting todavía; se deja listo para publicarse como sitio estático).
- **Español + inglés**.
- Estilo **minimalista con animaciones muy marcadas**, inspirado en cómo Apple construye sus páginas de producto (scroll cinematográfico, secciones fijadas, tipografía enorme, revelados). Inspiración de patrones, no copia de assets, marca ni textos de Apple.
- Orquestación: Claude planifica y ordena; **Gemini CLI** (cuota completa) hace el trabajo pesado; **ChatGPT/Codex** (cuota semanal limitada) solo tareas cortas y de alto valor.

Hallazgos que sostienen el plan:

- Releases públicas en `LuisRivera-end/openfy` (repo público). La última (`v0.5.4-build.1794983913`) trae `Openfy-<ver>-<build>-release.apk`, `Openfy-Setup-<ver>-<build>-x64.exe`, `SHA256SUMS.txt` y los manifiestos. Los botones pueden leer `GET /repos/LuisRivera-end/openfy/releases/latest` y caer a `/releases/latest` si falla.
- **Gemini CLI 0.41.2** ya está instalado y con OAuth personal (`~/.gemini/oauth_creds.json`): no hace falta instalar ni iniciar sesión.
- Lo que está abierto es la app **OpenAI Codex/ChatGPT** de escritorio, que incluye `codex.exe` (codex-cli 0.169.0-alpha) con sesión iniciada (`~/.codex/auth.json`). Se puede usar en modo no interactivo (`codex exec`) sin manejar la ventana por computer-use. Claude in Chrome no está conectado, así que no se usa ChatGPT web.
- Reutilizable del repo: `shared/release-notes.json` (Novedades, ya bilingüe-compatible en estructura), el sombreado ambiental `app/lib/ambient-gl.ts` + `shared/utils/ambient.ts` (fondo vivo a partir de una portada), tokens visuales de `app/assets/main.css`, iconos de `public/icons/`, capturas Android de `output/android-screens/` (verificar que vienen de fixtures sintéticos) y las capturas nativas `--visual-check` / `--visual-players`.

## Enfoque elegido

**Sitio estático independiente en `site/`** (Vite + TypeScript, sin framework), con **GSAP + ScrollTrigger + SplitText** para la coreografía y **Lenis** para el scroll suave. Su propio `package.json`/`tsconfig`, así no toca el build de Nuxt, `npm test` ni `npm run typecheck` de la raíz.

Descartados: añadir rutas al Nuxt de `app/` (mezcla la landing pública con la PWA privada y su service worker) y un repo aparte (pierde el acceso directo a `release-notes.json`, iconos y shaders).

## Estructura de la página

1. **Nav** fija translúcida con blur; logo, secciones, selector ES/EN, botón "Descargar".
2. **Hero**: titular gigante con revelado por palabras; fondo ambiental animado portado de `ambient-gl.ts`, cambiando lentamente entre portadas sintéticas; dispositivo flotando con parallax.
3. **Secuencia fijada (pin + scrub)**: un teléfono y una ventana de escritorio que recorren Inicio → reproductor → letras → Big Picture conforme se hace scroll.
4. **Características** (una por pantalla, estilo Apple): biblioteca local + YouTube Music juntas; letras sincronizadas (líneas que se iluminan con el scroll); descargas sin conexión verificadas; Big Picture y portadas en movimiento en Windows; privacidad (sin cuentas, sin telemetría a terceros, todo en tu PC).
5. **Cómo funciona**: diagrama animado PC (servidor + biblioteca) → Tailscale → iPhone/Android/Windows.
6. **Descargas**: tres tarjetas — Windows (`.exe`), Android (`.apk`), Web/PWA (guía paso a paso: instalar servidor, Tailscale Serve, "Añadir a pantalla de inicio"). Versión, fecha, tamaño y enlace a `SHA256SUMS.txt` leídos de la API; fallback estático.
7. **Novedades**: últimas entradas de `shared/release-notes.json`.
8. **Footer**: GitHub, licencia, aviso de que YouTube.js es una interfaz no oficial.

Reglas transversales: `prefers-reduced-motion` desactiva pin/scrub y deja transiciones de opacidad (`gsap.matchMedia`); solo `transform`/`opacity`; WebGL con fallback a gradiente CSS; responsive desde 360 px; modo claro/oscuro. i18n: diccionarios `site/src/i18n/{es,en}.json`; el build genera `/index.html` (es) y `/en/index.html` con `lang`, `hreflang` y metadatos propios. Código en inglés, textos en español/inglés.

## Reparto de trabajo (orquestación)

Claude es el orquestador: define arquitectura, escribe el esqueleto, integra todo, revisa cada entrega y es el único que hace commits. Los agentes externos trabajan en archivos asignados y nunca tocan `app/`, `server/`, `desktop/`, `android/` ni la biblioteca personal.

| Fase | Quién | Tarea | Salida |
|---|---|---|---|
| 0 | Claude | Andamiaje `site/` (Vite, GSAP, Lenis, i18n, layout, tokens) y contrato de secciones (cada sección = `src/sections/<name>.ts` + `.css` con `mount(root, t)`) | esqueleto que compila |
| 1 | **Gemini** | Investigación de patrones de animación de páginas de producto de Apple (secuencias, timings, easing, pin, escalas tipográficas) traducida a recetas GSAP | `site/notes/motion-research.md` |
| 1 | **Gemini** | Textos ES + EN de todas las secciones a partir de README y docs (tono breve, sin prometer lo que el README marca como no validado) | `src/i18n/*.json` |
| 1 | Claude | Capturas con biblioteca sintética aislada (`OPENFY_DATA_DIR` temporal + `npm run test:audio`; `Openfy.exe --visual-check` con `--data-dir/--state-dir`) | `site/public/shots/` |
| 2 | **Gemini** (2–3 llamadas en paralelo) | Secciones Características, Cómo funciona y Descargas/Guía PWA según el contrato | `src/sections/*` |
| 2 | Claude | Hero con el shader ambiental y la secuencia fijada de dispositivos (lo más delicado) + cliente de releases | `src/sections/hero.ts`, `sequence.ts`, `src/lib/releases.ts` |
| 3 | **Codex** (1 llamada, `--sandbox read-only`) | QA visual: revisa las capturas que Claude genera a 375/768/1440 px, claro/oscuro, ES/EN, y reporta problemas | lista de defectos |
| 3 | **Codex** (1 llamada, `--sandbox read-only`) | Revisión final de rendimiento de animación, accesibilidad y fallos de la lógica de descargas | lista de hallazgos |
| 4 | Claude | Aplicar correcciones, documentar, verificación final | commit en rama |

Presupuesto de Codex: máximo 3 invocaciones cortas en todo el proyecto (QA visual, revisión final y una de reserva). Las capturas se le pasan ya hechas (`-i <png>`), para que no gaste cuota navegando. Si responde con límite de uso, esa tarea pasa a Gemini o a Claude sin reintentar.

Invocación (desde Bash/PowerShell en segundo plano, una por tarea, con el prompt completo en un archivo del scratchpad):

- Gemini: `gemini -p "<prompt>" --approval-mode auto_edit` con cwd `E:\openfy\site` (escritura limitada a los archivos de su tarea; Claude revisa el diff de cada uno).
- Codex: `codex.exe exec --sandbox read-only --cd E:\openfy\site "<prompt>"` usando la ruta del paquete `OpenAI.Codex_*\app\resources\codex.exe`.

## Archivos

- Nuevos: `site/` (`package.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/sections/*`, `src/lib/{releases,i18n,motion}.ts`, `src/i18n/{es,en}.json`, `public/shots`, `public/icons`), `docs/site.md` (español: cómo construir, previsualizar y publicar), `docs/superpowers/specs/2026-11-18-landing-site-design.md` (este diseño).
- Reutilizados (importados o copiados en el build, sin modificarlos): `shared/release-notes.json`, `app/lib/ambient-gl.ts`, `shared/utils/ambient.ts`, `public/icons/*`.
- `.gitignore`: `site/dist`, `site/node_modules`.
- Sin cambio de versión de la app (no se toca `package.json` raíz ni las release notes).

## Verificación

1. `npm --prefix site ci && npm --prefix site run build` sin errores; `npm --prefix site run typecheck`.
2. `npm --prefix site run preview` y revisión en el navegador integrado: escritorio y móvil (375 px), claro/oscuro, ES/EN, `prefers-reduced-motion`, sin scroll horizontal, sin errores de consola, animaciones a 60 fps (Performance).
3. Descargas: los botones resuelven el `.exe` y el `.apk` de la última release real; con la red bloqueada a `api.github.com` caen a `/releases/latest`.
4. Prueba Playwright mínima en `site/tests/` (carga, cambio de idioma, enlaces de descarga con la API simulada).
5. La raíz sigue intacta: `npm test` y `npm run typecheck` pasan como antes.
6. Informes de QA de Gemini y revisión de Codex atendidos o justificados.
