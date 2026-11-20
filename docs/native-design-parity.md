# Fidelidad visual de Openfy nativo

La búsqueda del 16 de noviembre de 2026 sigue [Búsqueda integrada](search-design.md): campo superior editable, cuatro categorías y un viewport virtualizado por vista. Los avisos generales se comparten con el resto de las páginas para permanecer visibles al buscar.

La actualización del inicio del 14 de noviembre de 2026 se detalla en [Inicio centrado en la música](home-design.md). La nueva jerarquía sustituye las referencias al héroe de bienvenida y a las métricas del inicio de la revisión anterior.

La referencia es la aplicación web existente (`app/assets/main.css`), no una nueva identidad.

## Plan de diseño

- Color: fondo `#09090B`, panel `#18181B`, texto `#F4F4F5`, secundario `#A1A1AA`, marca `#1ED760`, divisor `#FFFFFF0D`.
- Tipografía: Segoe UI Variable; texto 13–14, metadatos 11–12, sección 19–22, título 40. Contenido alineado a la izquierda, títulos densos y texto secundario discreto.
- Geometría: margen y separación 9, sidebar 244 (210 en ventanas estrechas), radio de panel 12, topbar 82, contenido 36 (24/48 según ancho), reproductor 86 con portada 53.
- Cristal: acrílico nativo en navegación, reproductor y paneles superpuestos; contenido oscuro estable para mantener legibilidad. Respaldo sólido cuando Windows desactiva transparencias.
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
| Ajustes / estado |                                         |
+------------------+-----------------------------------------+
| portada / título | transporte + progreso | letras / volumen |
+------------------------------------------------------------+
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
- Perfil de artista: banner a todo el ancho (o retrato sobre su propio color), nombre en tipografía de display, Reproducir y Aleatorio, «Canciones populares», «Último lanzamiento», discografía, «Acerca de» y «Fans también escuchan». El contrato `ArtistProfile` añade `banner` y `similar`, fijados en `tests/fixtures/desktop-catalog-contract.json`.
- Reproductor: el slider nativo mide exactamente la altura de su plantilla (32) y los tiempos usan límites de línea ajustados y dígitos tabulares, de modo que comparten la línea central de la pista. En la web, dígitos tabulares de ancho fijo.
- Filas icono + texto: `Ui.Row` centra verticalmente a todos sus hijos, también a los añadidos después.
- Sidebar: «Ajustes» es un destino más (caja de 48, radio 7, estado seleccionado); el hover es más tenue que la selección.

Verificado:

- Vitest: 139 pruebas correctas. `nuxt typecheck` sin errores. `npm run build` correcto.
- Playwright: 200 pruebas correctas en `chromium`, `chromium-new`, `mobile-webkit` y `mobile-webkit-new`. `home.spec.ts` filtra ahora las estadísticas compartidas del servidor de pruebas para no depender del orden de los specs.
- xUnit `Openfy.Tests`: 23 correctas. Compilación Release de WinUI sin errores ni advertencias.
- `--visual-check --visual-online` con biblioteca y estado aislados: correcto. Capturas en `output/review-2026-11-14c/screenshots` (artista con banner, búsqueda con álbumes, ajustes seleccionados, tiempos alineados con la pista).

Pendiente: revisión en iPhone físico; las ejecuciones WebKit emuladas no la sustituyen. `Openfy.Audio.Tests` no se ejecutó en esta revisión.

## Identidad de artista (20 de noviembre de 2026)

Windows replica la página de artista de la web: `MainWindow.Artist.cs` pinta un lavado detrás de todo el panel (barra superior incluida) que sigue al desplazamiento por secciones, y la cabecera ocupa todo el ancho del panel con el banner o el vídeo (`LoopingVideo.cs`) fundidos en `base`. `ArtistThemes.cs` muestrea la portada preparada a 16 × 16 con `BitmapDecoder` y guarda la paleta por artista durante la sesión, para que «Resultado más relevante» (`MainWindow.SearchFeatured.cs`) use los mismos colores. La comprobación `--visual-check <dir> --visual-artists-only --visual-artists "Bad Bunny;Lady Gaga;Rauw Alejandro"` captura búsqueda, cabecera, mitad y final de cada artista con datos reales; las comprobaciones apagan el vídeo.
