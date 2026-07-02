/* ============================================================
   DESPACHO — Asignación por TURNO + operación en rampa
   MEJORAS v2:
   · Filtro por tipo de vehículo en la cola de turnos
   · badgePrioridad visible en los ítems de turno
   · Destino editable en tarjeta de operación
   ============================================================ */

let _despFiltroVeh = ''; // NUEVO: filtro tipo vehículo cola

function renderRampGrid(containerId, modo) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  let html = '';
  for (let i = 1; i <= numRampas(); i++) {
    const activa = state.docksActive[i - 1];
    const ocup = ocupanteDe(i);
    const sel = (modo === 'asignar' && state.selDock === i) || (modo === 'config' && typeof maestroDockSel !== 'undefined' && maestroDockSel === i);
    let cls = 'available', sub = '<span class="dash">—</span>';
    if (!activa) { cls = 'disabled'; sub = '<span class="off">OFF</span>'; }
    else if (ocup) {
      cls = ocup.estado === EST.CARGANDO ? 'loading' : 'occupied';
      // MEJORA: mostrar tipo de vehículo como tooltip
      sub = `<span class="plate">${esc(ocup.placa)}</span>`;
    }
    else if (sel) { sub = '<span class="ok">✓</span>'; }
    if (sel) cls += ' selected';
    const action = modo === 'asignar' ? 'sel-dock' : modo === 'config' ? 'sel-rampa-maestro' : '';
    const tag = action ? 'button' : 'div';
    const titulo = !activa
      ? ` title="${esc(state.docksMotivo[i] || 'Fuera de servicio')}"`
      : (ocup ? ` title="${esc(ocup.placa)} · ${esc(ocup.tipoVehiculo || '')}"` : '');
    const attr = action ? `data-action="${action}" data-num="${i}"` : '';
    html += `<${tag} class="dock-cell ${cls}" ${attr}${titulo}><strong>${i}</strong>${sub}</${tag}>`;
  }
  grid.innerHTML = html;
}

// Cola de despacho ordenada por turno
function turnoDespacho() {
  return porEstado(EST.DISPONIBLE).sort((a, b) =>
    (prioOrden(a.prioridad) - prioOrden(b.prioridad)) || (new Date(a.entrada) - new Date(b.entrada)));
}

function selectViaje(id) {
  state.selViaje = state.selViaje === id ? null : id;
  state.selDock = null;
  renderDespacho();
}
function selectDock(num) {
  if (!state.docksActive[num - 1]) return showToast('No disponible', 'Rampa fuera de servicio', 'danger');
  if (ocupanteDe(num)) return showToast('Ocupada', 'Seleccione otra rampa', 'danger');
  if (!state.selViaje) return showToast('Atención', 'Seleccione primero un camión disponible', 'warning');
  state.selDock = num;
  renderDespacho();
}
function confirmarAsignacion() {
  if (!state.selViaje || !state.selDock) return;
  const v = buscarViaje(state.selViaje);
  if (!v) return;
  const dock = state.selDock;
  setEstado(v.id, EST.PENDIENTE, { dock, dockTime: new Date().toISOString(), despachoPor: state.currentUserName });
  logAccion('Asignación de rampa', `${v.placa} → Rampa ${dock}`);
  state.selViaje = null; state.selDock = null;
  renderAll();
  showToast('Asignado', `${v.placa} → Rampa ${dock}`, 'success');
}
function iniciarCarga(id) {
  const v = setEstado(id, EST.CARGANDO, { cargaInicio: new Date().toISOString() });
  if (v) { logAccion('Inicio de carga', `${v.placa} · R-${v.dock}`); renderAll(); showToast('Carga iniciada', `${v.placa} en R-${v.dock}`, 'success'); }
}
function finalizarCarga(id) {
  const v = buscarViaje(id);
  if (!v) return;
  const rampa = v.dock;
  const nuevoEstado = state.config.modoSalida === 'patio' ? EST.CARGADO_PATIO : EST.LISTO;
  setEstado(id, nuevoEstado, { cargaFin: new Date().toISOString(), rampaUsada: rampa, dock: null });
  logAccion('Dar salida (fin carga)', `${v.placa} · Rampa ${rampa}`);
  renderAll();
  const msg = nuevoEstado === EST.LISTO ? 'listo para salir por garita' : 'queda cargado en patio';
  showToast('Salida dada', `Rampa ${rampa} liberada · ${v.placa} ${msg}`, 'success');
}
function revertirOp(id) {
  uiConfirm('Revertir operación', 'El camión vuelve a "disponible" y se libera la rampa.', () => {
    const v = setEstado(id, EST.DISPONIBLE, { dock: null, dockTime: null, cargaInicio: null, motivoDespacho: null, motivoDespachoHora: null });
    if (v) { logAccion('Reversión', `${v.placa}`); renderAll(); }
  }, { danger: true, okText: 'Revertir' });
}

