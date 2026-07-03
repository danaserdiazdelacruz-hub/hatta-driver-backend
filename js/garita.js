/* ============================================================
   GARITA — Control de acceso (entrada y salida)
   MEJORAS v2:
   · Selectores de catálogo poblados siempre desde config (no depende
     de race condition con renderGarita)
   · tipoVehiculo completo desde catálogo editable
   ============================================================ */

let camStream = null;
let garitaModo = 'entrada';

function setGaritaModo(modo) {
  garitaModo = modo;
  document.querySelectorAll('.garita-mode .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.modo === modo));
  const acc = document.getElementById('garita-access');
  if (acc) acc.classList.toggle('salida', modo === 'salida');
  const box = document.getElementById('garita-scan-result');
  if (box) box.style.display = 'none';
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
  document.getElementById('gm-cabezote').focus();
}

function rechazarIngreso() {
  const placa = (document.getElementById('gm-cabezote').value || '').toUpperCase().trim();
  if (!placa) return showToast('Falta la placa', 'Escriba la placa cabezote para rechazar', 'warning');
  uiPrompt(`Rechazar ingreso de ${placa}`, { label: 'Motivo del rechazo', value: 'Documentación incompleta' }, (motivo) => {
    const rechazo = { id: uid(), placa, motivo: motivo || 'Sin motivo', hora: new Date().toISOString(), por: state.currentUserName };
    state.rechazos.unshift(rechazo);
    if (state.rechazos.length > 200) state.rechazos = state.rechazos.slice(0, 200);
    api.rechazos.insertar(rechazo).catch(() => {});
    const i = document.getElementById('gm-cabezote'); if (i) i.value = '';
    renderGarita();
    scanFeedback('warn', `RECHAZADO · ${placa}`, motivo || 'Sin motivo');
  });
}

/* ---- Feedback + cámara ---- */
function scanFeedback(tipo, titulo, sub) {
  const box = document.getElementById('garita-scan-result');
  if (box) {
    box.className = `scan-result ${tipo}`;
    const icon = tipo === 'in' ? 'log-in' : tipo === 'out' ? 'log-out' : 'alert-triangle';
    box.innerHTML = `<i data-lucide="${icon}"></i><div><strong>${esc(titulo)}</strong><span>${esc(sub)}</span></div>`;
    box.style.display = 'flex';
    icons();
  }
  showToast(titulo, sub, tipo === 'warn' ? 'warning' : 'success');
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
      <span class="tx-hora mono">${formatHora(o.hora)}</span>
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

  const log = document.getElementById('garita-log');
  if (log) log.innerHTML = filas.length ? filas.map(filaTx).join('') : vacio('clipboard-list', 'Sin movimientos hoy', 'Entradas y salidas aparecerán aquí');
  const cnt = document.getElementById('garita-tx-count');
  if (cnt) cnt.textContent = filas.length;
  icons();
}
