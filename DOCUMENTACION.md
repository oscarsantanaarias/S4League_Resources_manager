# S4League Resources & Mods Manager

Herramienta de escritorio para explorar, editar, previsualizar y reempaquetar
los recursos del cliente de S4League, y para agregar armas, costumes y mapas
custom a un servidor privado.

Hecha con Electron. Corre en Windows.

## Tabla de contenido

- [Requisitos](#requisitos)
- [Instalacion](#instalacion)
- [Resumen de features](#resumen-de-features)
- [Rutas](#rutas)
- [Cargar recursos](#cargar-recursos)
- [Extract](#extract)
- [Pack](#pack)
- [Explorador de recursos](#explorador-de-recursos)
- [Vista 3D](#vista-3d)
- [Add Tools](#add-tools-armas-costumes-mapas)
- [Convert](#convert-xml--xbn)
- [Crypt](#crypt)
- [Base de datos](#base-de-datos)

## Requisitos

- Windows
- [Node.js](https://nodejs.org)
- Una carpeta del cliente de S4League (la que tiene `resource.s4hd` y `_resources`)

## Instalacion

Solo corre `run.bat`. La primera vez instala las dependencias y recompila los
modulos nativos para Electron (eso arregla el error `NODE_MODULE_VERSION` del
`lzo`), y despues abre la app. Cada vez siguiente solo la abre.

## Resumen de features

| Feature | Que hace |
|---|---|
| Rutas | Apunta la tool a tu cliente, mods y carpeta del servidor |
| Load Resources | Abre el arbol del cliente desde `resource.s4hd`, packs o carpeta suelta |
| Extract | Desempaca el cliente en `extracted_resources` para editar |
| Pack | Arma `extracted_resources` de vuelta en `resource.s4hd` + `_resources` |
| Explorador | Explora, previsualiza, edita, reemplaza, borra y extrae archivos |
| Vista 3D | Ve modelos y efectos `.scn` y `.seq` con animacion |
| Add Weapons | Inyecta un arma custom al cliente y la registra en el servidor |
| Add Costumes | Inyecta un costume custom y lo registra |
| Add Maps | Registra mapas custom en la lista de mapas del cliente |
| Convert | XML a XBN y de vuelta |
| Crypt | Cifra/descifra shop, `.seq` y Lua; SCN/SEQ a JSON y de vuelta |

## Rutas

Barra de arriba, menu **Paths**. Configuralas antes de todo.

- **Select S4League Client Folder** - la carpeta del cliente que tiene
  `resource.s4hd` y `_resources`. Es la ruta principal.
- **Select Extracted Folder** - opcional. Apuntala a una carpeta
  `extracted_resources` si quieres explorar archivos sueltos en vez del cliente
  empaquetado. Puede estar en cualquier lado del disco.
- **Mods Folder** - la carpeta con tu contenido custom (archivos de
  arma/costume, texturas, etc). La usan las Add Tools.
- **Server Data Folder** - la carpeta `data` de tu emulador/servidor, de donde
  el juego lee sus tablas xml/x7. Armas y mapas escriben aca.

Las rutas se recuerdan entre sesiones.

## Cargar recursos

Dale a **Load Resources**. Si el cliente tiene mas de una fuente disponible, un
dialogo te deja elegir cual explorar:

- **resource.s4hd** - el contenedor empaquetado original.
- **data#.bin packs** - un cliente ya migrado al formato de packs
  (`resources_index.json`). Pide la clave del pack.
- **extracted_resources** - archivos sueltos en disco. Usa esto para trabajar
  directo sobre una carpeta extraida sin reempaquetar cada vez.

Puedes tener configuradas a la vez la carpeta del cliente y una carpeta extraida
aparte, y cambiar entre ambas desde este dialogo.

## Extract

Menu **Extract**. Desempaca `resource.s4hd` / `_resources` en una carpeta
`extracted_resources` al lado del cliente, para poder editar los archivos con
cualquier herramienta.

## Pack

Menu **Pack**. Arma todo lo de `extracted_resources` de vuelta en
`resource.s4hd` + `_resources` para que el cliente lo lea otra vez. Usalo cuando
termines de editar.

## Explorador de recursos

Una vez cargado, el arbol de la izquierda muestra los archivos del cliente. Con
un archivo seleccionado puedes:

- **Previsualizar** texto, imagenes, `.scn` y `.seq`.
- **Editar texto** de archivos xml/lua/config y guardarlo.
- **Reemplazar archivo** con uno del disco.
- **Reemplazar textura** referenciada dentro de un `.scn`.
- **Borrar** un recurso.
- **Extraer** archivos/carpetas seleccionados a la carpeta que quieras.

Cuando exploras una fuente suelta (extraida), los cambios se escriben directo a
los archivos en disco. Cuando exploras el cliente empaquetado, los cambios se
guardan de vuelta en `resource.s4hd`.

## Vista 3D

Los `.scn` y `.seq` abren en un visor 3D dentro de la app:

- Los modelos se renderizan con sus texturas reales.
- Las animaciones se reproducen solas (morph, transforms de nodo y clips de
  esqueleto).
- `Q` / `E` cambian entre clips de animacion.
- Las piezas de personaje (cuerpos, manos, pies) salen en pose bind; los
  personajes completos se pueden armar y posar.

## Add Tools (Armas, Costumes, Mapas)

Menu **Add Tools**.

### Add Weapons

1. Pon los archivos del arma en tu **Mods Folder**.
2. Ten las rutas del cliente y del server data puestas, y la base de datos
   conectada.
3. Dale a **Add Weapons**. Copia los recursos del arma al cliente y escribe el
   item info / xml del arma en el server data y la base de datos.
4. **Pack** cuando termines.

### Add Costumes

1. Pon los archivos del costume en tu **Mods Folder**.
2. Rutas del cliente + server data puestas, base de datos conectada.
3. Dale a **Add Costumes**. Agrega los recursos del costume y registra el item
   para que salga en el juego.
4. **Pack** cuando termines.

### Add Maps

1. Pon tus archivos de info del mapa (`.ini`) en `resources/maps/mapinfo/` y la
   imagen de preview al lado.
2. Configura la ruta del cliente.
3. Dale a **Add Maps**. Registra cada mapa en la lista de mapas del cliente y la
   tabla de nombres, y habilita sus modos.
4. **Pack** cuando termines.

> El id de un mapa es un solo byte, asi que van entre 2 y 255.

## Convert (XML / XBN)

Menu **Convert**.

- **XML to XBN** - empaqueta una tabla `.xml` en el binario `.xbn` que lee el
  cliente.
- **XBN to XML** - descifra un `.xbn` de vuelta a XML legible. Maneja varios
  archivos a la vez.

## Crypt

Menu **Crypt**. Cifra o descifra archivos del juego, y convierte modelos a JSON
editable:

- **Decrypt / Crypt Shop S4** - la tabla del shop.
- **Decrypt / Crypt .SEQ** - archivos de secuencia (timeline de efectos).
- **Decrypt / Crypt Lua** - scripts Lua (maneja la codificacion coreana).
- **SCN to JSON / JSON to SCN** - vuelca un `.scn` a JSON editable (matrices,
  poses, morph) y lo parchea de vuelta sin perdida.
- **SEQ to JSON / JSON to SEQ** - lo mismo para archivos `.seq`.

## Base de datos

Llena los campos de la base de datos (host / usuario / clave / base de datos y
las tablas del item) y activa el toggle de la base de datos. Armas y costumes la
usan para registrar el item nuevo en el servidor y que aparezca en el juego. Los
mapas no la necesitan.
