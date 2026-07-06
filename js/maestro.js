/* ============================================================
   MAESTRO — Catálogo de Vehículos y Choferes
   Permite registrar entradas eligiendo de una lista en vez de
   teclear todo cada vez. Vive en Config.
   ============================================================ */

let maestroSeccion = null;   // null = portada (hub)
/* ---- Metadatos de secciones: color, descripción, contador ---- */
const MAESTRO_SECCIONES = [
  { id: 'rampas',    titulo: 'Rampas',           icono: 'warehouse',       color: '#f59e0b', tinta: '#92400e', desc: 'Estado, total y motivos de fuera de servicio',
    cuenta: () => `${state.docksActive.filter(a => a).length}/${numRampas()} activas` },
  { id: 'catalogos', titulo: 'Catálogos',        icono: 'database',        color: '#22c55e', tinta: '#166534', desc: 'Vehículos, choferes, transportistas, destinos y motivos',
    cuenta: () => `${CAT.tipos().reduce((n, t) => n + CAT.items(t).length, 0)} registros` },
  { id: 'usuarios',  titulo: 'Usuarios',         icono: 'users',           color: '#3b82f6', tinta: '#1e40af', desc: 'Administrador de acceso: qué módulo ve cada quien',
    cuenta: () => `${state.users.filter(u => u.activo !== false).length} activos` },
  { id: 'flujo',     titulo: 'Flujo y tiempos',  icono: 'git-pull-request', color: '#a78bfa', tinta: '#6d28d9', desc: 'SLA por etapa, modo de salida y reglas de patio',
    cuenta: () => '' },
  { id: 'bitacora',  titulo: 'Bitácora',         icono: 'scroll-text',     color: '#2dd4bf', tinta: '#0f766e', desc: 'Auditoría de todo lo que pasa en el sistema',
    cuenta: () => `${state.bitacora.length} eventos` },
  { id: 'sistema',   titulo: 'Sistema',          icono: 'server-cog',      color: '#ef4444', tinta: '#b91c1c', desc: 'Datos de prueba y zona de peligro',
    cuenta: () => '' },
];

function renderMaestroHub() {
  const hub = document.getElementById('maestro-hub');
  if (!hub) return;
  hub.innerHTML = MAESTRO_SECCIONES.map(sec => `
    <button class="hub-card" style="--secc:${sec.color};--secc-ink:${sec.tinta}" onclick="setMaestroSeccion('${sec.id}')">
      <div class="hub-icon"><i data-lucide="${sec.icono}"></i></div>
      <div class="hub-info">
        <strong>${esc(sec.titulo)}</strong>
        <span class="hub-desc">${esc(sec.desc)}</span>
      </div>
      <span class="hub-count">${esc(sec.cuenta() || '')}</span>
      <i data-lucide="chevron-right" class="hub-go"></i>
    </button>`).join('');
  icons();
}

function setMaestroSeccion(sec) {
  maestroSeccion = sec;
  const hub = document.getElementById('maestro-hub');
  const layout = document.getElementById('maestro-layout');
  if (!sec) {                          // portada
    if (hub) hub.style.display = '';
    if (layout) layout.style.display = 'none';
    renderMaestroHub();
    return;
  }
  if (hub) hub.style.display = 'none';
  if (layout) layout.style.display = '';
  const meta = MAESTRO_SECCIONES.find(x => x.id === sec);
  const bc = document.getElementById('maestro-bc');
  if (bc && meta) bc.textContent = meta.titulo;
  document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.toggle('active', b.dataset.sec === sec));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.toggle('active', p.dataset.sec === sec));
  icons();
}


/* Vehículos y Choferes ahora los gestiona el motor declarativo
   (catalogos.js). Este archivo ya no contiene CRUD por catálogo. */

/* ---- Render de la pestaña MAESTRO completa ---- */
function renderMaestroTab() {
  renderRampasConfig();
  renderAjustes();
  renderCatalogos();
  renderUsuarios();
  renderClasifConfig();
  renderBitacora();
  // contadores en la navegación de secciones
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  const activas = state.docksActive.filter(a => a).length;
  set('nav-c-rampas', `${activas}/${numRampas()}`);
  set('nav-c-users', state.users.length);
  set('nav-c-cat', CAT.tipos().reduce((s, t) => s + CAT.items(t).length, 0));
  setMaestroSeccion(maestroSeccion);
  icons();
}

