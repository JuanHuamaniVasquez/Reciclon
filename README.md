# ♻️ RECICLON — Juego multijugador local

Pequeño juego de cartas estilo “Virus/Reciclaje” construido con **Node.js + Express + Socket.IO** en el backend y **HTML/CSS/JS** en el frontend. Permite crear salas, unirse con código y jugar por turnos en la misma red o a través de una VPN tipo Radmin/Tailscale.

---

## Características

* Salas con **código** (5 letras) y anfitrión.
* Reparto automático y turnos sincronizados.
* Tipos de carta: **contenedor**, **contaminaciones**, **reciclables**, **comodines**.
* Lógica de juego en el servidor (validación y reglas).
* UI con ayudas contextuales (descripciones al **pasar/seleccionar** cartas) y mensajes de ayuda.
* Fondo visual controlado por **variables CSS** (no se resetea al navegar entre pantallas).

---

## Requisitos

* **Node.js** 18+ (recomendado 20+)
* **npm** 9+
* Puertos abiertos localmente (por defecto **3000**)

---

## Instalación

1. Clona el repo o copia los archivos a una carpeta.
2. Ejecuta en una consola de comandos en la raiz del proyecto:
```bash
npm install

npm start
```

Luego abre en el navegador: **[http://localhost:3000](http://localhost:3000)**

---

## Jugar en LAN / Internet

* **Misma Wi‑Fi/LAN**: jugadores abren `http://IP_DEL_HOST:3000` (ej. `http://192.168.1.10:3000`).

---

## Cómo jugar (flujo)

1. Un jugador **crea** sala y comparte el **código**.
2. Los demás **se unen** con el código.
3. El anfitrión pulsa **Iniciar partida**.
4. Se reparten **3 cartas** por jugador. Los turnos avanzan automáticamente:

   * **Jugar carta** sobre un objetivo válido **o**
   * **Descartar** de 1 a 3 cartas (y robar nuevas en tu siguiente turno).
5. El juego anuncia el **ganador** al cumplir la condición de victoria.

### Condición de victoria (por defecto del servidor)

* Tener **4 contenedores limpios** (colores distintos) en tu zona. Contenedor limpio = sin contaminantes o con reciclables.

---

## Reglas de cartas (servidor)

* **Contenedor**: colocar en espacio **vacío** propio. No repetir **color**.
* **Contaminante**: infecta un órgano compatible. Si hay **reciclable**, la consume. Con **2 contaminaciones** se destruye el contenedor.
* **Reciclable**: si está contaminado, **cura 1**; si no, **añade reciclable**. Con 2 vacunas → **inmune**.
* **Comodines**:

  * *Intercambio*: intercambia **dos contenedores no inmunes** entre dos jugadores.
  * *Mapache*: toma un contenedor ajeno y **colócalo en un slot vacío propio** (respetando color).
  * *Camion de basura*: mueve **1 ccontaminacion por cada contenedor tuyo contaminado** a contenedores rivales compatibles que no tengan reciclable/contaminante y no sean inmunes.
  * *Manguera*: los demás **descartan la mano** y roban hasta 3.
  * *Torbellino*: intercambia zonas **completas** con un jugador objetivo **o** elimina un contenedor aleatorio del objetivo.

---



> ¿Necesitas un script de **seed**/debug para forzar cartas en mano, o tests con **Vitest/Jest** para reglas? Se puede añadir como módulo `engine/` aparte.
