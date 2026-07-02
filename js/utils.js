/* ============================================================
   UTILS — Helpers compartidos por todos los módulos
   v3.0 — OPTIMIZADO: bug fix, debounce, XLSX, analytics
   ============================================================ */

/* ---- Escape HTML (XSS safe) ---- */
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---- UID generator ---- */
/* UUID v4 real — las columnas id de Supabase son tipo uuid.
   (El uid() anterior generaba strings tipo "mbxk2j3abc12" que
   Postgres rechazaba en silencio y el sistema vivía del fallback
   local. Bug corregido en Fase 1 del Maestro.) */
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  // Fallback para contextos sin crypto.randomUUID (http sin TLS)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ---- Debounce (rendimiento) ---- */
function debounce(fn, ms) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

/* ---- Throttle (para relojes en vivo) ---- */
function throttle(fn, ms) {
  let last = 0, t;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn.apply(this, args); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn.apply(this, args); }, ms - (now - last)); }
  };
}

/* ---- Tiempos ---- */
function calcEspera(iso) {
  if (!iso) return '00:00';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return fmtMin(min);
}

function calcTiempo(inicioIso, finIso) {
  if (!inicioIso || !finIso) return '--:--';
  const min = Math.floor((new Date(finIso) - new Date(inicioIso)) / 60000);
  return fmtMin(min);
}

function fmtMin(min) {
  if (min == null || min < 0 || isNaN(min)) return '00:00';
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function turnoDe(iso) {
  if (!iso) return '';
  return new Date(iso).getHours() < 12 ? 'AM' : 'PM';
}

function minEntre(a, b) {
  if (!a || !b) return null;
  return Math.floor((new Date(b) - new Date(a)) / 60000);
}

/* ---- SLA por etapa ---- */
function _slaEtapa(etapa) {
  const def = { patio: { warn: 30, danger: 60 }, carga: { warn: 45, danger: 90 }, salida: { warn: 15, danger: 30 }, total: { warn: 90, danger: 180 } };
  const k = etapa || 'patio';
  const sla = (state.config && state.config.sla) || {};
  return sla[k] || def[k] || def.patio;
}

function durClass(min, etapa) {
  if (min == null || isNaN(min)) return '';
  const s = _slaEtapa(etapa);
  if (min >= s.danger) return 'dur-danger';
  if (min >= s.warn) return 'dur-warn';
  return '';
}

function minDesde(iso) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

/* ---- Formatos de fecha ---- */
function formatFecha(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatFechaHora(iso) {
  if (!iso) return '';
  return formatFecha(iso) + ' ' + formatHora(iso);
}
function formatHora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
}

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

/* ---- Estadísticas ---- */
function promedioMin(lista, campoIso) {
  if (!lista || lista.length === 0) return '00:00';
  const total = lista.reduce((acc, x) => acc + minDesde(x[campoIso]), 0);
  return fmtMin(Math.floor(total / lista.length));
}

function getTodayHistory() {
  const hoy = new Date().toDateString();
  return state.history.filter(h => new Date(h.salida || h.cargaFin || h.entrada).toDateString() === hoy);
}

function prioOrden(p) {
  return ({ urgente: 0, refrigerado: 1, normal: 2 })[p] ?? 2;
}

function ordenarCola(lista) {
  return [...lista].sort((a, b) =>
    (prioOrden(a.prioridad) - prioOrden(b.prioridad)) ||
    (new Date(a.entrada) - new Date(b.entrada))
  );
}

/* ---- Toast ---- */
function showToast(title, msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<strong>${esc(title)}</strong><div class="toast-msg">${esc(msg)}</div>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, HATTA.ui.toastDurationMs);
}

/* ---- Iconos lucide (con guard para rendimiento) ---- */
let _iconsPending = false;
function icons() {
  if (_iconsPending) return;
  _iconsPending = true;
  requestAnimationFrame(() => {
    if (window.lucide) { try { lucide.createIcons(); } catch (e) {} }
    _iconsPending = false;
  });
}

/* ---- Badges reutilizables ---- */
function badgePrioridad(p) {
  const map = {
    urgente:     `<span class="pbadge urgente"><i data-lucide="alert-triangle"></i>Urgente</span>`,
    refrigerado: `<span class="pbadge refrigerado"><i data-lucide="snowflake"></i>Frío</span>`,
    normal:      `<span class="pbadge normal"><i data-lucide="minus"></i>Normal</span>`,
  };
  return map[p] || map.normal;
}