/* ---------- Datos de prueba: 100 unidades en patio ---------- */
function cargarDemo(n) {
  n = n || 100;
  const nombres = ['Juan Pérez', 'Pedro Martínez', 'Luis Gómez', 'Carlos Reyes', 'Miguel Santos', 'José Díaz',
    'Rafael Núñez', 'Ana Jiménez', 'Manuel Castro', 'Francisco Mejía', 'Ramón Peña', 'Andrés Rosario',
    'Víctor Herrera', 'Jorge Polanco', 'Daniel Féliz', 'Eduardo Vargas', 'Roberto Cruz', 'Fernando Lora',
    'Héctor Batista', 'Julio Then'];
  const transportistas = ['Transporte Caribe', 'Logística RD', 'Carga Express', 'TransAntillas',
    'Fletes del Este', 'Distribuidora Nacional', 'Camiones Quisqueya', 'Rutas del Cibao'];
  const ops = ['carga', 'descarga', 'descarga', 'descarga_carga'];
  const tipos = state.config.catUnidad || ['Seco', 'Frío', 'Termo'];
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const usadas = new Set(state.viajes.map(v => v.placa));
  // Remolques también únicos: la BD ahora exige unicidad de colas activas
  const colas = new Set(state.viajes.map(v => v.remolque));
  let creados = 0;
  for (let i = 0; i < n; i++) {
    let placa;
    do { placa = letras[Math.floor(Math.random() * 26)] + String(Math.floor(100000 + Math.random() * 900000)); }
    while (usadas.has(placa));
    usadas.add(placa);
    let cola;
    do { cola = 'R' + String(Math.floor(10000 + Math.random() * 90000)); } while (colas.has(cola));
    colas.add(cola);
    const minAtras = Math.floor(Math.random() * 180);
    const entrada = new Date(Date.now() - minAtras * 60000).toISOString();
    state.viajes.push({
      id: uid(),
      tx: nuevoTx(),
      placa,
      remolque: cola,
      cedula: '0' + (1 + Math.floor(Math.random() * 3)) + '-' + String(Math.floor(1000000 + Math.random() * 9000000)) + '-' + Math.floor(Math.random() * 10),
      chofer: nombres[Math.floor(Math.random() * nombres.length)],
      tipo_unidad: tipos[Math.floor(Math.random() * tipos.length)],
      tipoVehiculo: (state.config.catVehiculo || ['Rígido'])[Math.floor(Math.random() * (state.config.catVehiculo || ['Rígido']).length)],
      entidad: transportistas[Math.floor(Math.random() * transportistas.length)],
      prioridad: 'normal',
      tipoOperacion: ops[Math.floor(Math.random() * ops.length)],
      destino: '',
      estado: EST.PATIO,
      entrada,
      registradoPor: 'Garita demo',
      garitaEntradaPor: 'Garita demo',
      turno: turnoDe(entrada),
      metodoAcceso: 'manual',
    });
    creados++;
  }
  // LOCAL-PRIMERO: la UI se refresca YA; la nube sincroniza detrás en UN request
  logAccion('Demo cargada', `${creados} unidades en patio`);
  renderAll();
  showToast('Demo cargada', `${creados} unidades en patio`, 'success');
  api.viajes.insertarLote(state.viajes.slice(-creados)).then(ok => {
    if (!ok) showToast('Demo SOLO en este equipo', 'No se pudo sincronizar con la nube', 'danger');
  }).catch(err => showToast('Demo SOLO en este equipo', err.message || String(err), 'danger'));
}

/* ---------- Demo: N transacciones COMPLETADAS (a Historial) ----------
   Fabrica viajes que ya recorrieron todo el flujo y salieron, con
   marcas de tiempo coherentes y responsables por etapa, para probar
   el Historial, los tiempos por etapa y la exportación. */
