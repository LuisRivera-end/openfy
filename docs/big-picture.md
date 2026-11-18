# Big Picture en escritorio

Windows aplica estas funciones únicamente en su ventana `fullscreen`. La web las activa fuera de PWA y del diseño de teléfono, con puntero principal preciso y hover. El contexto instalado se captura antes de entrar en pantalla completa: pedir fullscreen en una pestaña no la convierte en PWA.

## Reposo

Después de cuatro segundos sin actividad dentro del reproductor se oculta el dock, conservando su espacio. Bajo los metadatos queda una línea informativa con tiempo transcurrido y duración. También ocurre en pausa. Movimiento real, teclado, rueda y pulsaciones recuperan los controles. Arrastrar o navegar por teclado dentro del dock suspende la ocultación. Los cambios automáticos de canción y progreso no cuentan como actividad.

En reposo la portada, los metadatos, las letras y el mini progreso crecen hasta un 20 %. La transición reversible dura 320 ms y aprovecha el espacio inferior; ventanas pequeñas limitan el crecimiento para evitar recortes. En dos columnas la portada crece hacia la derecha, pero las letras conservan la separación del modo completo: se desplazan hacia el margen exterior vacío, sin acercarse a menos de 48 px (`sideMargin`) del borde de la ventana, en lugar de estrecharse. Los botones superiores mantienen su geometría; la tarjeta siguiente pasa a su versión de esquina (ver «A continuación»). Web usa FLIP sobre elementos separados de los slots del dock; Windows conserva esos slots y presenta el contenido en una capa independiente con transiciones de composición. El movimiento reducido y los efectos desactivados aplican directamente el estado final.

En dos columnas, el borde superior de las letras está al 20 % de la altura de la portada desde su borde superior, en ambos estados. La profundidad es la misma en los dos bordes: los versos se desvanecen en una franja del 18 % del viewport de letras (`lyricsEdge`), arriba igual que abajo. La web usa una máscara simétrica en `.has-depth`; Windows atenúa cada verso según su distancia al borde. Se descartó el desenfoque superior: en Windows el backdrop no puede leer el fondo Direct3D (`SwapChainPanel`) y su copia desenfocada no se veía bien. El verso activo permanece fuera de esa franja. El diseño apilado conserva su orden vertical.

El borde inferior deja 20 px sobre el dock en modo completo y 24 px respecto a la ventana en compacto. Al anunciar la siguiente canción se recorta únicamente ese borde, dejando 16 px antes de la tarjeta. Los cambios de geometría conservan el seguimiento y el desplazamiento manual; una letra nueva se sincroniza antes de revelarse.

Perder el foco al usar otro monitor mantiene el temporizador activo mientras la ventana siga visible. Salir con el puntero libera la retención del foco de teclado; una pulsación de ratón ya liberada fuera se reconcilia con el estado de botones de Windows. Volver a activar la ventana no cuenta como movimiento ni reinicia el reloj.

Las letras nuevas se colocan sin animación antes de revelarse. El desplazamiento suave se reserva para el seguimiento posterior dentro de la misma canción; durante la expansión se conserva la letra saliente sin aplicarle la posición de la nueva.

## Sin letra sincronizada

La columna de letra solo aparece con letra sincronizada. Una letra sin tiempos no tiene nada que seguir y quedaba como un bloque fijo, así que con `plain`, `instrumental`, `not_found` o una carga fallida Big Picture usa el diseño portada: portada, título, artistas y el mismo dock (posición a todo el ancho, transporte, dispositivo y volumen). Mientras la letra se está cargando se conserva el diseño en pantalla, para que un cambio de canción no salte de un diseño a otro; al abrir sin respuesta todavía se parte del dividido y la primera respuesta se aplica sin animación; los cambios posteriores se deslizan. La regla está en `bigPictureLyrics` (`shared/utils/immersive.ts`) e `Immersive.BigPictureLyrics`, fijada por `lyricsCases` en `tests/fixtures/immersive-layout-contract.json`. Durante una expansión retenida el diseño sigue a la escena en pantalla y cambia al terminar. El reproductor ampliado del teléfono no cambia.

