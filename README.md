# Planos — app móvil para levantar planos con cámara o GPS

Aplicación web progresiva (PWA) que se instala en el teléfono y permite dibujar
planos de habitaciones o terrenos usando los sensores del dispositivo.
No necesita compilación ni dependencias: es HTML, CSS y JavaScript puro.

## Modos de captura

### 📷 Con cámara (interiores)
1. Colócate en un punto desde el que veas todas las esquinas de la habitación.
2. Indica la **altura a la que sostienes el teléfono** (por defecto 1,40 m).
3. Apunta la cruz al punto donde cada esquina toca el suelo y pulsa **Marcar esquina**, en orden.
4. Pulsa **Terminar**.

La app calcula la distancia a cada esquina por trigonometría:
`distancia = altura / tan(ángulo hacia abajo)`, y la dirección con el giroscopio/brújula.
Sin moverte del sitio, gira sobre ti mismo (no desplaces el teléfono).

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

## Estructura

| Archivo | Contenido |
| --- | --- |
| `index.html`, `css/styles.css` | Interfaz |
| `js/app.js` | Pantallas, navegación y flujo de captura |
| `js/geo.js` | Geometría: proyección lat/lon → metros, áreas, orientación de la cámara |
| `js/plan-view.js` | Vista SVG interactiva del plano |
| `js/gps.js` | Lectura y promediado del GPS |
| `js/camera.js` | Cámara trasera y sensores de orientación |
| `js/export.js` | Exportación SVG/PNG/JSON/GeoJSON |
| `js/storage.js` | Guardado local de planos y ajustes |
| `sw.js`, `manifest.webmanifest` | PWA (instalable y sin conexión) |
