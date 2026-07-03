/* ============================================================
   HISTORIAL — v3.0 OPTIMIZADO
   MEJORAS:
   · Panel de resumen estadístico gerencial (KPIs arriba de tabla)
   · Filtros de fecha (desde/hasta) para análisis por período
   · Exportación XLSX profesional con 3 hojas (Datos + Resumen + Demoras)
   · Vista tipo card en móvil (< 768px) para tablas anchas
   · Búsqueda debounced para rendimiento
   · Indicadores de SLA por fila (color semáforo)
   · Toggle de columnas para el gerente
   ============================================================ */
let histSort = { k: 'entrada', dir: 'desc' };
let histFilters = {};
let histPage = 1;
const HIST_PAGE_SIZE = HATTA.ui.historialPageSize;
let histFechaDesde = '';
let histFechaHasta = '';
let histColVisible = { motivos: true }; // toggle de columnas

// Búsqueda debounced (rendimiento)
const histBuscarDebounced = debounce(function(val) {
  renderHistorial();
}, 250);

function _val(id) { const e = document.getElementById(id); return e ? e.value : ''; }

function _dateKey(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _dateDisplay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function _filterVal(k, h) {
  switch (k) {
    case 'placa': return (h.placa || '').toUpperCase();
    case 'chofer': return h.chofer || '—';
    case 'op': return h.tipoOperacion || 'descarga';
    case 'turno': return h.turno || '—';
    case 'entrada': return _dateKey(h.entrada);
    case 'motpatio': return h.motivoPatio || '';
    case 'motdesp': return h.motivoDespacho || '';
    case 'motsal': return h.motivoSalida || '';
    case 'tipoveh': return h.tipoVehiculo || '';
    default: return '';
  }
}

function _sortVal(k, h) {
  switch (k) {
    case 'tx': return (h.tx || '').toLowerCase();
    case 'placa': return (h.placa || '').toLowerCase();
    case 'chofer': return (h.chofer || '').toLowerCase();
    case 'op': return h.tipoOperacion || '';
    case 'turno': return h.turno || '';
    case 'entrada': return h.entrada ? new Date(h.entrada).getTime() : null;
    case 'tpatio': return minEntre(h.entrada, h.dockTime);
    case 'tdesp': return minEntre(h.dockTime, h.cargaFin);
    case 'tsal': return minEntre(h.cargaFin, h.salida);
    case 'total': return minEntre(h.entrada, h.salida);
    case 'motpatio': return (h.motivoPatio || '').toLowerCase();
    case 'motdesp': return (h.motivoDespacho || '').toLowerCase();
    case 'motsal': return (h.motivoSalida || '').toLowerCase();
    case 'tipoveh': return (h.tipoVehiculo || '').toLowerCase();
    default: return '';
  }
}

function _histBlob(h) {
  return [h.tx, h.placa, h.remolque, h.cedula, h.chofer, h.traficoPor, h.despachoPor,
    h.garitaEntradaPor, h.garitaSalidaPor, h.turno, h.tipoOperacion, h.tipoVehiculo,
    h.motivoPatio, h.motivoDespacho, h.motivoSalida,
    _dateKey(h.entrada), _dateDisplay(h.entrada), _dateKey(h.salida), _dateDisplay(h.salida)]
    .filter(Boolean).join(' ').toLowerCase();
}

/* ---------- Orden ---------- */
function ordenarHist(k, dir) {
  if (dir) histSort = { k, dir };
  else if (histSort.k === k) histSort.dir = histSort.dir === 'asc' ? 'desc' : 'asc';
  else histSort = { k, dir: 'asc' };
  histPage = 1;
  cerrarFiltroHist();
  renderHistorial();
}

/* ---------- Filtro por columna ---------- */
function abrirFiltroHist(e, k) {
  e.stopPropagation();
  const pop = document.getElementById('hist-pop');
  if (!pop) return;

  const conteos = new Map();
  state.history.forEach(h => { const v = _filterVal(k, h); if (v) conteos.set(v, (conteos.get(v) || 0) + 1); });
  const vals = [...conteos.entries()].sort((a, b) =>
    k === 'entrada' ? a[0].localeCompare(b[0]) : a[0].localeCompare(b[0], 'es', { numeric: true }));

  const cur = histFilters[k];
  const curSet = cur ? new Set(cur) : null;
  const labelMap = {
    op: 'operación', placa: 'placa', chofer: 'chofer', turno: 'turno',
    entrada: 'fecha', motpatio: 'motivo patio', motdesp: 'motivo despacho',
    motsal: 'motivo salida', tipoveh: 'tipo vehículo',
  };
  const label = labelMap[k] || k;

  if (!vals.length) {
    pop.innerHTML = `<div class="pop-empty">Sin valores para filtrar</div>`;
  } else {
    const items = vals.map(([v, count]) => {
      const display = k === 'entrada' ? _dateDisplay(v + 'T00:00:00') : v;
      const checked = (!curSet || curSet.has(v)) ? 'checked' : '';
      return `<label class="pop-item"><input type="checkbox" value="${esc(v)}" ${checked}>
        <span class="pop-val">${esc(display)}</span><span class="pop-count">${count}</span></label>`;
    }).join('');
    const buscador = vals.length > 8
      ? `<input type="text" class="pop-search" placeholder="Buscar…" oninput="filtrarPopList(this.value)">` : '';
    pop.innerHTML = `
      <div class="pop-header"><strong>Filtrar ${label}</strong><button class="pop-close" onclick="cerrarFiltroHist()">×</button></div>
      <div class="pop-sort">
        <button onclick="ordenarHist('${k}','asc')">↑ A→Z</button>
        <button onclick="ordenarHist('${k}','desc')">↓ Z→A</button>
      </div>
      ${buscador}
      <div class="pop-tools"><button onclick="popMarcar(true)">Todos</button><button onclick="popMarcar(false)">Ninguno</button></div>
      <div class="pop-list">${items}</div>
      <div class="pop-actions"><button class="btn-mini" onclick="quitarFiltroHist('${k}')">Quitar</button><button class="btn-mini primary" onclick="aplicarFiltroHist('${k}')">Aplicar</button></div>`;
  }
  pop.style.display = 'block';
  pop.dataset.k = k;
  const r = e.currentTarget.getBoundingClientRect();
  requestAnimationFrame(() => {
    const pw = pop.offsetWidth || 260;
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.left = Math.min(Math.max(r.left, 8), window.innerWidth - pw - 8) + 'px';
  });
}
function filtrarPopList(q) {
  q = (q || '').toLowerCase();
  document.querySelectorAll('#hist-pop .pop-item').forEach(it => {
    const v = it.querySelector('.pop-val').textContent.toLowerCase();
    it.style.display = v.includes(q) ? 'flex' : 'none';
  });
}
function popMarcar(estado) {
  document.querySelectorAll('#hist-pop .pop-item').forEach(it => {
    if (it.style.display !== 'none') it.querySelector('input').checked = estado;
  });
}
function aplicarFiltroHist(k) {
  const boxes = [...document.querySelectorAll('#hist-pop .pop-list input')];
  const checked = boxes.filter(b => b.checked).map(b => b.value);
  if (checked.length === 0 || checked.length === boxes.length) delete histFilters[k];
  else histFilters[k] = checked;
  histPage = 1;
  cerrarFiltroHist();
  renderHistorial();
}
function quitarFiltroHist(k) { delete histFilters[k]; histPage = 1; cerrarFiltroHist(); renderHistorial(); }
function cerrarFiltroHist() { const p = document.getElementById('hist-pop'); if (p) p.style.display = 'none'; }

function limpiarBusquedaHist() {
  const q = document.getElementById('hist-q'); if (q) q.value = '';
  histFilters = {}; histSort = { k: 'entrada', dir: 'desc' }; histPage = 1;
  histFechaDesde = ''; histFechaHasta = '';
  const fd = document.getElementById('hist-desde'); if (fd) fd.value = '';
  const fh = document.getElementById('hist-hasta'); if (fh) fh.value = '';
  cerrarFiltroHist(); renderHistorial();
}

function _highlight(text, q) {
  const t = (text == null ? '' : String(text));
  if (!q) return esc(t);
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return esc(t).replace(new RegExp('(' + safe + ')', 'gi'), '<mark>$1</mark>');
}

/* ---------- Panel de resumen estadístico (gerencial) ---------- */
function renderHistorialResumen(data) {
  const panel = document.getElementById('hist-summary');
  if (!panel) return;

  if (!data.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  const sla = state.config.sla || {};
  const total = data.length;
  const conSalida = data.filter(h => h.salida);
  const tpVals = conSalida.map(h => minEntre(h.entrada, h.dockTime)).filter(v => v != null);
  const tcVals = conSalida.map(h => minEntre(h.dockTime, h.cargaFin)).filter(v => v != null);
  const tsVals = conSalida.map(h => minEntre(h.cargaFin, h.salida)).filter(v => v != null);
  const ttVals = conSalida.map(h => minEntre(h.entrada, h.salida)).filter(v => v != null);

  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const med = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
  const pct95 = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] || 0; };

  const slaOk = (vals, etapa) => {
    const s = sla[etapa] || { warn: 30, danger: 60 };
    return vals.filter(v => v < s.warn).length;
  };

  panel.innerHTML = `
    <div class="hist-summary-grid">
      <div class="hs-card">
        <div class="hs-val">${total}</div>
        <div class="hs-lbl">Total Registros</div>
      </div>
      <div class="hs-card">
        <div class="hs-val">${fmtMin(avg(ttVals))}</div>
        <div class="hs-lbl">T. Prom. Total</div>
      </div>
      <div class="hs-card">
        <div class="hs-val">${fmtMin(med(ttVals))}</div>
        <div class="hs-lbl">T. Mediana Total</div>
      </div>
      <div class="hs-card">
        <div class="hs-val">${fmtMin(pct95(ttVals))}</div>
        <div class="hs-lbl">Percentil 95</div>
      </div>
      <div class="hs-card hs-sla">
        <div class="hs-val ${ttVals.length ? (avg(ttVals) >= (sla.total || {}).danger ? 'dur-danger' : avg(ttVals) >= (sla.total || {}).warn ? 'dur-warn' : 'dur-ok') : ''}">${ttVals.length ? Math.round(slaOk(ttVals, 'total') / ttVals.length * 100) : 0}%</div>
        <div class="hs-lbl">Cumplimiento SLA</div>
      </div>
      <div class="hs-card">
        <div class="hs-val">${fmtMin(avg(tpVals))}</div>
        <div class="hs-lbl">T. Patio Prom.</div>
      </div>
      <div class="hs-card">
        <div class="hs-val">${fmtMin(avg(tcVals))}</div>
        <div class="hs-lbl">T. Carga Prom.</div>
      </div>
      <div class="hs-card">
        <div class="hs-val">${fmtMin(avg(tsVals))}</div>
        <div class="hs-lbl">T. Salida Prom.</div>
      </div>
    </div>`;
}