La portada centrada usa las mismas filas que el dividido y el mismo tamaño de portada, de modo que el dock no se mueve. Al desaparecer la columna, la letra se desvanece en 250 ms mientras la portada y los metadatos se desplazan al centro en 600 ms (`layoutMs`, con la curva del reposo) y el oscurecido del fondo ambiental tras la letra se retira en el mismo tiempo. Al volver una letra sincronizada el recorrido es el inverso: la letra se coloca y sincroniza sin animación y aparece cuando la portada ya ha llegado a su columna. Ya centrada, la portada queda quieta: el movimiento lo dan el fondo ambiental y la portada animada, que se mantiene. El reposo crece y recentra igual que en el dividido. El movimiento reducido y los efectos desactivados aplican el estado final directamente.

## A continuación

La tarjeta anticipa los últimos diez segundos según la posición del medio, no según un reloj independiente. Muestra la siguiente aparición de la cola efectiva, con su portada, artista, duración y cuenta atrás. No aparece con repetición de una canción, al volver a la misma entrada o al terminar una cola sin repetición. En pausa o buffering conserva el estado real. Buscar hacia atrás fuera de ese intervalo la retira.

Tiene dos versiones con los mismos datos. Con los controles visibles se coloca a la derecha del contenido, 136 px por encima del dock, con 420 × 120 px. En el modo compacto (reposo) se ancla a la esquina inferior derecha, a 32 px de ambos bordes: es la misma maqueta escalada 4/3 (160 px de alto, portada de 107 px) y más alargada, con el 38 % del ancho de la ventana entre 420 y 640 px. Al entrar o salir del reposo con la tarjeta visible se desplaza entre ambas posiciones en 320 ms, fotograma a fotograma, para que la región del fondo ambiental la siga; con movimiento reducido o efectos desactivados cambia directamente. Las letras terminan 16 px antes de la tarjeta en ambas versiones. La regla está en `nextCardBounds` (`shared/utils/immersive.ts`) e `Immersive.NextCardBounds`, fijada por `cards` en `tests/fixtures/immersive-layout-contract.json`.

El shader ambiental comparte su fase y bucle de render con la tarjeta; usa una tercera textura de portada y una región redondeada. Al confirmarse el comienzo del tema anunciado, la región se expande durante 1,2 segundos desde la versión de la tarjeta que esté en pantalla y la portada viaja hasta su posición principal. Promover la textura precargada evita un segundo fundido al finalizar. El audio sigue su avance habitual. Las solicitudes tardías se descartan por generación e identidad de entrada.

La web dispone de un fallback CSS. Windows conserva una paleta de respaldo si falla el renderizador. El movimiento reducido y la preferencia de efectos desactivada evitan la expansión. Cerrar cancela timers y animaciones; reabrir restaura los controles completos.

Los tiempos están en `BIG_PICTURE` (`shared/utils/immersive.ts`) y `Immersive` (`desktop/Openfy.Core/Immersive.cs`). Mantenerlos iguales.

## Portada animada

Cuando el álbum tiene motion art, su vídeo en bucle sustituye a la portada en el mismo hueco. Sigue a la escena en pantalla, no al reproductor: durante una expansión retenida se conserva el de la canción saliente. La tarjeta, la portada que viaja y el fondo ambiental usan la imagen fija. Origen, almacenamiento y límites en `docs/motion-art.md`.

## Verificación

Las pruebas `big-picture.spec.ts` cubren la portada centrada sin letra sincronizada, reposo, teclado/arrastre, anuncio, búsqueda, repetición, cambio durante expansión, fullscreen, PWA y movimiento reducido. Las regresiones de `immersive.spec.ts` y `mobile.spec.ts` comprueban los diseños existentes.

La comprobación nativa se ejecuta con datos y estado aislados:

```powershell
Openfy.exe --workspace E:\openfy --state-dir <estado-aislado> --data-dir <datos-aislados> --port <puerto-libre> --visual-players <capturas> --visual-fixtures <audios-de-prueba> --big-picture-check
```

Genera `visual-players.json` y capturas de los estados completo, compacto (con canciones sin letra sincronizada, `windows-cover*.png` y la portada centrada), anuncio (con controles y en la esquina compacta), expansión y siguiente tema. Verifica también continuidad de audio, reapertura y efectos desactivados.

