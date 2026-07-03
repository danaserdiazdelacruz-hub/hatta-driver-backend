/* ============================================================
   CONFIG — Rampas (activar/desactivar) + ajustes del sistema
   Vive dentro de la pestaña MAESTRO.
   ============================================================ */

/* Guardado centralizado de config — con error VISIBLE.
   Nunca usar api.config.guardar directo con catch vacío:
   si Supabase falla, el usuario debe enterarse. */
function guardarConfig() {
  api.config.guardar(state.config).catch(err => {
    console.error('[HATTA] config.guardar:', err);
    showToast('No se guardó la configuración', 'Revisa tu conexión e inténtalo de nuevo', 'danger');
  });
}


let maestroDockSel = null;

function seleccionarRampaMaestro(num) {
  maestroDockSel = num;
  renderRampGrid('config-rampas', 'config');
  renderDetalleRampa(num);
  if (window.innerWidth <= 820) {
    const p = document.getElementById('rampa-detalle');
    if (p) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function renderDetalleRampa(num) {
  const panel = document.getElementById('rampa-detalle');
  if (!panel) return;
  if (!num) {
    panel.innerHTML = '<div class="rd-empty"><i data-lucide="mouse-pointer-click"></i><p>Selecciona una rampa del mapa para ver su detalle</p></div>';
    icons(); return;
  }
  const activa = state.docksActive[num - 1];
  const ocup = ocupanteDe(num);
  const motivo = state.docksMotivo[num] || '';
  const estadoCls = !activa ? 'off' : (ocup ? 'ocupada' : 'libre');
  const estadoTxt = !activa ? 'Fuera de servicio'
    : (ocup ? (ocup.estado === EST.CARGANDO ? 'Ocupada · cargando' : 'Ocupada · pendiente') : 'Libre');

  let body;
  if (ocup) {
    const t = ocup.estado === EST.CARGANDO ? calcEspera(ocup.cargaInicio) : calcEspera(ocup.dockTime);
    body = `<div class="rd-field"><label>Placa</label><span class="mono">${esc(ocup.placa)}</span></div>
      <div class="rd-field"><label>Chofer</label><span>${esc(ocup.chofer || '—')}</span></div>
      <div class="rd-field"><label>Operación</label><span>${badgeOperacion(ocup.tipoOperacion)}</span></div>
      <div class="rd-field"><label>Tiempo</label><span class="mono">${t}</span></div>
      <div class="rd-actions"><button class="btn btn-ghost" style="flex:1" onclick="switchTab('despacho')"><i data-lucide="external-link"></i> Ver en Despacho</button></div>`;
  } else if (!activa) {
    body = `<div class="rd-field"><label>Motivo</label><span>${esc(motivo || 'Sin motivo')}</span></div>
      <div class="rd-actions"><button class="btn btn-primary" style="flex:1" onclick="activarRampa(${num})"><i data-lucide="power"></i> Reactivar rampa</button></div>`;
  } else {
    const opts = state.config.motivosRampa.map(mo => `<option value="${esc(mo)}">${esc(mo)}</option>`).join('');
    body = `<p class="muted" style="margin:2px 0 4px">Rampa libre y disponible.</p>
      <label class="rd-mini-label">Motivo para desactivar</label>
      <select id="rd-motivo-sel" class="form-input sm" style="margin:6px 0 0;width:100%">${opts}</select>
      <div class="rd-actions"><button class="btn btn-danger" style="flex:1" onclick="desactivarRampa(${num})"><i data-lucide="ban"></i> Desactivar rampa</button></div>`;
  }
  panel.innerHTML = `<div class="rd-header"><span class="rd-num">Rampa ${num}</span><span class="rd-estado ${estadoCls}">${estadoTxt}</span></div><div class="rd-body">${body}</div>`;
  icons();
}

function desactivarRampa(num) {
  if (ocupanteDe(num)) return showToast('Error', 'Rampa ocupada, no se puede desactivar', 'danger');
  const sel = document.getElementById('rd-motivo-sel');
  const motivo = (sel && sel.value) || 'Fuera de servicio';
  state.docksActive[num - 1] = false;
  state.docksMotivo[num] = motivo;
  api.rampas.actualizarEstado(num, false, motivo).catch(() => {});
  logAccion('Rampa fuera de servicio', `Rampa ${num}: ${motivo}`);
  renderRampasConfig();
  showToast('Rampa fuera de servicio', `Rampa ${num}: ${motivo}`, 'warning');
}

function activarRampa(num) {
  delete state.docksMotivo[num];
  state.docksActive[num - 1] = true;
  api.rampas.actualizarEstado(num, true, null).catch(() => {});
  logAccion('Rampa activada', `Rampa ${num}`);
  renderRampasConfig();
  showToast('Rampa activada', `Rampa ${num} disponible`, 'success');
}

function renderRampasConfig() {
  renderRampGrid('config-rampas', 'config');
  const activas = state.docksActive.filter(a => a).length;
  const ocupadas = porEstado(EST.PENDIENTE, EST.CARGANDO).length;
  const c = document.getElementById('config-activas-count');
  if (c) c.textContent = `${activas}/${numRampas()} activas · ${ocupadas} en uso`;
  renderDetalleRampa(maestroDockSel);
  const inpN = document.getElementById('input-num-rampas');
  if (inpN && document.activeElement !== inpN) inpN.value = numRampas();
  const chips = document.getElementById('motivos-rampa-chips');
  if (chips) chips.innerHTML = state.config.motivosRampa.map((mo, i) =>
    `<span class="chip">${esc(mo)}<button data-action="del-motivo-rampa" data-i="${i}" title="Quitar">×</button></span>`).join('') || '<span class="muted">Sin motivos</span>';
}
/* ---------- Total de rampas por empresa ----------
   Lógica fuerte: nunca permite reducir por debajo de una rampa
   ocupada, y desactivadas fuera del nuevo rango pierden motivo. */
function setNumRampas(valor) {
  const n = parseInt(valor, 10);
  if (!n || n < 1 || n > HATTA.MAX_RAMPAS)
    return showToast('Valor inválido', `Debe estar entre 1 y ${HATTA.MAX_RAMPAS}`, 'warning');

  const ocupadas = state.viajes.filter(v => v.dock != null).map(v => v.dock);
  const maxOcupada = ocupadas.length ? Math.max(...ocupadas) : 0;
  if (n < maxOcupada)
    return showToast('No permitido', `La rampa ${maxOcupada} está ocupada. Libérala antes de reducir.`, 'danger');

  const prev = numRampas();
  if (n === prev) return;

  const anteriores = state.docksActive;
  state.docksActive = Array(n).fill(true);
  anteriores.forEach((v, i) => { if (i < n) state.docksActive[i] = v; });
  Object.keys(state.docksMotivo).forEach(k => { if (parseInt(k, 10) > n) delete state.docksMotivo[k]; });

  state.config.numRampas = n;
  guardarConfig();
  logAccion('Configuración de rampas', `Total de rampas: ${prev} → ${n}`);
  showToast('Rampas actualizadas', `La empresa ahora opera ${n} rampas`, 'success');
  maestroDockSel = null;
  renderRampasConfig();
  renderAll();
}
function aplicarNumRampas(e) {
  e.preventDefault();
  setNumRampas(e.target.n_rampas.value);
}

function addMotivoRampa(e) {
  e.preventDefault();
  const v = (e.target.motivo.value || '').trim();
  if (!v) return;
  if (!state.config.motivosRampa.includes(v)) state.config.motivosRampa.push(v);
  guardarConfig();
  e.target.reset();
  renderRampasConfig();
}
function delMotivoRampa(i) {
  if (state.config.motivosRampa.length <= 1) return showToast('Atención', 'Deja al menos un motivo', 'warning');
  state.config.motivosRampa.splice(i, 1);
  guardarConfig();
  renderRampasConfig();
}

function setModoSalida(modo) {
  state.config.modoSalida = modo;
  guardarConfig();
  renderAjustes();
  showToast('Ajuste guardado', modo === 'garita' ? 'Al cargar: listo para salir por garita' : 'Al cargar: queda cargado en patio', 'success');
}
function renderAjustes() {
  const cont = document.getElementById('config-ajustes');
  if (!cont) return;
  const m = state.config.modoSalida;
  const etqSLA = [['patio', 'Patio (espera)'], ['carga', 'Carga (en rampa)'], ['salida', 'Salida (espera)'], ['total', 'Total en el centro']];
  const slaRows = etqSLA.map(([k, lbl]) => {
    const s = (state.config.sla && state.config.sla[k]) || { warn: 30, danger: 60 };
    return `<div class="sla-grid-row"><span class="sla-et">${lbl}</span>` +
      `<input type="number" min="1" id="sla-${k}-warn" class="form-input sm sla-num" value="${s.warn}" onchange="setSLA()">` +
      `<input type="number" min="2" id="sla-${k}-danger" class="form-input sm sla-num" value="${s.danger}" onchange="setSLA()"></div>`;
  }).join('');
  const chips = state.config.motivosDemora.map((mo, i) =>
    `<span class="chip">${esc(mo)}<button data-action="del-motivo" data-i="${i}" title="Quitar">×</button></span>`).join('');
  cont.innerHTML = `
    <label class="cfg-label">Al terminar la carga, el camión:</label>
    <div class="seg">
      <button class="seg-btn ${m === 'garita' ? 'active' : ''}" onclick="setModoSalida('garita')"><i data-lucide="log-out"></i> Listo para salir</button>
      <button class="seg-btn ${m === 'patio' ? 'active' : ''}" onclick="setModoSalida('patio')"><i data-lucide="warehouse"></i> Cargado en patio</button>
    </div>
    <hr class="cfg-sep">
    <label class="cfg-label">Tiempos límite por etapa (semáforo)</label>
    <p class="cfg-hint">El cronómetro pasa a amarillo y luego a rojo al superar estos minutos. Cada etapa tiene su propio ritmo, para no dar falsas alarmas.</p>
    <div class="sla-grid">
      <div class="sla-grid-row sla-grid-head"><span></span><span><span class="aging-dot age-warn-dot"></span> Amarillo (min)</span><span><span class="aging-dot age-danger-dot"></span> Rojo (min)</span></div>
      ${slaRows}
    </div>
    <hr class="cfg-sep">
    <label class="cfg-label">Motivos de demora</label>
    <div class="motivos-chips">${chips || '<span class="muted">Sin motivos</span>'}</div>
    <form onsubmit="addMotivo(event)" class="motivo-add">
      <input name="motivo" class="form-input sm" placeholder="Nuevo motivo" style="flex:1">
      <button type="submit" class="btn btn-primary btn-sm">Agregar</button>
    </form>`;
  icons();
}
function setSLA() {
  const etapas = ['patio', 'carga', 'salida', 'total'];
  const nueva = {};
  for (const et of etapas) {
    const w = parseInt(document.getElementById('sla-' + et + '-warn').value, 10);
    const d = parseInt(document.getElementById('sla-' + et + '-danger').value, 10);
    if (isNaN(w) || isNaN(d) || w < 1 || d <= w) {
      renderAjustes();
      return showToast('Tiempo inválido', 'En cada etapa, el rojo debe ser mayor que el amarillo', 'warning');
    }
    nueva[et] = { warn: w, danger: d };
  }
  state.config.sla = nueva;
  api.config.guardar(state.config).then(() =>
    showToast('Tiempos guardados', 'Semáforo por etapa actualizado', 'success')
  );
  renderAll();
}
function addMotivo(e) {
  e.preventDefault();
  const v = (e.target.motivo.value || '').trim();
  if (!v) return;
  if (!state.config.motivosDemora.includes(v)) state.config.motivosDemora.push(v);
  guardarConfig();
  e.target.reset();
  renderAjustes();
}
function delMotivo(i) {
  state.config.motivosDemora.splice(i, 1);
  guardarConfig();
  renderAjustes();
}

/* ---------- Catálogos de clasificación (Garita/Patio) ---------- */
function renderClasifConfig() {
  const chips = (arr, del) => arr.map((x, i) =>
    `<span class="chip">${esc(x)}<button onclick="${del}(${i})" title="Quitar">×</button></span>`).join('') || '<span class="muted">Vacío</span>';
  const u = document.getElementById('cat-unidad-chips');
  if (u) u.innerHTML = chips(state.config.catUnidad, 'delCatUnidad');
  const ve = document.getElementById('cat-vehiculo-chips');
  if (ve) ve.innerHTML = chips(state.config.catVehiculo, 'delCatVehiculo');
  const t = document.getElementById('sel-patio-toggles');
  if (t) {
    const sp = state.config.selPatio;
    const row = (k, lab) => `<label class="sel-toggle"><input type="checkbox" ${sp[k] ? 'checked' : ''} onchange="toggleSelPatio('${k}',this.checked)"><span>${lab}</span><em>${sp[k] ? 'editable' : 'solo lectura'}</em></label>`;
    t.innerHTML = row('unidad', 'Temperatura') + row('vehiculo', 'Vehículo') + row('operacion', 'Operación');
  }
  icons();
}
function _addCat(e, arr) { e.preventDefault(); const v = (e.target.v.value || '').trim(); if (v && !arr.includes(v)) arr.push(v); e.target.reset(); guardarConfig(); renderClasifConfig(); renderAll(); }
function addCatUnidad(e) { _addCat(e, state.config.catUnidad); }
function addCatVehiculo(e) { _addCat(e, state.config.catVehiculo); }
function delCatUnidad(i) { if (state.config.catUnidad.length <= 1) return showToast('Atención', 'Deja al menos un valor', 'warning'); state.config.catUnidad.splice(i, 1); guardarConfig(); renderClasifConfig(); renderAll(); }
function delCatVehiculo(i) { if (state.config.catVehiculo.length <= 1) return showToast('Atención', 'Deja al menos un valor', 'warning'); state.config.catVehiculo.splice(i, 1); guardarConfig(); renderClasifConfig(); renderAll(); }
function toggleSelPatio(k, val) { state.config.selPatio[k] = !!val; guardarConfig(); renderClasifConfig(); renderAll(); }

/* ---------- Bitácora de auditoría (vista) ---------- */
function _bitaFecha(ts) { const d = new Date(ts); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
function _bitaHora(ts) { return new Date(ts).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

function renderBitacora() {
  const tb = document.getElementById('tabla-bitacora');
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  set('nav-c-bita', (state.bitacora || []).length);
  set('bita-modbar-count', (state.bitacora || []).length);
  if (!tb) return;
  const q = ((document.getElementById('bita-q') || {}).value || '').toLowerCase().trim();
  let rows = state.bitacora || [];
  if (q) rows = rows.filter(b => (`${b.usuario} ${b.accion} ${b.detalle}`).toLowerCase().includes(q));
  renderLista(tb, rows.slice(0, HATTA.ui.bitacoraLimit), b => `
    <tr>
      <td class="mono">${_bitaFecha(b.ts)}</td>
      <td class="mono">${_bitaHora(b.ts)}</td>
      <td><strong>${esc(b.usuario)}</strong></td>
      <td><span class="bita-accion">${esc(b.accion)}</span></td>
      <td class="muted">${esc(b.detalle)}</td>
    </tr>`, `<tr><td colspan="5" class="empty">${q ? 'Nada coincide' : 'Sin registros aún'}</td></tr>`);
}

function exportarBitacora() {
  const rows = state.bitacora || [];
  if (!rows.length) return showToast('Bitácora vacía', 'Nada que exportar', 'warning');
  const headers = ['Fecha', 'Hora', 'Usuario', 'Rol', 'Acción', 'Detalle'];
  const filas = rows.map(b => [_bitaFecha(b.ts), _bitaHora(b.ts), b.usuario, b.rol || '', b.accion, b.detalle]);
  descargarCSV(`HATTA_Bitacora_${_dateKey ? _dateKey(new Date().toISOString()) : new Date().toISOString().slice(0, 10)}.csv`, headers, filas);
  showToast('Bitácora exportada', `${rows.length} registros`, 'success');
}
