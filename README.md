# Planos — app móvil para levantar planos con cámara o GPS

Aplicación web progresiva (PWA) que se instala en el teléfono y permite dibujar
planos de habitaciones o terrenos usando los sensores del dispositivo.
No necesita compilación ni dependencias: es HTML, CSS y JavaScript puro.

## Modos de captura

### 📷 Con cámara (interiores)

Tiene dos formas de medir, que se eligen arriba de los botones:

**🚶 Caminando (recomendado)**: el plano sigue tu recorrido.
1. Ve a una esquina, apunta la cruz al punto donde la esquina toca el suelo y pulsa **Marcar esquina**.
2. Camina junto a la pared hasta la siguiente esquina con el teléfono hacia delante:
   el acelerómetro cuenta los pasos y el giroscopio da la dirección.
3. Repite en cada esquina. Al volver a la primera, márcala otra vez y pulsa **Terminar**:
   la app cierra el recorrido y reparte el error acumulado.

Al apuntar a cada esquina, la posición exacta se corrige con la cámara, así que no hace falta
pegarse a la pared. Si no apuntas al suelo, la esquina se marca donde estás.

**📍 Desde un punto**: te quedas quieto donde veas todas las esquinas, solo giras y apuntas al pie
de cada una. La distancia se calcula como `altura / tan(ángulo hacia abajo)`.

**🎥 Video**: graba un video mientras recorres la habitación. La app guarda, junto con cada
fotograma, tu posición (pasos + rumbo) y la orientación exacta del teléfono. Al detener la grabación
se abre la pantalla de revisión:
- **Automático**: el plano sale solo del recorrido; cada giro es una esquina y las paredes se
  colocan a ~40 cm de tu camino.
- **Tocando el video**: pausa en cada esquina (los botones *Giro 1, Giro 2…* saltan a los
  momentos en que giraste) y toca el punto donde la esquina toca el suelo. La app lanza un rayo
  desde la cámara por ese píxel hasta el suelo y obtiene su posición exacta.

El video solo se usa dentro de la app y se descarta al salir de la revisión; el plano queda guardado.

Con **Esquinas a 90°** activado, los lados que casi forman ángulo recto se enderezan.
El largo de paso (0,70 m por defecto) se calibra solo: en el editor, usa **Corregir medida** en una
pared medida con cinta métrica y el paso se ajusta para las siguientes mediciones.

### 🛰️ Con GPS (exteriores / terrenos)
- **Marcar punto**: quédate quieto en un vértice; la app promedia varias lecturas
  durante unos segundos (ponderadas por precisión) y añade el punto.
- **Grabar**: camina por el borde; se añade un punto cada ~2 m si la precisión es buena.

La precisión típica de un teléfono es de 3–10 m, así que el modo GPS sirve para terrenos
y parcelas, no para habitaciones. Los planos GPS se pueden exportar a **GeoJSON**.

### ✏️ Manual
Toca el plano para añadir vértices.

## Editor
- Arrastra los vértices para moverlos; pellizca para hacer zoom y arrastra para desplazarte.
- Toca un vértice para seleccionarlo: **Borrar vértice** o **Corregir medida**
  (escribes la medida real de ese lado, medida con una cinta métrica, y todo el plano se reescala;
  sirve para compensar errores de altura en el modo cámara).
- **Abrir/cerrar** cambia entre polígono cerrado y recorrido abierto.
- **Enderezar 90°** endereza los lados casi rectos; **Deshacer** revierte el último cambio.
- Muestra área, perímetro y la medida de cada lado.
- Exporta a **SVG**, **PNG**, **JSON** y **GeoJSON** (los dos últimos solo en planos GPS). En el
  móvil abre el menú de compartir del sistema.

Los planos se guardan automáticamente en el dispositivo (`localStorage`) y la app funciona sin
conexión gracias al service worker.

## Ejecutar

La cámara, el GPS y los sensores de movimiento **solo funcionan en HTTPS** (o en `localhost`).

```bash
npm start          # sirve la app en http://localhost:8080
npm test           # pruebas de la geometría (node --test)
```

Para probarla en el teléfono, publícala en un hosting con HTTPS (GitHub Pages, Netlify, Vercel…)
y desde el navegador elige **Añadir a la pantalla de inicio** para instalarla.

En iPhone, al iniciar el modo cámara Safari pedirá permiso para "Movimiento y orientación".

## APK para Android

La carpeta `android/` contiene un envoltorio nativo mínimo (WebView) que empaqueta la app web
en un APK instalable (Android 7.0 o superior). La app funciona sin conexión, pide los permisos de
cámara y ubicación la primera vez, y guarda las exportaciones en **Descargas/Planos**.

```bash
sudo apt install android-sdk-platform-23 aapt apksigner zipalign dalvik-exchange
android/build.sh        # genera android/build/planos.apk
```

Para instalarlo, copia el APK al teléfono, ábrelo y acepta "instalar apps de origen desconocido".
El APK se firma con `android/debug.keystore` (clave de desarrollo, contraseña `android`) para
que las nuevas versiones se instalen encima de la anterior; para publicar en Google Play usa
tu propia clave (`KEYSTORE=... KS_PASS=... android/build.sh`).

## Estructura

| Archivo | Contenido |
| --- | --- |
| `index.html`, `css/styles.css` | Interfaz |
| `js/app.js` | Pantallas, navegación y flujo de captura |
| `js/geo.js` | Geometría: proyección lat/lon → metros, áreas, orientación de la cámara |
| `js/plan-view.js` | Vista SVG interactiva del plano |
| `js/gps.js` | Lectura y promediado del GPS |
| `js/camera.js` | Cámara trasera y sensores de orientación |
| `js/motion.js` | Contador de pasos con el acelerómetro |
| `js/video.js` | Grabación del video y búsqueda de fotogramas |
| `js/export.js` | Exportación SVG/PNG/JSON/GeoJSON |
| `js/storage.js` | Guardado local de planos y ajustes |
| `sw.js`, `manifest.webmanifest` | PWA (instalable y sin conexión) |