function despachoBuscar(val) {
  state._buscoDespacho = (val || '').trim().toLowerCase();
  renderDespacho();
}
// NUEVO: filtro tipo vehículo en despacho
function despachoBuscarVehiculo(val) {
  _despFiltroVeh = val || '';
  renderDespacho();
}

function _filtraDespacho(lista) {
  const q = state._buscoDespacho;
  let r = lista;
  if (q) r = r.filter(v => [v.placa, v.remolque, v.chofer, v.entidad, v.destino, v.tx, v.tipoVehiculo]
    .some(x => (x || '').toString().toLowerCase().includes(q)));
  if (_despFiltroVeh) r = r.filter(v => (v.tipoVehiculo || '') === _despFiltroVeh);
  return r;
}

function renderDespacho() {
  // Selector de filtro tipo vehículo en cola
  const selVehDesp = document.getElementById('despacho-filtro-veh');
  if (selVehDesp) {
    const tipos = state.config.catVehiculo || ['Rígido', 'Contenedor'];
    const opts = [{ value: '', label: 'Todos' }, ...tipos.map(t => ({ value: t, label: t }))];
    selVehDesp.innerHTML = opts.map(o => `<option value="${esc(o.value)}" ${_despFiltroVeh === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  }

  // Turnos disponibles
  const cola = _filtraDespacho(turnoDespacho());
  const lista = document.getElementById('despacho-cola');
  if (lista) {
    renderLista(lista, cola, (v, i) => `
      <div class="turno-item ${agingClass(v.entrada, 'patio')} priority-${v.prioridad} ${state.selViaje === v.id ? 'selected' : ''}"
           data-action="sel-viaje" data-id="${v.id}">
        <span class="turno-badge big">${i + 1}</span>
        <div class="turno-body">
          <div class="turno-head">
            <span class="mono ti-placa">${esc(v.placa)}</span>
            <span class="tipo-chip">${esc(v.tipoVehiculo || '—')}</span>
          </div>
          <div class="turno-meta">${badgeOperacion(v.tipoOperacion)}<span class="muted">${esc(v.destino || v.chofer || '')}</span></div>
          <div class="turno-foot"><span class="muted">Llegó ${formatHora(v.entrada)}</span><span class="mono ti-wait">espera ${calcEspera(v.entrada)}</span></div>
        </div>
      </div>`, vacio('inbox', 'Sin turnos', 'Tráfico marca los disponibles desde Patio'));
  }
  const cc = document.getElementById('despacho-cola-count'); if (cc) cc.textContent = cola.length;

  renderRampGrid('despacho-rampas', 'asignar');

  const off = state.docksActive.filter(a => !a).length;
  const bOff = document.getElementById('despacho-off');
  if (bOff) { bOff.style.display = off ? 'inline-flex' : 'none'; bOff.textContent = `${off} fuera de servicio`; }
  const info = document.getElementById('despacho-selinfo');
  if (info) { const t = buscarViaje(state.selViaje); info.style.display = t ? 'inline-flex' : 'none'; if (t) info.textContent = `Asignando: ${t.placa}`; }
  const box = document.getElementById('despacho-asignar-box');
  if (box) box.style.display = (state.selViaje && state.selDock) ? 'block' : 'none';

  // Operación en rampa
  const enRampa = _filtraDespacho(porEstado(EST.PENDIENTE, EST.CARGANDO).sort((a, b) => (a.dock || 0) - (b.dock || 0)));
  const ops = document.getElementById('despacho-operaciones');
  if (ops) {
    renderLista(ops, enRampa, v => {
      const cargando = v.estado === EST.CARGANDO;
      const t = cargando ? calcEspera(v.cargaInicio) : calcEspera(v.dockTime);
      return `
      <div class="op-card ${cargando ? 'is-loading' : ''}">
        <div class="op-card-head">
          <span class="op-placa">${esc(v.placa)}</span>
          <span class="rampa-tag">RAMPA ${v.dock}</span>
        </div>
        <div class="op-card-tags">
          <span class="tipo-chip">${esc(v.tipoVehiculo || '—')}</span>
          ${badgeOperacion(v.tipoOperacion)}
          ${cargando ? '<span class="state-pill cargando">CARGANDO</span>' : '<span class="state-pill pendiente">PENDIENTE</span>'}
          ${v.motivoDespacho ? `<span class="demora-badge sm"><i data-lucide="alarm-clock"></i>${esc(v.motivoDespacho)}</span>` : ''}
        </div>
        <div class="op-info">
          <div class="op-f"><label>Cola</label><span class="mono">${esc(v.remolque || 'N/A')}</span></div>
          <div class="op-f"><label>Chofer</label><span class="op-chofer">${esc(v.chofer || '—')}</span></div>
          <div class="op-f"><label>Transportista</label><span>${esc(v.entidad || '—')}</span></div>
          <div class="op-f"><label>Destino / origen</label><input class="op-destino" value="${esc(v.destino || '')}" placeholder="Escribir…" onchange="setViajeCampo('${v.id}','destino',this.value)"></div>
          <div class="op-f"><label>Transacción</label><span class="mono op-tx">${esc(v.tx || '—')}</span></div>
          <div class="op-f"><label>En planta</label><span class="mono op-timer">${calcEspera(v.entrada)}</span></div>
          <div class="op-f"><label>${cargando ? 'En esta etapa · cargando' : 'En esta etapa · esperando'}</label><span class="mono op-timer">${t}</span></div>
        </div>
        <div class="op-actions">
          ${cargando
            ? `<button class="btn btn-salida" data-action="fin-carga" data-id="${v.id}"><i data-lucide="log-out"></i> Dar salida</button>`
            : `<button class="btn btn-warn" data-action="ini-carga" data-id="${v.id}"><i data-lucide="play"></i> Iniciar carga</button>`}
          <button class="btn btn-ghost op-demora" data-action="registrar-demora" data-id="${v.id}" data-etapa="despacho"><i data-lucide="alarm-clock"></i> Demora</button>
          <button class="btn btn-ghost op-revertir" data-action="revertir" data-id="${v.id}">Revertir</button>
        </div>
      </div>`;
    }, vacio('package', 'Sin operaciones activas', 'Asigna una rampa a un camión disponible', 'span-2'));
  }
  icons();
}

/* ---------- Asignación por lote ---------- */
function asignarLote(n) {
  const libres = [];
  for (let r = 1; r <= numRampas(); r++) {
    if (state.docksActive[r - 1] && !ocupanteDe(r)) libres.push(r);
  }
  for (let i = libres.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [libres[i], libres[j]] = [libres[j], libres[i]];
  }
  const dispo = turnoDespacho();
  const patio = porEstado(EST.PATIO).sort((a, b) =>
    (prioOrden(a.prioridad) - prioOrden(b.prioridad)) || (new Date(a.entrada) - new Date(b.entrada)));
  const cola = [...dispo, ...patio];

  let asignados = 0;
  for (const v of cola) {
    if (asignados >= n || !libres.length) break;
    if (v.estado === EST.PATIO) {
      setEstado(v.id, EST.DISPONIBLE, { dispoTime: new Date().toISOString(), traficoPor: 'Sistema · lote' });
    }
    const rampa = libres.shift();
    setEstado(v.id, EST.PENDIENTE, { dock: rampa, dockTime: new Date().toISOString(), despachoPor: state.currentUserName });
    asignados++;
  }
  state.selViaje = null; state.selDock = null;
  if (asignados) logAccion('Asignación por lote', `${asignados} a rampa`);
  renderAll();
  if (!asignados) {
    showToast('Nada que asignar', libres.length === 0 ? 'No hay rampas libres' : 'No hay camiones en cola', 'warning');
  } else {
    showToast('Rampas asignadas', `${asignados} a rampa` + (asignados < n ? ' · tope por rampas/cola' : ''), 'success');
  }
}

/* ---------- Operación por lote ---------- */
function iniciarCargaTodos() {
  const pend = porEstado(EST.PENDIENTE);
  if (!pend.length) return showToast('Nada que iniciar', 'No hay camiones pendientes en rampa', 'warning');
  const now = new Date().toISOString();
  pend.forEach(v => setEstado(v.id, EST.CARGANDO, { cargaInicio: now }));
  logAccion('Inicio de carga (lote)', `${pend.length} camión(es)`);
  renderAll();
  showToast('Carga iniciada', `${pend.length} camión(es) en carga`, 'success');
}
function darSalidaTodos() {
  const carg = porEstado(EST.CARGANDO);
  if (!carg.length) return showToast('Nada que despachar', 'No hay camiones cargando', 'warning');
  const now = new Date().toISOString();
  const nuevo = state.config.modoSalida === 'patio' ? EST.CARGADO_PATIO : EST.LISTO;
  carg.forEach(v => setEstado(v.id, nuevo, { cargaFin: now, rampaUsada: v.dock, dock: null }));
  logAccion('Dar salida (lote)', `${carg.length} despachado(s)`);
  renderAll();
  showToast('Salida dada', `${carg.length} despachado(s)`, 'success');
}
