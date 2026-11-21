# Fidelidad visual de Openfy nativo

La búsqueda del 16 de noviembre de 2026 sigue [Búsqueda integrada](search-design.md): campo superior editable, cuatro categorías y un viewport virtualizado por vista. Los avisos generales se comparten con el resto de las páginas para permanecer visibles al buscar.

La actualización del inicio del 14 de noviembre de 2026 se detalla en [Inicio centrado en la música](home-design.md). La nueva jerarquía sustituye las referencias al héroe de bienvenida y a las métricas del inicio de la revisión anterior.

La referencia es la aplicación web existente (`app/assets/main.css`), no una nueva identidad.

## Plan de diseño

- Color: fondo `#09090B`, panel `#18181B`, texto `#F4F4F5`, secundario `#A1A1AA`, marca `#1ED760`, divisor `#FFFFFF0D`.
- Tipografía: Segoe UI Variable; texto 13–14, metadatos 11–12, sección 19–22, título 40. Contenido alineado a la izquierda, títulos densos y texto secundario discreto.
- La barra lateral ocupa toda la altura y mide 244 DIP (210 en ventanas estrechas). La barra superior mide 82 DIP y el contenido usa 36 DIP de margen lateral en el ancho habitual. La cápsula del reproductor flota centrada en la columna principal, mide hasta 760 × 64 DIP, tiene radio 32 y usa una portada de 40 DIP. El contenido deja 96 DIP al pie para que la última fila quede al alcance.
- La navegación y la cápsula usan acrílico nativo con el tinte de la página y un color de respaldo. La barra lateral comparte el fondo con el panel principal y tiene un borde derecho de un píxel.
- Iconografía: los mismos trazos Lucide de la web, como geometrías nativas, con etiquetas accesibles y foco visible.

```text
+------------------+-----------------------------------------+
| openfy.          | buscar                 importar  ajustes |
| Inicio           |                                         |
| Buscar           | saludo / título                         |
| Tu biblioteca    | hero con portada / colección             |
|------------------|                                         |
| Tu colección   + | álbumes / artistas / lista de canciones  |
| Favoritas        |                                         |
| Playlists        |                                         |
| Ajustes / estado |     (portada · transporte · volumen)   |
+------------------+-----------------------------------------+
```

## Revisión contra el encargo

Se conserva la paleta oscura y verde porque pertenece a Openfy. Se evita aplicar cristal a cada tarjeta: en web las portadas y listas descansan sobre el panel principal y las transparencias se reservan al marco. Inicio, héroes, grillas de portadas y navegación se derivan de la web; no se añaden métricas ni decoración ajenas al producto. Las funciones específicas de Windows (mini, widget, efectos y diagnóstico) siguen disponibles con el mismo lenguaje visual.

El reproductor ampliado sigue `ImmersivePlayer.vue` y `main.css`: diseños portada, dividido y apilado elegidos por la misma regla (`tests/fixtures/immersive-layout-contract.json`, que fija también cuándo Big Picture muestra la columna de letra: solo con letra sincronizada), la letra en blanco con opacidad según la distancia al verso activo, y la misma iluminación de portada (`tests/fixtures/ambient-contract.json`). La web no tiene mini ni widget; su versión de la letra compacta solo existe en Windows.

## Validación

Verificado el 13 de noviembre de 2026:

- Compilación Release de WinUI: sin errores ni advertencias.
- 16 pruebas de Core y 8 de audio/backend: correctas.
- 20 capturas de componentes WinUI mediante `RenderTargetBitmap`, con biblioteca y estado aislados: Inicio vacío/poblado, canciones/álbumes/artistas, filtro vacío, álbum local, favoritas, playlist, cola, letras, búsqueda, ajustes y ventanas de 1360, 960 y 780 px.
- Búsqueda real de YouTube Music, navegación a artista/álbum y restauración de resultados: correctas. La revisión comprueba por separado el desplazamiento de la página y el de la lista virtualizada.
- Smoke nativo: audio WASAPI, seek pausado, letras sincronizadas, recuperación de Node, Direct3D en dos monitores, límite de 24 FPS, detención al pausar y 13 ciclos de reapertura con las mismas tres ventanas: correcto.
- Referencia visual contrastada con el CSS/componentes y las capturas web existentes en `output/playwright/chromium-home.png` y `chromium-library.png`. No se afirma equivalencia pixel a pixel: los controles y el rasterizado siguen siendo nativos.

