const fs = require('fs');
const fsp = fs.promises;

const IDIOMAS = new Set(['kor','ger','eng','fre','spa','ita','rus','ame','cns','tha','twn','jap','por','tur','idn']);

function leerAtributos(etiqueta){
  const atributos = {};
  const patron = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;
  let coincidencia;

  while((coincidencia = patron.exec(etiqueta)) !== null){
    atributos[coincidencia[1]] = coincidencia[2];
  }

  return atributos;
}

function esVerdadero(valor, porDefecto = true){
  if(valor === undefined || valor === null || valor === ''){
    return porDefecto;
  }

  return String(valor).toLowerCase() === 'true';
}

function aNumero(valor, porDefecto = 0){
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : porDefecto;
}

function recorrerNodos(texto, alAbrir, alCerrar){
  const total = texto.length;
  let i = 0;

  while(i < total){
    const inicio = texto.indexOf('<', i);
    if(inicio === -1) return;

    let cursor = inicio + 1;
    const esCierre = texto[cursor] === '/';
    if(esCierre) cursor++;

    if(texto[cursor] === '!' || texto[cursor] === '?'){
      const fin = texto.indexOf('>', cursor);
      if(fin === -1) return;
      i = fin + 1;
      continue;
    }

    const inicioNombre = cursor;
    while(cursor < total && /[A-Za-z0-9_.:-]/.test(texto[cursor])) cursor++;
    const nombre = texto.slice(inicioNombre, cursor);

    if(!nombre){
      i = inicio + 1;
      continue;
    }

    const inicioAtributos = cursor;
    let dentroDeComillas = false;

    while(cursor < total){
      const caracter = texto[cursor];
      if(caracter === '"') dentroDeComillas = !dentroDeComillas;
      else if(caracter === '>' && !dentroDeComillas) break;
      cursor++;
    }

    if(cursor >= total) return;

    const crudo = texto.slice(inicioAtributos, cursor);
    const fin = cursor + 1;

    if(esCierre){
      alCerrar(nombre, inicio, fin);
    } else {
      alAbrir(nombre, crudo, crudo.trimEnd().endsWith('/'), inicio, fin);
    }

    i = fin;
  }
}

function parsearXui(texto){
  const pila = [];
  const raices = [];
  let dentroDeGui = false;
  let profundidadGui = 0;

  const contenedores = new Set(['gui_root', 'gui', 'child', 'script_files']);

  recorrerNodos(texto, (nombre, crudo, cerrado, inicio, fin) => {
    if(nombre === 'gui'){
      dentroDeGui = true;
      profundidadGui = 0;
      return;
    }

    if(!dentroDeGui || cerrado){
      if(dentroDeGui && cerrado){
        aplicarPropiedad(pila[pila.length - 1], nombre, leerAtributos(crudo), inicio, fin);
      }
      return;
    }

    if(nombre === 'child'){
      profundidadGui++;
      return;
    }

    if(contenedores.has(nombre)){
      return;
    }

    if(nombre.startsWith('CGUI_')){
      const atributos = leerAtributos(crudo);
      const control = {
        tipo: nombre,
        nombre: atributos.name || '',
        x: 0, y: 0, ancho: 0, alto: 0,
        visible: true,
        habilitado: true,
        opacidad: 1,
        texto: '',
        textura: '',
        pieles: [],
        colores: [],
        textos: {},
        hijos: [],
        offsets: {}
      };

      const padre = pila[pila.length - 1];
      if(padre){
        padre.hijos.push(control);
      } else {
        raices.push(control);
      }

      pila.push(control);
      return;
    }

    aplicarPropiedad(pila[pila.length - 1], nombre, leerAtributos(crudo), inicio, fin);
  }, nombre => {
    if(nombre === 'gui'){
      dentroDeGui = false;
      return;
    }

    if(nombre === 'child'){
      profundidadGui--;
      return;
    }

    if(nombre.startsWith('CGUI_')){
      pila.pop();
    }
  });

  return raices;
}