/* ---------- Render ---------- */
function renderHistorial() {
  const tb = document.getElementById('tabla-historial');
  if (!tb) return;
  const qRaw = (_val('hist-q') || '').trim();
  const q = qRaw.toLowerCase();

  // Auto-datos de fecha
  histFechaDesde = _val('hist-desde');
  histFechaHasta = _val('hist-hasta');

  const sug = document.getElementById('hist-suggest');
  if (sug) {
    const set = new Set();
    state.history.forEach(h => [h.placa, h.chofer, h.tx, h.traficoPor, h.despachoPor, h.garitaEntradaPor, h.tipoVehiculo]
      .forEach(x => { if (x) set.add(x); }));
    sug.innerHTML = [...set].slice(0, 150).map(v => `<option value="${esc(v)}">`).join('');
  }
  const clr = document.getElementById('hist-clear'); if (clr) clr.style.display = q ? 'flex' : 'none';

  let data = state.history.filter(h => !q || _histBlob(h).includes(q));

  // Filtro de fecha
  if (histFechaDesde) data = data.filter(h => h.entrada && _dateKey(h.entrada) >= histFechaDesde);
  if (histFechaHasta) data = data.filter(h => h.entrada && _dateKey(h.entrada) <= histFechaHasta);

  Object.keys(histFilters).forEach(k => {
    const allowed = histFilters[k];
    if (allowed && allowed.length) { const s = new Set(allowed); data = data.filter(h => s.has(_filterVal(k, h))); }
  });

  const sk = histSort.k, dir = histSort.dir === 'asc' ? 1 : -1;
  data = data.slice().sort((a, b) => {
    const va = _sortVal(sk, a), vb = _sortVal(sk, b);
    const an = va === null || va === undefined, bn = vb === null || vb === undefined;
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  // Indicadores de ordenamiento y filtros activos
  ['tx', 'placa', 'chofer', 'op', 'turno', 'entrada', 'tpatio', 'motpatio', 'tdesp', 'motdesp', 'tsal', 'motsal', 'total', 'tipoveh'].forEach(k => {
    const ind = document.getElementById('si-' + k);
    if (ind) ind.textContent = histSort.k === k ? (histSort.dir === 'asc' ? '▲' : '▼') : '';
    const hf = document.getElementById('hf-' + k);
    if (hf) hf.classList.toggle('active', !!histFilters[k]);
  });

  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / HIST_PAGE_SIZE));
  histPage = Math.min(histPage, totalPages);
  const start = (histPage - 1) * HIST_PAGE_SIZE;
  const pageData = data.slice(start, start + HIST_PAGE_SIZE);

  const cnt = document.getElementById('hist-count'); if (cnt) cnt.textContent = total;

  // Render resumen estadístico
  renderHistorialResumen(data);

  // Detectar si es vista móvil
  const isMobile = window.innerWidth <= 768;

  if (!data.length) {
    const msg = state.history.length ? 'Ningún registro cumple ese criterio.' : 'Aún no hay salidas registradas.';
    tb.innerHTML = `<tr><td colspan="17" class="hist-empty"><div class="he-box"><i data-lucide="search-x"></i><strong>Sin resultados</strong><span>${msg}</span></div></td></tr>`;
    _renderPagination(0, 0, 0, 1); icons(); return;
  }

  const cel = (a, b, etapa) => {
    const m = minEntre(a, b);
    return `<td class="mono num ${durClass(m, etapa)}" data-label="${etapa}">${calcTiempo(a, b)}</td>`;
  };
  const mcel = (m, label) => {
    if (!histColVisible.motivos) return '';
    return `<td class="hist-motivo" data-label="Motivo ${label}">${m ? '<span class="mot-chip">' + esc(m) + '</span>' : '<span class="muted">—</span>'}</td>`;
  };

  if (isMobile) {
    // VISTA CARD para móvil
    tb.innerHTML = pageData.map(h => {
      const tp = minEntre(h.entrada, h.dockTime);
      const tc = minEntre(h.dockTime, h.cargaFin);
      const tt = minEntre(h.entrada, h.salida);
      return `<tr class="hist-card-row">
        <td colspan="17">
          <div class="hist-card">
            <div class="hc-top">
              <span class="mono hc-placa">${esc(h.placa)}</span>
              <span class="hc-tx">${esc(h.tx || '')}</span>
              <span class="turno-pill ${h.turno === 'AM' ? 'am' : 'pm'}">${esc(h.turno || '—')}</span>
            </div>
            <div class="hc-body">
              <div class="hc-field"><label>Chofer</label><span>${esc(h.chofer || '—')}</span></div>
              <div class="hc-field"><label>Operación</label><span>${badgeOperacion(h.tipoOperacion)}</span></div>
              <div class="hc-field"><label>Vehículo</label><span class="tipo-chip">${esc(h.tipoVehiculo || '—')}</span></div>
              <div class="hc-field"><label>Entrada</label><span class="mono">${_dateDisplay(h.entrada)} ${formatHora(h.entrada)}</span></div>
              <div class="hc-field"><label>Salida</label><span class="mono">${h.salida ? _dateDisplay(h.salida) + ' ' + formatHora(h.salida) : '—'}</span></div>
              <div class="hc-times">
                <div class="hc-time ${durClass(tp, 'patio')}"><label>Patio</label><span class="mono">${fmtMin(tp)}</span></div>
                <div class="hc-time ${durClass(tc, 'carga')}"><label>Carga</label><span class="mono">${fmtMin(tc)}</span></div>
                <div class="hc-time ${durClass(tt, 'total')}"><label>Total</label><span class="mono strong">${fmtMin(tt)}</span></div>
              </div>
              ${h.motivoPatio || h.motivoDespacho || h.motivoSalida ? `<div class="hc-demora">${h.motivoPatio ? '<span class="mot-chip">P: ' + esc(h.motivoPatio) + '</span>' : ''}${h.motivoDespacho ? '<span class="mot-chip">D: ' + esc(h.motivoDespacho) + '</span>' : ''}${h.motivoSalida ? '<span class="mot-chip">S: ' + esc(h.motivoSalida) + '</span>' : ''}</div>` : ''}
            </div>
          </div>
        </td>
      </tr>`;
    }).join('');
  } else {
    // VISTA TABLA para desktop
    tb.innerHTML = pageData.map(h => {
      const resp = `Garita: ${esc(h.garitaEntradaPor || '—')}${h.garitaSalidaPor ? ' / ' + esc(h.garitaSalidaPor) : ''} · Tráfico: ${esc(h.traficoPor || '—')} · Despacho: ${esc(h.despachoPor || '—')} · Rampa: ${h.rampaUsada != null ? h.rampaUsada : '—'}`;
      return `<tr title="${resp}">
        <td class="mono tx-cell">${_highlight(h.tx || '—', qRaw)}</td>
        <td class="mono"><strong>${_highlight(h.placa, qRaw)}</strong></td>
        <td>${_highlight(h.chofer || '—', qRaw)}</td>
        <td>${badgeOperacion(h.tipoOperacion)}</td>
        <td><span class="tipo-chip">${esc(h.tipoVehiculo || '—')}</span></td>
        <td><span class="turno-pill ${h.turno === 'AM' ? 'am' : 'pm'}">${esc(h.turno || '—')}</span></td>
        <td class="mono num"><span class="hist-fecha">${_dateDisplay(h.entrada)}</span>${formatHora(h.entrada)}</td>
        <td class="mono num"><span class="hist-fecha">${h.salida ? _dateDisplay(h.salida) : ''}</span>${h.salida ? formatHora(h.salida) : '—'}${h.garitaSalidaPor ? `<span class="hist-by">por ${esc(h.garitaSalidaPor)}</span>` : ''}</td>
        <td class="mono num">${h.rampaUsada != null ? 'R-' + h.rampaUsada : '—'}</td>
        <td>${esc(h.destino || '—')}</td>
        ${cel(h.entrada, h.dockTime, 'patio')}
        ${mcel(h.motivoPatio, 'Patio')}
        ${cel(h.dockTime, h.cargaFin, 'carga')}
        ${mcel(h.motivoDespacho, 'Desp')}
        ${cel(h.cargaFin, h.salida, 'salida')}
        ${mcel(h.motivoSalida, 'Salida')}
        <td class="mono num total-cell">${calcTiempo(h.entrada, h.salida)}</td>
      </tr>`;
    }).join('');
  }
  _renderPagination(total, start + 1, Math.min(start + HIST_PAGE_SIZE, total), totalPages);
  icons();
}