El navegador integrado no estaba disponible y el control de Edge se detuvo por verificación de URL. Las capturas nativas se obtienen desde el propio árbol XAML, sin controlar ni capturar otras aplicaciones. Las superficies Direct3D se comprueban mediante el smoke; `RenderTargetBitmap` no captura su contenido.

## Repetir la revisión

Usa rutas nuevas para cada ejecución, para mantener separada la biblioteca sintética:

```powershell
node scripts/create-design-fixtures.mjs output/native-design-qa/fixtures
& "$env:LOCALAPPDATA\Openfy\development\dotnet\dotnet.exe" build desktop/Openfy.Windows -c Release
$exe = 'desktop/Openfy.Windows/bin/Release/net10.0-windows10.0.26100.0/win-x64/Openfy.exe'
& $exe --workspace E:\openfy --data-dir E:\openfy\output\review\data --state-dir E:\openfy\output\review\state --port 4197 --visual-check E:\openfy\output\review\screenshots --visual-fixtures E:\openfy\output\native-design-qa\fixtures --visual-online
```

`--visual-online` añade las tres vistas reales del catálogo; omítelo para revisar solo la biblioteca local. El proceso termina por sí mismo y deja `visual-check.json` junto a los PNG. El informe de smoke está en `output/native-design-qa/smoke-state/native-smoke.json`.

Los resultados visuales finales están en `output/native-design-qa/release`. La comprobación posterior de restauración está en `output/native-design-qa/restore-2/visual-check.json`: recuperó exactamente 200 px en la lista y 180 px en la página. Para repetir únicamente ese recorrido sobre una biblioteca de prueba ya poblada, usa también `--visual-catalog-only`.

El paquete se genera con `scripts/package-desktop.ps1`. Su nombre y SHA-256 figuran en `output/desktop/openfy-update.json`. El canal local anuncia la compilación después de verificar la copia.

## Corrección de arranque de la publicación

La primera publicación de estos cambios omitía `App.xbf` y `Openfy.pri`. El ejecutable de desarrollo arrancaba correctamente, pero el publicado terminaba en `Microsoft.UI.Xaml.dll` con `0xc000027b` antes de mostrar la ventana. Se reprodujo con un perfil vacío, por lo que el fallo no dependía de la biblioteca ni de las preferencias del usuario.

El proyecto incluye ahora ambos recursos explícitamente en `ResolvedFileToPublish`. El empaquetado comprueba su presencia y ejecuta la publicación desde otra carpeta, con datos y estado de prueba aislados. `--startup-check` exige que se cree la ventana y conecte el backend antes de aceptar el paquete; el informe queda en `output/publication-qa/startup.json`. Los errores de inicialización XAML se registran también antes de completar el constructor de la aplicación.

Se regeneró el instalador y se actualizó la instalación existente conservando datos y preferencias. La prueba desde `%TEMP%` con el ejecutable instalado también pasó (`output/startup-qa/installed.json`). Después se abrió normalmente con el perfil habitual y se comprobó que la ventana y el backend siguieran activos. La verificación de instalación rechaza ahora códigos de salida de error y elimina informes antiguos antes de ejecutar los smoke, para evitar aceptar resultados de una ejecución anterior.

## Pulido visual y perfiles de artista (14 de noviembre de 2026)

Cambios aplicados por igual en la PWA (ambas apariencias) y en la aplicación nativa:

- Tarjetas: todas las del inicio usan el mismo hover de caja (padding 8, radio 9) que el catálogo. El radio de 24 heredado de `Ui.Button` recortaba el subtítulo y las esquinas de la portada.
- Tarjeta destacada: la portada se muestra completa y cuadrada; la franja inferior continúa en el color dominante. Ver [Inicio centrado en la música](home-design.md).
- Portadas: la decodificación nativa calcula el ancho que necesita `UniformToFill` según la caja y la proporción de la fuente; la web mide el lado mayor. Las miniaturas de `i.ytimg.com` se piden en `maxresdefault`, se recortan las franjas negras y se cuadran. Los banners de artista se sirven hasta 2048 px. La caché de portadas pasa a la versión 2 y regenera cada entrada al pedirla, conservando la anterior sin conexión.
- Buscador: sección «Álbumes» entre Artistas y Canciones (`/api/music/search?type=album`).
- El perfil de artista muestra el banner, el nombre, Reproducir, Aleatorio, las canciones populares, la discografía y «Fans también escuchan». Cuando hay una biografía, el botón de información abre «Acerca de» con el retrato y el texto completo. Desde 700 DIP de ancho útil, «Último lanzamiento» aparece junto a las canciones populares con portada de hasta 160 DIP. En anchos menores se apila en una fila con portada de 76 DIP. El contrato `ArtistProfile` fija `banner` y `similar` en `tests/fixtures/desktop-catalog-contract.json`.
- La cápsula del reproductor coloca el transporte encima de una pista de 3 DIP y abre el volumen en un desplegable. En columnas de menos de 900 DIP oculta Aleatorio, Repetición y los tiempos. Al iniciar con la cola vacía solo muestra el marcador de portada y Reproducir deshabilitado.
- Filas icono + texto: `Ui.Row` centra verticalmente a todos sus hijos, también a los añadidos después.
- «Ajustes» comparte el diseño de los destinos de la barra lateral. Las filas de navegación miden 36 DIP, con iconos de 20 DIP y texto regular de 14 DIP. El destino activo usa la superficie de la página y radio 8.

Verificado:

- Vitest: 139 pruebas correctas. `nuxt typecheck` sin errores. `npm run build` correcto.
- Playwright: 200 pruebas correctas en `chromium`, `chromium-new`, `mobile-webkit` y `mobile-webkit-new`. `home.spec.ts` filtra ahora las estadísticas compartidas del servidor de pruebas para no depender del orden de los specs.
- xUnit `Openfy.Tests`: 23 correctas. Compilación Release de WinUI sin errores ni advertencias.
- `--visual-check --visual-online` con biblioteca y estado aislados: correcto. Capturas en `output/review-2026-11-14c/screenshots` (artista con banner, búsqueda con álbumes, ajustes seleccionados, tiempos alineados con la pista).

Pendiente: revisión en iPhone físico; las ejecuciones WebKit emuladas no la sustituyen. `Openfy.Audio.Tests` no se ejecutó en esta revisión.

## Identidad de artista (20 de noviembre de 2026)

El lavado del artista sigue al desplazamiento y acaba en el fondo de la aplicación. El tono profundo empieza en «Fans también escuchan» cuando hay artistas similares. El banner y el vídeo de cabecera se extienden detrás de la barra lateral. La paleta de `ArtistThemes.cs` también llega a la barra superior y al reproductor, y se reutiliza en «Resultado más relevante». La comprobación `--visual-check <dir> --visual-artists-only --visual-artists "Bad Bunny;Lady Gaga;Rauw Alejandro"` captura la cabecera y el recorrido con datos reales, además del diálogo y el lanzamiento compacto cuando están disponibles. Las comprobaciones apagan el vídeo.

## Páginas de álbum (20 de noviembre de 2026)

El tinte de álbum usa OKLab con luminosidad máxima de 0,30 y cromaticidad máxima de 0,125. El texto secundario se aclara hasta alcanzar un contraste mínimo de 4,5:1 con la superficie. `AlbumTint` comparte el contrato `tests/fixtures/album-tint-contract.json` con la web. El fondo, la superficie, el texto secundario y el borde se propagan por el marco con una transición sRGB de 240 ms. Con movimiento reducido el cambio es inmediato. La portada mide 224 DIP (168 entre 560 y 719), la descripción de tres líneas se amplía con «Más» y `LoopingVideo` muestra el vídeo en la portada. [Diseño de páginas de álbum](superpowers/specs/2026-11-19-album-pages-design.md)