function aplicarPropiedad(control, nombre, atributos, inicio, fin){
  if(!control){
    return;
  }

  if(nombre === 'global'){
    const izquierda = aNumero(atributos.left);
    const arriba = aNumero(atributos.top);
    control.x = izquierda;
    control.y = arriba;
    control.ancho = aNumero(atributos.right, izquierda) - izquierda;
    control.alto = aNumero(atributos.bottom, arriba) - arriba;
    control.offsets.global = { inicio, fin };
    return;
  }

  if(nombre === 'local'){
    const izquierda = aNumero(atributos.left);
    const arriba = aNumero(atributos.top);
    control.localX = izquierda;
    control.localY = arriba;
    control.localAncho = aNumero(atributos.right, izquierda) - izquierda;
    control.localAlto = aNumero(atributos.bottom, arriba) - arriba;
    control.offsets.local = { inicio, fin };
    return;
  }

  if(nombre === 'show'){
    control.visible = esVerdadero(atributos.value);
    control.offsets.show = { inicio, fin };
    return;
  }

  if(nombre === 'enable'){
    control.habilitado = esVerdadero(atributos.value);
    control.offsets.enable = { inicio, fin };
    return;
  }

  if(nombre === 'opacity'){
    control.opacidad = aNumero(atributos.value, 1);
    control.offsets.opacity = { inicio, fin };
    return;
  }

  if(nombre.startsWith('gui_skin_')){
    const indice = Number(nombre.slice('gui_skin_'.length));
    const piel = {
      indice,
      textura: atributos.texture || '',
      u0: aNumero(atributos.left, 0),
      v0: aNumero(atributos.top, 0),
      u1: aNumero(atributos.right, 1),
      v1: aNumero(atributos.bottom, 1),
      offset: { inicio, fin }
    };
    control.pieles.push(piel);

    if(indice === 0 && piel.textura){
      control.textura = piel.textura;
    }
    return;
  }

  if(nombre.startsWith('color_')){
    control.colores.push({
      indice: Number(nombre.slice('color_'.length)),
      base: aNumero(atributos.base_color, 0),
      sub: aNumero(atributos.sub_color, 0),
      offset: { inicio, fin }
    });
    return;
  }

  if(nombre === 'font_style' || nombre === 'text_align'){
    control[nombre] = aNumero(atributos.value, 0);
    control.offsets[nombre] = { inicio, fin };
    return;
  }

  if(IDIOMAS.has(nombre)){
    control.textos[nombre] = atributos.value || '';
    control.offsets['texto_' + nombre] = { inicio, fin };

    if(nombre === 'eng' && !control.texto){
      control.texto = atributos.value || '';
    }
  }
}

function aplicarCambios(texto, cambios){
  const ordenados = [...cambios].sort((a, b) => b.inicio - a.inicio);

  for(const cambio of ordenados){
    const etiqueta = texto.slice(cambio.inicio, cambio.fin);
    let nuevaEtiqueta = etiqueta;

    for(const [atributo, valor] of Object.entries(cambio.atributos)){
      const patron = new RegExp(`(\\b${atributo}\\s*=\\s*")([^"]*)(")`);

      if(patron.test(nuevaEtiqueta)){
        nuevaEtiqueta = nuevaEtiqueta.replace(patron, `$1${valor}$3`);
      }
    }

    texto = texto.slice(0, cambio.inicio) + nuevaEtiqueta + texto.slice(cambio.fin);
  }

  return texto;
}

function buscarControl(controles, ruta){
  let actual = null;
  let lista = controles;

  for(const indice of ruta){
    actual = lista[indice];
    if(!actual){
      return null;
    }
    lista = actual.hijos;
  }

  return actual;
}

async function cargarXui(rutaArchivo){
  const texto = await fsp.readFile(rutaArchivo, 'utf8');
  return { texto, controles: parsearXui(texto) };
}

async function guardarXui(rutaArchivo, ediciones){
  const texto = await fsp.readFile(rutaArchivo, 'utf8');
  const controles = parsearXui(texto);
  const cambios = [];

  for(const edicion of ediciones){
    const control = buscarControl(controles, edicion.ruta || []);

    if(!control){
      continue;
    }

    if(edicion.x !== undefined && control.offsets.global){
      cambios.push({
        ...control.offsets.global,
        atributos: {
          left: Math.round(edicion.x),
          top: Math.round(edicion.y),
          right: Math.round(edicion.x + (edicion.ancho ?? control.ancho)),
          bottom: Math.round(edicion.y + (edicion.alto ?? control.alto))
        }
      });
    }

    if(edicion.visible !== undefined && control.offsets.show){
      cambios.push({ ...control.offsets.show, atributos: { value: edicion.visible ? 'true' : 'false' } });
    }

    if(edicion.habilitado !== undefined && control.offsets.enable){
      cambios.push({ ...control.offsets.enable, atributos: { value: edicion.habilitado ? 'true' : 'false' } });
    }

    if(edicion.opacidad !== undefined && control.offsets.opacity){
      cambios.push({ ...control.offsets.opacity, atributos: { value: Number(edicion.opacidad).toFixed(6) } });
    }
  }

  if(!cambios.length){
    return { guardados: 0 };
  }

  await fsp.writeFile(rutaArchivo, aplicarCambios(texto, cambios), 'utf8');
  return { guardados: cambios.length };
}

module.exports = { parsearXui, cargarXui, guardarXui };