Añadir `--big-picture-followup` y usar los AAC de `scripts/create-big-picture-fixtures.mjs` comprueba letras largas, salto manual y con tarjeta, foco en otra ventana, salida del puntero y liberación de ratón perdida.

Para aplicar a Windows instalado, seguir `docs/performance-and-builds.md` y usar `scripts/package-desktop.ps1`. Compilar `.output` con Nuxt solamente no actualiza el backend de la instalación.

Verificación del 16 de noviembre de 2026: 48 pruebas de navegador aprobadas (20 omitidas por plataforma), 29 pruebas unitarias web, 20 pruebas de contratos/letras .NET y la comprobación nativa con `--big-picture-followup`. Se revisaron capturas a 1280×800, 1538×750 y 1920×1080, además del desenfoque del compositor en una ventana real de Windows. La instalación se actualizó a **0.5.0+1794823775**, confirmada por `/api/status`. Evidencias en `output/big-picture-design/verification.json` y el informe de arranque del empaquetado en `output/desktop/reports`.

Verificación del 16 de noviembre de 2026 (desenfoque y separación compacta): 220 pruebas unitarias web, 99 pruebas .NET, `big-picture.spec.ts` e `immersive.spec.ts` (18 aprobadas, 12 omitidas por plataforma) y la comprobación nativa con `--big-picture-followup`, que ahora exige la separación compacta y la copia de los versos. Después se sustituyó el desenfoque superior por el mismo desvanecimiento del borde inferior; la comprobación nativa exige que los versos fuera de cualquiera de los bordes queden transparentes.

Verificación del 16 de noviembre de 2026 (tarjeta de esquina en compacto): 221 pruebas unitarias web (con el contrato `cards`), 99 pruebas .NET, `big-picture.spec.ts` e `immersive.spec.ts` en Chromium (15 aprobadas), con capturas `web-next-card-compact-*.png` a 1280×800, 1538×750 y 1920×1080. La comprobación nativa con `--big-picture-followup` aprobó la geometría de esquina, el regreso sobre el dock y el margen de las letras (`output/big-picture-corner-check`). Repetida tras retirar la copia desenfocada de los versos (`output/big-picture-corner-check-2`), las capturas vuelven a medir 1920×1080 y muestran la región del fondo ambiental alineada con la tarjeta en ambas versiones.

Corrección de la barra de posición (16 de noviembre de 2026): en Windows, arrastrar la barra o moverla con el teclado escribía su valor localmente y descartaba el enlace OneWay con `Position`, de modo que la barra y su seguimiento quedaban congelados tras la primera búsqueda. `PlayerControls.Seek` sigue ahora el modelo a mano, salvo mientras se elige la posición o se completa esa búsqueda. La comprobación nativa reproduce el caso (5,0 s frente a 7,0 s antes de la corrección) y exige que la barra siga la reproducción después de buscar.

Portada centrada sin letra sincronizada (16 de noviembre de 2026): 222 pruebas unitarias web (con `lyricsCases`), 99 pruebas .NET, `big-picture.spec.ts`, `immersive.spec.ts`, `lyrics.spec.ts`, `motion-art.spec.ts` y `mobile.spec.ts` en Chromium (40 aprobadas, 7 omitidas) y `immersive.spec.ts`, `mobile.spec.ts` y `big-picture.spec.ts` en WebKit móvil (10 aprobadas, 20 omitidas por plataforma). Las nuevas pruebas cubren `plain`, `instrumental`, `not_found` y error (portada centrada, sin región de letras, dock visible y reposo recentrado), el deslizamiento de 600 ms con el dock inmóvil, la carga pendiente que conserva el diseño, el movimiento reducido y el botón de letra oculto en Big Picture estrecho. Nativo aislado: `--big-picture-check` con canciones sin letra (diseño `cover`, portada centrada y columna de letras oculta en completo y compacto), `--big-picture-check --big-picture-followup` con letras sincronizadas (`split`, sin regresiones) y `--visual-players` con ambas (portada ancha y estrecha, dividido, apilado, mini y widget). El deslizamiento nativo entre diseños durante una sesión no tiene comprobación automática.