function _renderPagination(total, from, to, pages) {
  const wrap = document.getElementById('hist-pagination');
  if (!wrap) return;
  if (!total) { wrap.innerHTML = ''; return; }
  if (total <= HIST_PAGE_SIZE) { wrap.innerHTML = `<span class="hist-meta">Mostrando ${total} de ${total}</span>`; return; }
  let btns = '';
  const pb = (n, act) => `<button class="page-btn ${act ? 'active' : ''}" onclick="histPage=${n};renderHistorial()">${n}</button>`;
  if (pages <= 7) { for (let i = 1; i <= pages; i++) btns += pb(i, i === histPage); }
  else {
    btns += pb(1, histPage === 1);
    if (histPage > 3) btns += `<span class="page-ellipsis">…</span>`;
    for (let i = Math.max(2, histPage - 1); i <= Math.min(pages - 1, histPage + 1); i++) btns += pb(i, i === histPage);
    if (histPage < pages - 2) btns += `<span class="page-ellipsis">…</span>`;
    btns += pb(pages, histPage === pages);
  }
  wrap.innerHTML = `<span class="hist-meta">Mostrando ${from}–${to} de ${total}</span>
    <div class="page-btns">
      <button class="page-btn" onclick="histPage=Math.max(1,histPage-1);renderHistorial()" ${histPage === 1 ? 'disabled' : ''}>‹</button>
      ${btns}
      <button class="page-btn" onclick="histPage=Math.min(${pages},histPage+1);renderHistorial()" ${histPage === pages ? 'disabled' : ''}>›</button>
    </div>`;
}

