/* ============================================================
   GARITA — Control de acceso (entrada y salida)
   MEJORAS v2:
   · Selectores de catálogo poblados siempre desde config (no depende
     de race condition con renderGarita)
   · tipoVehiculo completo desde catálogo editable
   ============================================================ */

let camStream = null;
let garitaModo = 'entrada';
let garitaLogFiltro = 'todos';
let _clasifManual = false;   // el guardia tocó la clasificación a mano

function setGaritaModo(modo) {
  garitaModo = modo;
  document.querySelectorAll('.garita-mode .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.modo === modo));
  const acc = document.getElementById('garita-access');
  if (acc) acc.classList.toggle('salida', modo === 'salida');
  const ent = document.getElementById('garita-entrada-ui');
  const sal = document.getElementById('garita-salida-ui');
  if (ent) ent.style.display = modo === 'entrada' ? '' : 'none';
  if (sal) sal.style.display = modo === 'salida' ? '' : 'none';
  if (modo === 'salida') { detenerCamara(); renderListosSalida(); }
  const foco = document.getElementById(modo === 'salida' ? 'gs-placa' : 'gm-cabezote');
  if (foco) { foco.value = ''; foco.focus(); }
  precheckPlaca('');
  ocultarRechazoChips();
}

/* ============================================================
   PRE-CHEQUEO EN VIVO — el guardia sabe el veredicto ANTES
   de pulsar Procesar: dentro / reconocida / puede salir / nueva
   ============================================================ */
function precheckPlaca(valor) {
  const placa = (valor || '').toUpperCase().trim();
  const box = document.getElementById(garitaModo === 'salida' ? 'garita-precheck-salida' : 'garita-precheck');
  const otro = document.getElementById(garitaModo === 'salida' ? 'garita-precheck' : 'garita-precheck-salida');
  if (otro) { otro.className = 'garita-precheck'; otro.innerHTML = ''; }
  if (!box) return;
  if (placa.length < 3) { box.className = 'garita-precheck'; box.innerHTML = ''; if (garitaModo === 'entrada') autoClasif(null); return; }

  if (garitaModo === 'salida') {
    const v = state.viajes.find(x => x.placa === placa);
    if (!v) { box.className = 'garita-precheck warn'; box.innerHTML = '⚠ No está en el sistema — sin transacción activa'; return; }
    if (v.estado === EST.LISTO || v.estado === EST.CARGADO_PATIO) {
      box.className = 'garita-precheck ok'; box.innerHTML = `✓ Puede salir · ${esc(v.tx || '')} · Enter para procesar`;
    } else {
      box.className = 'garita-precheck warn'; const def = HATTA.estados[v.estado] || {};
      box.innerHTML = `⚠ Aún no despachada · ${esc(def.estadoCorto || v.estado)}${v.dock ? ' · R-' + v.dock : ''}`;
    }
    return;
  }

  // ENTRADA
  const dentro = state.viajes.find(x => x.placa === placa);
  if (dentro) {
    box.className = 'garita-precheck warn';
    box.innerHTML = `⚠ Ya está dentro · ${esc(dentro.tx || '')} · no se puede duplicar`;
    autoClasif(null);
    return;
  }
  const veh = CAT.activos('vehiculos').find(x => x.placa === placa);
  const chof = CAT.activos('choferes').find(c => c.placa === placa);
  if (veh || chof) {
    const partes = [];
    if (veh) { if (veh.transportista) partes.push(veh.transportista); if (veh.tipo) partes.push(veh.tipo); }
    if (chof) partes.push(chof.nombre);
    box.className = 'garita-precheck ok';
    box.innerHTML = `✓ Reconocida del maestro · ${esc(partes.join(' · ') || 'sin detalle')}`;
    autoClasif(veh, chof);
  } else {
    box.className = 'garita-precheck neutral';
    box.innerHTML = 'Placa nueva — complete la clasificación';
    autoClasif(null);
  }
}

/* ---- Clasificación: autocompletar desde el maestro y colapsar ---- */
function autoClasif(veh, chof) {
  if (_clasifManual) return;                 // respeta lo que el guardia tocó
  const su = document.getElementById('gm-unidad');
  const ced = document.getElementById('gm-cedula');
  if (veh) {
    if (su && veh.tipo) su.value = veh.tipo;
    setClasifColapsada(true);
  } else {
    setClasifColapsada(false);
  }
  if (chof && ced && !ced.value) ced.value = chof.cedula || '';
}
function setClasifColapsada(colapsada) {
  const body = document.getElementById('gm-clasif-body');
  const wrap = document.getElementById('gm-clasif');
  if (!body || !wrap) return;
  wrap.classList.toggle('colapsada', colapsada);
  body.style.display = colapsada ? 'none' : '';
  actualizarResumenClasif();
}
function toggleClasif() {
  const body = document.getElementById('gm-clasif-body');
  if (!body) return;
  setClasifColapsada(body.style.display !== 'none');
}
function clasifCambiada() { _clasifManual = true; actualizarResumenClasif(); }
function actualizarResumenClasif() {
  const r = document.getElementById('gm-clasif-resumen');
  if (!r) return;
  const op = (document.getElementById('gm-operacion') || {});
  const un = (document.getElementById('gm-unidad') || {}).value || '';
  const ve = (document.getElementById('gm-vehiculo') || {}).value || '';
  const opTxt = op.selectedIndex >= 0 && op.options ? op.options[op.selectedIndex].text : '';
  r.textContent = [opTxt, un, ve].filter(Boolean).join(' · ') || 'Clasificación';
}

function nuevoTx() {
  state.txCounter = (state.txCounter || 0) + 1;
  return 'HT-' + String(state.txCounter).padStart(5, '0');
}

/* ---- Núcleo: resolver según el modo ---- */
function procesarAcceso(placaRaw, info = {}) {
  const placa = (placaRaw || '').toString().toUpperCase().trim();
  if (!placa) return showToast('Falta la placa', 'Identifique la unidad primero', 'warning');

  if (garitaModo === 'salida') {
    const v = state.viajes.find(x => x.placa === placa && (x.estado === EST.LISTO || x.estado === EST.CARGADO_PATIO));
    if (!v) {
      const dentro = state.viajes.find(x => x.placa === placa);
      if (dentro) return scanFeedback('warn', `${placa} aún no puede salir`, 'No ha sido despachada');
      return scanFeedback('warn', `${placa} no está en el sistema`, 'Sin transacción activa');
    }
    return ejecutarSalida(v.id, info.metodo);
  }

  // ENTRADA
  const dentro = state.viajes.find(x => x.placa === placa);
  if (dentro) return scanFeedback('warn', `${placa} ya está dentro`, `Transacción ${dentro.tx || ''}`);

  const veh = CAT.activos('vehiculos').find(x => x.placa === placa);
  const chof = CAT.activos('choferes').find(c => c.placa === placa);
  const tx = nuevoTx();
  const nuevoViaje = {
    id: uid(),
    tx,
    placa,
    remolque: (info.remolque || 'N/A').toString().toUpperCase(),
    cedula: info.cedula || (chof ? chof.cedula : '') || '',
    chofer: info.chofer || (chof ? chof.nombre : '') || '',
    tipo_unidad: info.tipo_unidad || (veh ? veh.tipo : (state.config.catUnidad[0] || 'Seco')),
    tipoVehiculo: info.tipoVehiculo || (state.config.catVehiculo[0] || 'Rígido'),
    entidad: veh ? (veh.transportista || 'Transportista') : 'Transportista',
    prioridad: 'normal',
    tipoOperacion: info.tipoOperacion || 'descarga',
    destino: '',
    estado: EST.PATIO,
    entrada: new Date().toISOString(),
    registradoPor: state.currentUserName,
    garitaEntradaPor: state.currentUserName,
    turno: turnoDe(new Date().toISOString()),
    metodoAcceso: info.metodo || 'manual',
  };
  // Registrar SIEMPRE localmente primero (la UI nunca depende de la red),
  // luego sincronizar con Supabase. Si la nube falla, el error se VE.
  state.viajes.push(nuevoViaje);
  logAccion('Entrada', `${placa} ingresó por Garita · ${tx}`);
  renderAll();
  api.viajes.insertar(nuevoViaje)
    .then(guardado => {
      if (guardado && guardado.id !== nuevoViaje.id) {
        const i = state.viajes.findIndex(x => x.id === nuevoViaje.id);
        if (i !== -1) state.viajes[i] = guardado;
      }
    })
    .catch(err => {
      console.error('[HATTA] entrada no sincronizada:', err);
      showToast('Entrada registrada SOLO en este equipo',
        `No se pudo guardar en la nube: ${err.message || err}`, 'danger');
    });
  scanFeedback('in', `ENTRADA · ${placa}`, `${tx} · queda en patio${chof ? ' · ' + chof.nombre : ''}`);
}

function ejecutarSalida(id, metodo) {
  const idx = state.viajes.findIndex(v => v.id === id);
  if (idx === -1) return;
  const v = state.viajes.splice(idx, 1)[0];
  v.salida          = new Date().toISOString();
  v.turnoSalida     = turnoDe(v.salida);
  v.metodoSalida    = metodo || 'manual';
  v.garitaSalidaPor = state.currentUserName;
  v.estado          = 'finalizado';
  logAccion('Salida', `${v.placa} salió · ${v.tx || ''}`);
  state.history.unshift(v);
  // En Supabase: borrar de viajes e insertar en historial
  renderAll();
  Promise.all([
    api.viajes.eliminar(v.id),
    api.historial.insertar(v),
  ]).catch(err => {
    console.error('[HATTA] salida no sincronizada:', err);
    showToast('Salida registrada SOLO en este equipo',
      `No se pudo guardar en la nube: ${err.message || err}`, 'danger');
  });
  scanFeedback('out', `SALIDA · ${v.placa}`, `${v.tx || ''} · transacción cerrada`);
}

/* ---- Métodos ---- */
function confirmarFacial() {
  const sel = document.getElementById('garita-facial-select');
  if (!sel || !sel.value) return showToast('Sin identificar', 'Seleccione el chofer o use datos manuales', 'warning');
  const c = state.choferes.find(x => x.id === sel.value);
  if (!c || !c.placa) return showToast('Sin placa', 'Ese chofer no tiene placa en el maestro', 'warning');
  detenerCamara();
  procesarAcceso(c.placa, { cedula: c.cedula, chofer: c.nombre, metodo: 'facial' });
  sel.value = '';
}
function leerHuella() {
  const sel = document.getElementById('garita-huella-select');
  if (!sel || !sel.value) return showToast('Sin identificar', 'Seleccione el chofer o use datos manuales', 'warning');
  const c = state.choferes.find(x => x.id === sel.value);
  if (!c || !c.placa) return showToast('Sin placa', 'Ese chofer no tiene placa en el maestro', 'warning');
  procesarAcceso(c.placa, { cedula: c.cedula, chofer: c.nombre, metodo: 'huella' });
  sel.value = '';
}
function procesarSalidaManual() {
  const el = document.getElementById('gs-placa');
  const placa = (el && el.value || '').toUpperCase().trim();
  if (!placa) return showToast('Falta la placa', 'Escriba la placa o toque la unidad en la lista', 'warning');
  procesarAcceso(placa, { metodo: 'manual' });
  if (el) { el.value = ''; el.focus(); }
  precheckPlaca('');
}

function renderListosSalida() {
  const cont = document.getElementById('gs-listos');
  const cnt = document.getElementById('gs-listos-count');
  if (!cont) return;
  const listos = state.viajes
    .filter(v => v.estado === EST.LISTO || v.estado === EST.CARGADO_PATIO)
    .sort((a, b) => new Date(a.entrada) - new Date(b.entrada));
  if (cnt) cnt.textContent = listos.length;
  cont.innerHTML = listos.length ? listos.map(v => `
    <button class="gs-item" onclick="salidaDesdeLista('${esc(v.id)}')">
      <span class="gs-placa mono">${esc(v.placa)}</span>
      <span class="gs-meta">${esc(v.tx || '')}${v.dock ? ' · R-' + v.dock : ''}</span>
      <span class="gs-tiempo">${tiempoRel(v.entrada)}</span>
      <i data-lucide="log-out"></i>
    </button>`).join('')
    : vacio('check-circle-2', 'Nadie pendiente de salir', 'Las unidades listas o cargadas aparecen aquí');
  icons();
}
function salidaDesdeLista(id) {
  const v = state.viajes.find(x => x.id === id);
  if (!v) return;
  uiConfirm('Confirmar salida', `${v.placa} · ${v.tx || ''} — se cerrará la transacción y saldrá del patio.`,
    () => ejecutarSalida(v.id, 'manual'), { okText: 'Registrar salida' });
}

/* ---- Hora relativa para el log ---- */
function tiempoRel(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return formatHora(iso);
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h ${m % 60 ? (m % 60) + ' m' : ''}`.trim();
  return formatHora(iso);
}

function procesarManual() {
  const cedula = (document.getElementById('gm-cedula').value || '').trim();
  const cabezote = (document.getElementById('gm-cabezote').value || '').trim();
  const cola = (document.getElementById('gm-cola').value || '').trim();
  const operacion = (document.getElementById('gm-operacion') || {}).value || 'descarga';
  const unidad = (document.getElementById('gm-unidad') || {}).value || (state.config.catUnidad[0] || 'Seco');
  const vehiculo = (document.getElementById('gm-vehiculo') || {}).value || (state.config.catVehiculo[0] || 'Rígido');
  if (!cabezote) return showToast('Falta placa cabezote', 'Es obligatoria', 'danger');
  procesarAcceso(cabezote, { cedula, remolque: cola, metodo: 'manual', tipoOperacion: operacion, tipo_unidad: unidad, tipoVehiculo: vehiculo });
  document.getElementById('gm-cedula').value = '';
  document.getElementById('gm-cabezote').value = '';
  document.getElementById('gm-cola').value = '';
  _clasifManual = false;
  precheckPlaca('');
  ocultarRechazoChips();
  document.getElementById('gm-cabezote').focus();
}

/* Motivos de rechazo: catálogo del Maestro (motivos_rechazo);
   si la empresa aún no cargó ninguno, valores de arranque. */
function motivosRechazo() {
  const m = CAT.opciones('motivos_rechazo');
  return m.length ? m : ['Documentación incompleta', 'Sin cita', 'Placa no autorizada', 'Condiciones inseguras'];
}
function rechazarIngreso() {
  const placa = (document.getElementById('gm-cabezote').value || '').toUpperCase().trim();
  if (!placa) return showToast('Falta la placa', 'Escriba la placa cabezote para rechazar', 'warning');
  const box = document.getElementById('gm-rechazo-chips');
  if (!box) return;
  box.innerHTML = `<label class="muted">Motivo del rechazo de <strong class="mono">${esc(placa)}</strong> — un toque:</label>
    <div class="chips-wrap">` +
    motivosRechazo().map(m => `<button class="chip chip-rechazo" onclick="confirmarRechazo('${esc(m).replace(/'/g, '&#39;')}')">${esc(m)}</button>`).join('') +
    `<button class="chip" onclick="otroMotivoRechazo()">Otro…</button>
     <button class="chip chip-cancel" onclick="ocultarRechazoChips()">Cancelar</button></div>`;
  box.style.display = 'block';
}
function confirmarRechazo(motivo) {
  const placa = (document.getElementById('gm-cabezote').value || '').toUpperCase().trim();
  if (!placa) return ocultarRechazoChips();
  const rechazo = { id: uid(), placa, motivo: motivo || 'Sin motivo', hora: new Date().toISOString(), por: state.currentUserName };
  state.rechazos.unshift(rechazo);
  if (state.rechazos.length > 200) state.rechazos = state.rechazos.slice(0, 200);
  api.rechazos.insertar(rechazo).catch(() => {});
  logAccion('Rechazo', `${placa} rechazado · ${rechazo.motivo}`);
  const i = document.getElementById('gm-cabezote'); if (i) i.value = ''; precheckPlaca('');
  ocultarRechazoChips();
  renderGarita();
  scanFeedback('warn', `RECHAZADO · ${placa}`, rechazo.motivo);
}
function otroMotivoRechazo() {
  const placa = (document.getElementById('gm-cabezote').value || '').toUpperCase().trim();
  uiPrompt(`Rechazar ingreso de ${placa}`, { label: 'Motivo del rechazo', value: '' }, (m) => confirmarRechazo(m || 'Sin motivo'));
}
function ocultarRechazoChips() {
  const box = document.getElementById('gm-rechazo-chips');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

/* ---- Feedback: BANNER grande arriba del módulo ----
   Verde = entrada · Azul = salida · Ámbar = advertencia/rechazo.
   Se limpia solo a los 7 segundos. */
let _bannerTimer = null;
function scanFeedback(tipo, titulo, sub) {
  const box = document.getElementById('garita-banner');
  if (!box) { showToast(titulo, sub, tipo === 'warn' ? 'warning' : 'success'); return; }
  const icon = tipo === 'in' ? 'log-in' : tipo === 'out' ? 'log-out' : 'alert-triangle';
  box.className = `garita-banner ${tipo}`;
  box.innerHTML = `<i data-lucide="${icon}"></i><div><strong>${esc(titulo)}</strong><span>${esc(sub)}</span></div>`;
  box.style.display = 'flex';
  icons();
  clearTimeout(_bannerTimer);
  _bannerTimer = setTimeout(() => { box.style.display = 'none'; }, 7000);
}
function setMetodoGarita(m) {
  document.querySelectorAll('#garita-access .acc-method').forEach(b => b.classList.toggle('active', b.dataset.metodo === m));
  document.querySelectorAll('#garita-access .acc-panel').forEach(p => p.classList.toggle('active', p.dataset.metodo === m));
  if (m !== 'facial') detenerCamara();
}
function toggleCamara() { if (camStream) { detenerCamara(); camMsg('Cámara apagada.'); } else iniciarCamara(); }
function iniciarCamara() {
  const wrap = document.getElementById('garita-cam-wrap');
  const video = document.getElementById('garita-cam');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return camMsg('Cámara no soportada. Usa datos manuales.');
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
    .then(stream => { camStream = stream; video.srcObject = stream; video.setAttribute('playsinline', 'true'); video.play(); wrap.classList.add('active'); camMsg('Cámara activa.'); })
    .catch(e => camMsg(`No se pudo abrir la cámara (${e.name}). Requiere HTTPS o usa datos manuales.`));
}
function detenerCamara() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  const wrap = document.getElementById('garita-cam-wrap'); if (wrap) wrap.classList.remove('active');
}
function camMsg(m) { const el = document.getElementById('garita-cam-msg'); if (el) el.textContent = m; }

/* ---- Render ---- */
function filaTx(o) {
  const evtCls = o.evento === 'ENTRADA' ? 'in' : o.evento === 'SALIDA' ? 'out' : 'rej';
  let det = '';
  if (o.evento === 'RECHAZO') {
    det = `<div class="txd"><label>Motivo</label><span>${esc(o.motivo)}</span></div>
      <div class="txd"><label>Hora</label><span class="mono">${formatHora(o.hora)}</span></div>
      <div class="txd"><label>Operador</label><span>${esc(o.por || '')}</span></div>`;
  } else {
    det = `<div class="txd"><label>Cabezote</label><span class="mono">${esc(o.placa)}</span></div>
      <div class="txd"><label>Cola</label><span class="mono">${esc(o.remolque || 'N/A')}</span></div>
      <div class="txd"><label>Chofer</label><span>${esc(o.chofer || '—')}</span></div>
      <div class="txd"><label>Cédula</label><span>${esc(o.cedula || '—')}</span></div>
      <div class="txd"><label>Tipo vehículo</label><span>${esc(o.tipoVehiculo || '—')}</span></div>
      <div class="txd"><label>Temperatura</label><span>${esc(o.tipo_unidad || '—')}</span></div>
      <div class="txd"><label>Entrada</label><span class="mono">${o.entrada ? formatHora(o.entrada) : '—'}</span></div>
      ${o.evento === 'SALIDA' ? `<div class="txd"><label>Salida</label><span class="mono">${formatHora(o.salida)}</span></div>` : ''}`;
  }
  return `<details class="tx-item">
    <summary>
      <span class="tx-num mono">${esc(o.tx || '—')}</span>
      <span class="tx-placa mono">${esc(o.placa)}</span>
      <span class="evt ${evtCls}">${o.evento}</span>
      <span class="tx-hora mono" title="${formatHora(o.hora)}">${tiempoRel(o.hora)}</span>
    </summary>
    <div class="tx-detail">${det}</div>
  </details>`;
}

function renderGarita() {
  const conPlaca = CAT.activos('choferes').filter(c => c.placa);
  const opts = '<option value="">— Chofer identificado —</option>' +
    conPlaca.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)} · ${esc(c.placa)}</option>`).join('');
  ['garita-facial-select', 'garita-huella-select'].forEach(id => { const s = document.getElementById(id); if (s) s.innerHTML = opts; });
  const dl = document.getElementById('placas-cabezote');
  if (dl) dl.innerHTML = CAT.activos('vehiculos').map(v => `<option value="${esc(v.placa)}">`).join('');

  // Selectores de catálogo — siempre desde config (no hardcodeados)
  const su = document.getElementById('gm-unidad');
  if (su) su.innerHTML = (state.config.catUnidad || ['Seco']).map(u => `<option>${esc(u)}</option>`).join('');
  const sv = document.getElementById('gm-vehiculo');
  if (sv) sv.innerHTML = (state.config.catVehiculo || ['Rígido']).map(x => `<option>${esc(x)}</option>`).join('');
  const so = document.getElementById('gm-operacion');
  if (so) so.innerHTML = '<option value="descarga">Descarga</option><option value="carga">Carga</option><option value="descarga_carga">Descarga + Carga</option>';

  // Log del día
  const hoy = new Date().toDateString();
  const filas = [];
  state.viajes.filter(v => new Date(v.entrada).toDateString() === hoy).forEach(v =>
    filas.push({ ...v, evento: 'ENTRADA', hora: v.entrada }));
  state.history.forEach(h => {
    if (new Date(h.entrada).toDateString() === hoy) filas.push({ ...h, evento: 'ENTRADA', hora: h.entrada });
    if (h.salida && new Date(h.salida).toDateString() === hoy) filas.push({ ...h, evento: 'SALIDA', hora: h.salida });
  });
  state.rechazos.filter(r => new Date(r.hora).toDateString() === hoy).forEach(r =>
    filas.push({ ...r, evento: 'RECHAZO' }));
  filas.sort((a, b) => new Date(b.hora) - new Date(a.hora));

  // Contadores + filtro de un toque
  const nIn = filas.filter(f => f.evento === 'ENTRADA').length;
  const nOut = filas.filter(f => f.evento === 'SALIDA').length;
  const nRej = filas.filter(f => f.evento === 'RECHAZO').length;
  const stats = document.getElementById('garita-log-stats');
  if (stats) {
    const chip = (id, cls, icono, label, n) => `
      <button class="glstat ${cls} ${garitaLogFiltro === id ? 'on' : ''}" onclick="setGaritaLogFiltro('${id}')">
        <i data-lucide="${icono}"></i> ${label} <strong>${n}</strong></button>`;
    stats.innerHTML =
      chip('todos', 'all', 'list', 'Todos', filas.length) +
      chip('ENTRADA', 'in', 'log-in', 'Entradas', nIn) +
      chip('SALIDA', 'out', 'log-out', 'Salidas', nOut) +
      chip('RECHAZO', 'rej', 'ban', 'Rechazos', nRej);
  }
  const visibles = garitaLogFiltro === 'todos' ? filas : filas.filter(f => f.evento === garitaLogFiltro);

  const log = document.getElementById('garita-log');
  if (log) log.innerHTML = visibles.length ? visibles.map(filaTx).join('')
    : vacio('clipboard-list', garitaLogFiltro === 'todos' ? 'Sin movimientos hoy' : 'Nada con ese filtro hoy', 'Entradas y salidas aparecerán aquí');

  // Lista de salida de un toque (si el modo está activo)
  if (garitaModo === 'salida') renderListosSalida();
  icons();
}

function setGaritaLogFiltro(f) {
  garitaLogFiltro = f;
  renderGarita();
}