function cargarDemoSalidas(n) {
  n = n || 50;
  const nombres = ['Juan Pérez', 'Pedro Martínez', 'Luis Gómez', 'Carlos Reyes', 'Miguel Santos', 'José Díaz',
    'Rafael Núñez', 'Ana Jiménez', 'Manuel Castro', 'Francisco Mejía', 'Ramón Peña', 'Andrés Rosario',
    'Víctor Herrera', 'Jorge Polanco', 'Daniel Féliz', 'Eduardo Vargas', 'Roberto Cruz', 'Fernando Lora'];
  const transportistas = ['Transporte Caribe', 'Logística RD', 'Carga Express', 'TransAntillas',
    'Fletes del Este', 'Distribuidora Nacional', 'Camiones Quisqueya', 'Rutas del Cibao'];
  const garitaOps = ['L. Méndez', 'R. Castillo', 'F. Abreu'];
  const traficoOps = ['M. Santana', 'J. Ortiz'];
  const despachoOps = ['P. Guzmán', 'A. Reyes'];
  const ops = ['descarga', 'descarga', 'carga', 'descarga_carga'];
  const tipos = state.config.catUnidad || ['Seco', 'Frío', 'Termo'];
  const vehs = ['Rígido', 'Contenedor', 'Dolly'];
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const usadas = new Set([...state.viajes, ...state.history].map(v => v.placa));
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  let creados = 0;

  for (let i = 0; i < n; i++) {
    let placa;
    do { placa = letras[Math.floor(Math.random() * 26)] + String(rnd(100000, 999999)); } while (usadas.has(placa));
    usadas.add(placa);

    // Cadena de tiempos coherente, repartida en las últimas ~40 horas
    const entrada = new Date(Date.now() - rnd(30, 2400) * 60000);
    const dispoTime = new Date(entrada.getTime() + rnd(3, 45) * 60000);
    const dockTime = new Date(dispoTime.getTime() + rnd(2, 25) * 60000);
    const cargaInicio = new Date(dockTime.getTime() + rnd(1, 12) * 60000);
    const cargaFin = new Date(cargaInicio.getTime() + rnd(15, 130) * 60000);
    const salida = new Date(cargaFin.getTime() + rnd(2, 30) * 60000);
    const ent = entrada.toISOString();
    const mins = (a, b) => Math.round((b - a) / 60000);
    const mot = state.config.motivosDemora;
    const motivoPatio = mins(entrada, dockTime) > ((state.config.sla.patio||{}).warn || 30) && Math.random() < 0.6 ? pick(mot) : '';
    const motivoDespacho = mins(dockTime, cargaFin) > ((state.config.sla.carga||{}).danger || 90) && Math.random() < 0.6 ? pick(mot) : '';
    const motivoSalida = mins(cargaFin, salida) > 20 && Math.random() < 0.5 ? pick(mot) : '';

    state.history.unshift({
      id: uid(),
      tx: nuevoTx(),
      placa,
      remolque: 'R' + String(rnd(10000, 99999)),
      cedula: '0' + rnd(1, 3) + '-' + String(rnd(1000000, 9999999)) + '-' + rnd(0, 9),
      chofer: pick(nombres),
      tipo_unidad: pick(tipos),
      tipoVehiculo: pick(vehs),
      entidad: pick(transportistas),
      prioridad: 'normal',
      tipoOperacion: pick(ops),
      destino: '',
      estado: 'finalizado',
      entrada: ent,
      dispoTime: dispoTime.toISOString(),
      dockTime: dockTime.toISOString(),
      dock: rnd(1, numRampas()),
      cargaInicio: cargaInicio.toISOString(),
      cargaFin: cargaFin.toISOString(),
      salida: salida.toISOString(),
      turno: turnoDe(ent),
      metodoAcceso: 'manual',
      metodoSalida: 'manual',
      registradoPor: pick(garitaOps),
      garitaEntradaPor: pick(garitaOps),
      traficoPor: pick(traficoOps),
      despachoPor: pick(despachoOps),
      garitaSalidaPor: pick(garitaOps),
      motivoPatio, motivoDespacho, motivoSalida,
    });
    creados++;
  }
  // LOCAL-PRIMERO: la UI se refresca YA; la nube sincroniza detrás en UN request
  logAccion('Demo de salidas', `${creados} transacciones en Historial`);
  renderAll();
  showToast('Demo de salidas', `${creados} transacciones completadas en Historial`, 'success');
  api.historial.insertarLote(state.history.slice(0, creados)).then(ok => {
    if (!ok) showToast('Demo SOLO en este equipo', 'No se pudo sincronizar con la nube', 'danger');
  }).catch(err => showToast('Demo SOLO en este equipo', err.message || String(err), 'danger'));
}