function toggleMotivosHist() {
  histColVisible.motivos = !histColVisible.motivos;
  renderHistorial();
}

document.addEventListener('click', (e) => {
  const pop = document.getElementById('hist-pop');
  if (!pop || pop.style.display === 'none') return;
  if (pop.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.hfilter')) return;
  pop.style.display = 'none';
});
/* ---- exportarHistorial: CSV básico (alias para el botón CSV) ---- */
function exportarHistorial() {
  const q = (_val('hist-q') || '').trim().toLowerCase();
  let data = state.history.filter(h => !q || _histBlob(h).includes(q));
  Object.keys(histFilters).forEach(k => { const a = histFilters[k]; if (a && a.length) { const s = new Set(a); data = data.filter(h => s.has(_filterVal(k, h))); } });
  if (!data.length) return showToast('Sin datos', 'No hay registros para exportar', 'warning');
  const headers = ['Transacción','Fecha','Turno','Placa','Cola','Cédula','Chofer','Operación','Tipo Vehículo',
    'Garita entrada','Tráfico','Despacho','Rampa','Garita salida','Entrada',
    'T.Patio','T.Despacho','T.Salida','Salida','T.Total'];
  const filas = data.map(h => [
    h.tx||'', _dateDisplay(h.entrada), h.turno||'', h.placa, h.remolque||'',
    h.cedula||'', h.chofer||'', h.tipoOperacion||'descarga', h.tipoVehiculo||'',
    h.garitaEntradaPor||'', h.traficoPor||'', h.despachoPor||'',
    (h.rampaUsada!=null?h.rampaUsada:(h.dock!=null?h.dock:'')), h.garitaSalidaPor||'',
    formatHora(h.entrada), calcTiempo(h.entrada,h.dockTime), calcTiempo(h.dockTime,h.cargaFin),
    calcTiempo(h.cargaFin,h.salida), formatHora(h.salida), calcTiempo(h.entrada,h.salida)]);
  descargarCSV(`HATTA_Historial_${_dateKey(new Date().toISOString())}.csv`, headers, filas);
  showToast('Exportado','CSV descargado','success');
}
