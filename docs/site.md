# Página principal (sitio público)

`site/` contiene la página informativa y de descargas de Openfy. Es un sitio estático independiente (Vite + TypeScript, sin framework) con GSAP (ScrollTrigger y SplitText) y Lenis para el movimiento. Tiene su propio `package.json`, así que no participa en `npm run build`, `npm test` ni `npm run typecheck` de la raíz.

## Comandos

```powershell
npm --prefix site ci
npm --prefix site run dev        # http://127.0.0.1:5180
npm --prefix site run typecheck
npm --prefix site run build      # genera site/dist
npm --prefix site run preview    # sirve site/dist en http://127.0.0.1:5181
npm --prefix site test           # Playwright (requiere build; usa la API de GitHub simulada)
node site/tests/capture.mjs <dir> # capturas de revisión a 375/768/1440 px (con `vite preview` en 5181)
```

Las pruebas cubren ambos idiomas, la resolución de descargas (incluida una release solo de Android), la caída a `/releases/latest`, movimiento reducido, ausencia de scroll horizontal y errores de consola, y que al cambiar de tamaño o de preferencia de movimiento a mitad de la secuencia fijada no se pierda la posición de lectura.

`site/dist` es la salida publicable: rutas relativas (`base: './'`), así que funciona en GitHub Pages, en una subcarpeta o en cualquier hosting estático. Por ahora no se publica en ningún sitio.

## Idiomas

`/` es español y `/en/` inglés. Cada idioma tiene su propio HTML (título, descripción y `hreflang`) y comparte el mismo script, que toma el idioma de `<html lang>`. Todos los textos visibles están en `site/src/i18n/es.json` y `en.json`, con las mismas claves. Las «Novedades» se leen de `shared/release-notes.json` y se muestran en español en ambos idiomas, con un aviso en inglés.

## Descargas

`site/src/lib/releases.ts` consulta `GET /repos/LuisRivera-end/openfy/releases/latest` y busca `Openfy-Setup-*-x64.exe`, `Openfy-*-release.apk` y `SHA256SUMS.txt`. Si GitHub no responde en 6 s, los botones conservan el enlace a `/releases/latest`. La versión web/PWA no es un enlace: es una guía, porque cada persona sirve su propia biblioteca desde su PC con Tailscale.

## Estructura

- `src/main.ts` monta las secciones en orden y arranca el movimiento.
- `src/types.ts` define el contrato de sección: `render(t)` devuelve el HTML; `animate(root, ctx)` crea todo el movimiento dentro de `ctx.mm.add(CONDITIONS, …)`, de modo que se revierte al cambiar de tamaño o de preferencia de movimiento.
- `src/lib/devices.ts` dibuja el teléfono y la ventana de Big Picture en HTML/CSS. `src/lib/art.ts` genera portadas y álbumes ficticios: la página no muestra música real ni portadas de terceros.
- El fondo del inicio reutiliza el renderizador ambiental de la app (`app/lib/ambient-gl.ts` y `shared/utils/ambient.ts`) con paletas de las portadas generadas; sin WebGL2 usa degradados CSS.

## Movimiento y accesibilidad

- Con `prefers-reduced-motion: reduce` no hay desplazamiento suave, secciones fijadas ni animaciones ligadas al scroll; todo el contenido se muestra completo.
- En pantallas de menos de 768 px no se fija ninguna sección: cada paso de la secuencia muestra su propia pantalla debajo del texto.
- Solo se animan `transform` y `opacity`. El fondo WebGL se detiene cuando el inicio sale de pantalla o la pestaña se oculta.
- Openfy es oscuro por identidad; las secciones de contenido usan una paleta clara si el sistema la prefiere. Inicio, la secuencia, letras y Big Picture permanecen oscuros.

## Agentes que participaron

La planificación, el esqueleto, el inicio, la secuencia fijada, Novedades, la integración y la verificación son de Claude. Gemini (Antigravity CLI, `agy`) redactó los textos ES/EN —revisados contra el README— y la investigación de movimiento (`site/notes/motion-research.md`), y construyó las secciones de biblioteca, letras, descargas sin conexión, Big Picture, privacidad, arquitectura y descargas. Codex hizo la revisión visual y la revisión final de código. `gemini` (Gemini CLI) ya no autentica con la cuenta personal: Google exige migrar a Antigravity.
