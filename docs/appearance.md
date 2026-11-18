# Apariencia única de Openfy

Windows y web/PWA utilizan la apariencia que antes se activaba mediante «Nuevo diseño». El selector, su estado y las ramas de presentación anterior se han retirado. El movimiento ambiental mantiene su preferencia independiente.

## Presentación

La web integra los estilos en `app/assets/main.css`. El contexto incondicional `:root` conserva la especificidad que tenían los estilos del diseño nuevo frente a componentes y reglas adaptables. Se eliminaron las declaraciones sustituidas y los bloques sin uso del antiguo inicio. Los cambios de distribución de 700 y 760 px se mantienen.

En Windows, `Appearance.Attach` y `Appearance.Apply` aplican siempre la presentación actual, también al cargar ventanas y renovar contenido. Sus pasos son idempotentes; ya no almacenan valores originales ni mantienen eventos de cambio de diseño. Los títulos de artista con `Tag="display"` y las portadas `home-artwork` conservan sus excepciones de tamaño y geometría.

## Preferencias y sesiones

- La web elimina únicamente `openfy-new-design`, con manejo de errores de almacenamiento. `openfy-motion`, los filtros, IndexedDB y las cachés se conservan.
- Windows acepta los archivos de ajustes existentes ignorando el campo retirado. El siguiente guardado omite ese campo y conserva efectos, ventanas, posiciones, filtros y bloqueo del widget.
- Ambas aplicaciones aceptan sesiones antiguas e ignoran `preferences.newDesign`. Las exportaciones mantienen el sobre de versión 1 y los formatos de reproducción existentes; `preferences` contiene únicamente `effects`.
- Las migraciones de colas antiguas y de almacenamiento siguen disponibles. La retirada afecta a la presentación, sin migrar la biblioteca ni borrar descargas.

## Comprobación

Los resultados de esta revisión se guardan en `output/legacy-removal`. `source-before.zip` es la copia del código anterior a la retirada.

Resultado final: **139 pruebas TypeScript, 26 de Core, 9 de audio/backend y 108 E2E pasaron**, sin omisiones ni reintentos en la ejecución E2E final. El chequeo de tipos y las compilaciones web y Windows pasaron; Windows compiló sin advertencias. El smoke nativo y la comprobación de arranque del paquete publicado también pasaron. El resumen legible por herramientas está en `output/legacy-removal/validation-summary.json`.

- Pruebas de migración: preferencia ausente, falsa o verdadera; almacenamiento de apariencia no disponible; importación y exportación con selección, posición, volumen, repetición, aleatorio, duplicados y orden original.
- Intercambio real: una exportación web se importa en Windows; una exportación de Windows se importa y exporta en web y vuelve a Windows. Se comparan reproducción y efectos.
- Comparación web: 112 escenarios en Chromium y WebKit, con anchos de 390, 700, 701, 760, 761, 960 y 1440 px; biblioteca, ajustes, búsqueda, artista, playlist, reproductor ampliado, cola y diálogo. El informe `web-style-differences.json` está vacío. La desaparición de la fila de diseño es el cambio intencionado de Ajustes.
- Revisión nativa: 18 capturas, con biblioteca aislada y ventanas de 1360, 960 y 780 px. No se exige igualdad de píxeles entre ejecuciones: el historial reciente y la primera disposición de listas pueden actualizarse durante el recorrido.
- El smoke nativo comprueba idempotencia, compatibilidad de sesiones, audio WASAPI, recuperación de Node, seek pausado, efectos en dos monitores, límite de FPS, parada al pausar y 13 ciclos de reapertura. Comprueba además las regiones nativas de arrastre, la invocación del candado de WinUI, el bloqueo de tamaño y la conservación de posición tras mover y reabrir mini y widget. Estas aserciones no sustituyen una prueba manual del gesto físico de arrastre.
- La batería web conserva sus pruebas de actualización coordinada entre pestañas, descargas y reproducción offline. Playwright tiene únicamente los proyectos `chromium` y `mobile-webkit`; `OPENFY_TEST_PORT` permite aislar el puerto sin reutilizar otro servidor.

Los datos, estados y canales de actualización de la revisión son independientes de la instalación personal. El empaquetado utiliza `-FeedRoot E:\openfy\output\legacy-removal\feed` y exige que la aplicación publicada abra la ventana y conecte el backend desde otra carpeta.

El instalador verificado es `output/desktop/Openfy-Setup-0.3.0-1794708881-x64.exe`. Su SHA-256 figura en `output/legacy-removal/feed/latest.json`. El canal habitual y la instalación personal no se actualizaron durante esta revisión.