function badgeOperacion(op) {
  const map = {
    carga:         `<span class="obadge carga">Carga</span>`,
    descarga:      `<span class="obadge descarga">Descarga</span>`,
    descarga_carga: `<span class="obadge ambas">Desc+Carga</span>`,
    transferencia: `<span class="obadge transferencia">Transfer.</span>`,
  };
  return map[op] || map.descarga;
}

function badgeTipoVehiculo(tv) {
  if (!tv) return '<span class="tipo-chip">—</span>';
  return `<span class="tipo-chip">${esc(tv)}</span>`;
}

/* ---- Exportar CSV ---- */
function csvCelda(v) {
  let s = (v == null ? '' : String(v));
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function descargarCSV(nombre, headers, filas) {
  const contenido = [headers, ...filas]
    .map(row => row.map(csvCelda).join(','))
    .join('\n');
  const blob = new Blob(['\ufeff' + contenido], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   XLSX EXPORT — Formato profesional para análisis gerencial
   Usa SheetJS (xlsx) CDN. Genera:
   · Hoja "Datos": todos los registros con formato condicional
   · Hoja "Resumen": KPIs, promedios, percentiles por tipo/turno
   · Hoja "SLA": cumplimiento por etapa
   ============================================================ */
function exportarHistorialXLSX() {
  if (typeof XLSX === 'undefined') {
    showToast('Cargando librería', 'Intenta de nuevo en unos segundos', 'warning');
    return;
  }

  const q = ((_val || (() => ''))('hist-q') || '').trim().toLowerCase();
  let data = state.history.filter(h => !q || _histBlob(h).includes(q));
  Object.keys(histFilters).forEach(k => {
    const a = histFilters[k]; if (a && a.length) { const s = new Set(a); data = data.filter(h => s.has(_filterVal(k, h))); }
  });

  if (!data.length) return showToast('Sin datos', 'No hay registros para exportar', 'warning');

  const wb = XLSX.utils.book_new();

  /* ---- HOJA 1: DATOS COMPLETOS ---- */
  const headers = [
    'Transacción', 'Fecha Entrada', 'Hora Entrada', 'Turno',
    'Placa', 'Cola', 'Cédula', 'Chofer', 'Operación', 'Tipo Vehículo',
    'Transportista', 'Prioridad', 'Destino',
    'Garita Entrada', 'Tráfico', 'Despacho', 'Rampa Usada',
    'Garita Salida', 'Hora Salida',
    'T.Patio (min)', 'Motivo Patio',
    'T.Carga (min)', 'Motivo Despacho',
    'T.Salida (min)', 'Motivo Salida',
    'T.Total (min)', 'SLA Patio', 'SLA Carga', 'SLA Salida', 'SLA Total'
  ];

  const rows = data.map(h => {
    const tp = minEntre(h.entrada, h.dockTime);
    const tc = minEntre(h.dockTime, h.cargaFin);
    const ts = minEntre(h.cargaFin, h.salida);
    const tt = minEntre(h.entrada, h.salida);
    const sla = state.config.sla || {};
    return [
      h.tx || '', _dateKey(h.entrada), formatHora(h.entrada), h.turno || '',
      h.placa, h.remolque || '', h.cedula || '', h.chofer || '',
      h.tipoOperacion || 'descarga', h.tipoVehiculo || '',
      h.entidad || '', h.prioridad || 'normal', h.destino || '',
      h.garitaEntradaPor || '', h.traficoPor || '', h.despachoPor || '',
      h.rampaUsada != null ? h.rampaUsada : (h.dock != null ? h.dock : ''),
      h.garitaSalidaPor || '', h.salida ? formatHora(h.salida) : '',
      tp != null ? tp : '', h.motivoPatio || '',
      tc != null ? tc : '', h.motivoDespacho || '',
      ts != null ? ts : '', h.motivoSalida || '',
      tt != null ? tt : '',
      tp != null ? (tp >= ((sla.patio || {}).danger || 60) ? 'EXCEDIDO' : tp >= ((sla.patio || {}).warn || 30) ? 'ADVERTENCIA' : 'OK') : '',
      tc != null ? (tc >= ((sla.carga || {}).danger || 90) ? 'EXCEDIDO' : tc >= ((sla.carga || {}).warn || 45) ? 'ADVERTENCIA' : 'OK') : '',
      ts != null ? (ts >= ((sla.salida || {}).danger || 30) ? 'EXCEDIDO' : ts >= ((sla.salida || {}).warn || 15) ? 'ADVERTENCIA' : 'OK') : '',
      tt != null ? (tt >= ((sla.total || {}).danger || 180) ? 'EXCEDIDO' : tt >= ((sla.total || {}).warn || 90) ? 'ADVERTENCIA' : 'OK') : ''
    ];
  });

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Anchos de columna optimizados
  ws['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 7 },
    { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 20 },
    { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 11 }, { wch: 16 },
    { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
    { wch: 16 }, { wch: 10 },
    { wch: 13 }, { wch: 22 }, { wch: 13 }, { wch: 22 },
    { wch: 13 }, { wch: 22 }, { wch: 13 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }
  ];

  // Autofiltros
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };

  // Congelar la primera fila (encabezados)
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(wb, ws, 'Datos');

  /* ---- HOJA 2: RESUMEN EJECUTIVO ---- */
  const summaryRows = [
    ['RESUMEN EJECUTIVO — HATTA Yard Management'],
    ['Fecha de exportación', new Date().toLocaleString('es-DO')],
    ['Total de registros', data.length],
    [],
    ['--- TIEMPOS PROMEDIO (minutos) ---'],
    ['Métrica', 'AM', 'PM', 'Global'],
    ['Entradas', _countByShift(data, 'entrada', 'AM'), _countByShift(data, 'entrada', 'PM'), data.length],
    ['T. Patio promedio', _avgByShift(data, h => minEntre(h.entrada, h.dockTime), 'AM'), _avgByShift(data, h => minEntre(h.entrada, h.dockTime), 'PM'), _avgAll(data, h => minEntre(h.entrada, h.dockTime))],
    ['T. Carga promedio', _avgByShift(data, h => minEntre(h.dockTime, h.cargaFin), 'AM'), _avgByShift(data, h => minEntre(h.dockTime, h.cargaFin), 'PM'), _avgAll(data, h => minEntre(h.dockTime, h.cargaFin))],
    ['T. Salida promedio', _avgByShift(data, h => minEntre(h.cargaFin, h.salida), 'AM'), _avgByShift(data, h => minEntre(h.cargaFin, h.salida), 'PM'), _avgAll(data, h => minEntre(h.cargaFin, h.salida))],
    ['T. Total promedio', _avgByShift(data, h => minEntre(h.entrada, h.salida), 'AM'), _avgByShift(data, h => minEntre(h.entrada, h.salida), 'PM'), _avgAll(data, h => minEntre(h.entrada, h.salida))],
    [],
    ['--- POR TIPO DE OPERACIÓN ---'],
    ['Operación', 'Cantidad', 'T.Total Prom.', 'T.Total Máx.', 'T.Total Mín.'],
    ..._breakdownBy(data, 'tipoOperacion', h => minEntre(h.entrada, h.salida)),
    [],
    ['--- POR TIPO DE VEHÍCULO ---'],
    ['Tipo Vehículo', 'Cantidad', 'T.Total Prom.', 'T.Total Máx.', 'T.Total Mín.'],
    ..._breakdownBy(data, 'tipoVehiculo', h => minEntre(h.entrada, h.salida)),
    [],
    ['--- TOP 10 PLACAS MÁS LENTAS ---'],
    ..._slowestPlates(data, 10),
    [],
    ['--- CUMPLIMIENTO SLA ---'],
    ['Etapa', 'Total', 'OK', 'Advertencia', 'Excedido', '% Cumplimiento'],
    ..._slaCompliance(data),
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws2['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');

  /* ---- HOJA 3: DEMORAS --- */
  const demoras = data.filter(h => h.motivoPatio || h.motivoDespacho || h.motivoSalida);
  const demRows = [['PLACA', 'MOTIVO', 'ETAPA', 'FECHA', 'RESPONSABLE']];
  demoras.forEach(h => {
    if (h.motivoPatio) demRows.push([h.placa, h.motivoPatio, 'Patio', _dateDisplay(h.entrada), h.traficoPor || '']);
    if (h.motivoDespacho) demRows.push([h.placa, h.motivoDespacho, 'Despacho', _dateDisplay(h.dockTime), h.despachoPor || '']);
    if (h.motivoSalida) demRows.push([h.placa, h.motivoSalida, 'Salida', _dateDisplay(h.cargaFin), h.garitaSalidaPor || '']);
  });
  if (demRows.length > 1) {
    const ws3 = XLSX.utils.aoa_to_sheet(demRows);
    ws3['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 14 }, { wch: 18 }];
    ws3['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: demRows.length - 1, c: 4 } }) };
    XLSX.utils.book_append_sheet(wb, ws3, 'Demoras');
  }

  // Descargar
  XLSX.writeFile(wb, `HATTA_Analisis_${_dateKey(new Date().toISOString())}.xlsx`);
  showToast('Excel exportado', `${data.length} registros + resumen ejecutivo + demoras`, 'success');
}

/* ---- Helpers para resumen XLSX ---- */
function _val(id) { const e = document.getElementById(id); return e ? e.value : ''; }

function _avgAll(arr, fn) {
  const vals = arr.map(fn).filter(x => x != null && x > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : '—';
}

function _avgByShift(arr, fn, shift) {
  const filtered = arr.filter(h => (h.turno || turnoDe(h.entrada)) === shift);
  return _avgAll(filtered, fn);
}

function _countByShift(arr, field, shift) {
  return arr.filter(h => (h.turno || turnoDe(h[field])) === shift).length;
}

function _breakdownBy(arr, key, fn) {
  const groups = {};
  arr.forEach(h => {
    const k = h[key] || 'Sin clasificar';
    if (!groups[k]) groups[k] = [];
    groups[k].push(fn(h));
  });
  return Object.entries(groups).map(([k, vals]) => {
    const clean = vals.filter(v => v != null && v > 0);
    return [k, vals.length, clean.length ? Math.round(clean.reduce((a, b) => a + b, 0) / clean.length) : '—',
      clean.length ? Math.max(...clean) : '—', clean.length ? Math.min(...clean) : '—'];
  }).sort((a, b) => b[1] - a[1]);
}

function _slowestPlates(arr, n) {
  const withTime = arr.map(h => ({ placa: h.placa, t: minEntre(h.entrada, h.salida), chofer: h.chofer, op: h.tipoOperacion }))
    .filter(x => x.t != null).sort((a, b) => b.t - a.t).slice(0, n);
  return [['Placa', 'Chofer', 'Operación', 'T.Total (min)'], ...withTime.map(x => [x.placa, x.chofer || '', x.op || '', x.t])];
}

function _slaCompliance(arr) {
  const sla = state.config.sla || {};
  return ['patio', 'carga', 'salida', 'total'].map(etapa => {
    const s = sla[etapa] || { warn: 30, danger: 60 };
    let vals;
    if (etapa === 'patio') vals = arr.map(h => minEntre(h.entrada, h.dockTime));
    else if (etapa === 'carga') vals = arr.map(h => minEntre(h.dockTime, h.cargaFin));
    else if (etapa === 'salida') vals = arr.map(h => minEntre(h.cargaFin, h.salida));
    else vals = arr.map(h => minEntre(h.entrada, h.salida));
    const clean = vals.filter(v => v != null);
    const ok = clean.filter(v => v < s.warn).length;
    const warn = clean.filter(v => v >= s.warn && v < s.danger).length;
    const danger = clean.filter(v => v >= s.danger).length;
    const pct = clean.length ? Math.round((ok / clean.length) * 100) : 0;
    return [etapa.charAt(0).toUpperCase() + etapa.slice(1), clean.length, ok, warn, danger, pct + '%'];
  });
}

/* ---- Empty state helper ---- */
function vacio(icon, titulo, sub, cls) {
  return `<div class="empty-state ${cls || ''}"><i data-lucide="${icon}"></i>
    <p>${esc(titulo)}</p>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
}

/* ---- Semáforo SLA ---- */
function agingClass(iso, etapa) {
  const s = _slaEtapa(etapa);
  const m = minDesde(iso);
  if (m >= s.danger) return 'age-danger';
  if (m >= s.warn) return 'age-warn';
  return 'age-ok';
}

function estaRetrasado(iso) {
  const s = _slaEtapa('patio');
  return minDesde(iso) >= s.danger;
}

/* ---- Render lista centralizado ---- */
function renderLista(cont, items, tpl, vacioHtml) {
  const el = typeof cont === 'string' ? document.getElementById(cont) : cont;
  if (!el) return;
  el.innerHTML = (items && items.length) ? items.map(tpl).join('') : (vacioHtml || '');
}

/* ---- Helpers de filtro ---- */
function opcionesFiltroVehiculo() {
  const tipos = state.config.catVehiculo || ['Rígido', 'Contenedor'];
  return [{ value: '', label: 'Todos los tipos' }, ...tipos.map(t => ({ value: t, label: t }))];
}

// FIX: bug original — faltaba cerrar paréntesis
function aplicarFiltroVehiculo(lista, filtro) {
  if (!filtro) return lista;
  return lista.filter(v => (v.tipoVehiculo || '') === filtro);
}