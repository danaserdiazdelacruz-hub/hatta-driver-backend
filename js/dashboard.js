/* ============================================================
   DASHBOARD — v3.0 OPTIMIZADO — Resumen gerencial en vivo
   MEJORAS:
   · KPI de cumplimiento SLA (% dentro del tiempo)
   · Tarjeta de productividad mejorada con indicadores AM/PM
   · Indicador de demoras activas
   · Mejor orden en el Top 10 (por tiempo, no solo llegada)
   ============================================================ */
function renderDashboard() {
  const activas = state.docksActive.filter(a => a).length;
  const enRampa = porEstado(EST.PENDIENTE, EST.CARGANDO);
  const ocupadas = enRampa.length;
  const enPatioTotal = state.viajes.length;
  const ocupacion = activas > 0 ? Math.round((ocupadas / activas) * 100) : 0;
  const esperando = porEstado(EST.PATIO, EST.DISPONIBLE);
  const retrasados = esperando.filter(v => estaRetrasado(v.entrada)).length;

  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('kpi-total', enPatioTotal);
  set('kpi-ocupacion', ocupacion + '%');
  set('kpi-avg-yard', promedioMin(esperando, 'entrada'));
  set('kpi-avg-dock', promedioCargaHoy());
  set('kpi-retrasados', retrasados);
  set('stat-docked', `${ocupadas} / ${activas}`);
  set('stat-patio', porEstado(EST.PATIO).length);
  set('stat-dispatched', getTodayHistory().length);
  renderPipeline();
  renderProductividad();
  renderSLADashboard();

  // Top 10 — ordenado por tiempo total (más urgente primero)
  const top = [...state.viajes].sort((a, b) => new Date(a.entrada) - new Date(b.entrada)).slice(0, 10);
  const tt = document.getElementById('dash-top10');
  if (tt) {
    tt.innerHTML = top.length ? top.map((v, i) => {
      const loc = lugar360(v);
      const e = estadoInfo(v);
      const ttMin = minDesde(v.entrada);
      return `<tr>
        <td class="mono">${i + 1}</td>
        <td class="mono"><strong>${esc(v.placa)}</strong></td>
        <td><span class="tipo-chip">${esc(v.tipoVehiculo || '—')}</span></td>
        <td><strong>${esc(loc.lugar)}</strong></td>
        <td><span class="v360-it-est ${e.cls}">${esc(e.estadoCorto)}</span></td>
        <td class="mono ${durClass(ttMin, 'total')}"><strong>${calcEspera(v.entrada)}</strong></td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Sin camiones en el centro</td></tr>';
  }
  icons();
}

function promedioCargaHoy() {
  const hoy = getTodayHistory().filter(h => h.cargaInicio && h.cargaFin);
  if (!hoy.length) return '00:00';
  const total = hoy.reduce((a, h) => a + Math.floor((new Date(h.cargaFin) - new Date(h.cargaInicio)) / 60000), 0);
  return fmtMin(Math.floor(total / hoy.length));
}

/* ---- KPI de cumplimiento SLA en dashboard ---- */
function renderSLADashboard() {
  const cont = document.getElementById('dash-sla-kpi');
  if (!cont) return;
  const hoy = getTodayHistory();
  const sla = state.config.sla || {};
  const pct = (vals, etapa) => {
    const s = sla[etapa] || { warn: 30, danger: 60 };
    const clean = vals.filter(v => v != null);
    return clean.length ? Math.round(clean.filter(v => v < s.warn).length / clean.length * 100) : null;
  };
  const pPatio = pct(hoy.map(h => minEntre(h.entrada, h.dockTime)), 'patio');
  const pCarga = pct(hoy.map(h => minEntre(h.dockTime, h.cargaFin)), 'carga');
  const pTotal = pct(hoy.map(h => minEntre(h.entrada, h.salida)), 'total');

  const bar = (p, label) => p != null ? `
    <div class="sla-bar-item">
      <span class="sla-bar-label">${label}</span>
      <div class="sla-bar-track"><div class="sla-bar-fill ${p >= 80 ? 'ok' : p >= 50 ? 'warn' : 'danger'}" style="width:${Math.min(100, p)}%"></div></div>
      <span class="sla-bar-pct ${p >= 80 ? 'ok' : p >= 50 ? 'warn' : 'danger'}">${p}%</span>
    </div>` : '';

  const demorasHoy = (state.demoras || []).filter(d => new Date(d.hora).toDateString() === new Date().toDateString()).length;

  cont.innerHTML = `
    <div class="sla-dash-grid">
      <div class="sla-dash-card">
        <div class="sla-dash-title">Cumplimiento SLA Hoy</div>
        ${bar(pPatio, 'Patio')}
        ${bar(pCarga, 'Carga')}
        ${bar(pTotal, 'Total')}
      </div>
      <div class="sla-dash-card">
        <div class="sla-dash-title">Alertas Activas</div>
        <div class="sla-dash-stat">
          <span class="sla-dash-num ${demorasHoy > 0 ? 'warn' : 'ok'}">${demorasHoy}</span>
          <span class="sla-dash-lbl">Demoras registradas</span>
        </div>
      </div>
    </div>`;
}

/* ---- Modo TV (presentación a pantalla completa) ---- */
function toggleDashboardTV() {
  const el = document.getElementById('tab-dashboard');
  const entrar = !el.classList.contains('tv-mode');
  el.classList.toggle('tv-mode', entrar);
  if (entrar) {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn) try { fn.call(el); } catch (e) {}
  } else if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
  }
  const b = document.getElementById('tv-toggle-label');
  if (b) b.textContent = entrar ? 'Salir' : 'Modo TV';
}
function _syncTvMode() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const el = document.getElementById('tab-dashboard');
    if (el) el.classList.remove('tv-mode');
    const b = document.getElementById('tv-toggle-label'); if (b) b.textContent = 'Modo TV';
  }
}
document.addEventListener('fullscreenchange', _syncTvMode);
document.addEventListener('webkitfullscreenchange', _syncTvMode);

/* ---------- Pipeline operativo / cuellos de botella ---------- */
function renderPipeline() {
  const stages = [
    { label: 'En patio', sub: 'esperando Tráfico', n: porEstado(EST.PATIO).length, icon: 'truck', color: 'blue', espera: true },
    { label: 'Esperando rampa', sub: 'liberados por Tráfico', n: porEstado(EST.DISPONIBLE).length, icon: 'clock', color: 'blue', espera: true },
    { label: 'En rampa', sub: 'asignados, sin iniciar', n: porEstado(EST.PENDIENTE).length, icon: 'warehouse', color: 'blue', espera: false },
    { label: 'Cargando', sub: 'operación activa', n: porEstado(EST.CARGANDO).length, icon: 'loader', color: 'blue', espera: false },
    { label: 'Listo / por salir', sub: 'esperando salida', n: porEstado(EST.LISTO, EST.CARGADO_PATIO).length, icon: 'check-circle', color: 'blue', espera: true },
  ];
  const max = Math.max(1, ...stages.map(s => s.n));
  const ranking = stages.map((s, i) => ({ i, n: s.n, espera: s.espera }))
    .filter(x => x.espera && x.n > 0).sort((a, b) => b.n - a.n);
  const rojo = ranking[0] ? ranking[0].i : -1;
  const naranja = ranking[1] ? ranking[1].i : -1;

  const cont = document.getElementById('dash-pipeline');
  if (cont) {
    cont.innerHTML = stages.map((s, i) => {
      const tono = i === rojo ? 'cuello' : i === naranja ? 'seg' : '';
      const arrow = i < stages.length - 1 ? '<div class="pl-arrow"><i data-lucide="chevron-right"></i></div>' : '';
      return `<div class="pl-stage pl-${s.color} ${tono}">
        <div class="pl-top"><i data-lucide="${s.icon}"></i><span class="pl-n">${s.n}</span></div>
        <div class="pl-label">${s.label}</div>
        <div class="pl-sub">${s.sub}</div>
        <div class="pl-bar"><span style="width:${Math.round(s.n / max * 100)}%"></span></div>
      </div>${arrow}`;
    }).join('');
  }
  icons();
}

/* ---------- Productividad por turno (hoy) ---------- */
function _esHoy(iso) {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}
function _promMin(arr, fn) {
  const vals = arr.map(fn).filter(x => x != null && x > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}
function _fmtProm(m) { return m == null ? '—' : fmtMin(m); }

function renderProductividad() {
  const tb = document.getElementById('dash-turnos');
  if (!tb) return;
  const todos = [...state.viajes, ...state.history];
  const entAM = todos.filter(v => _esHoy(v.entrada) && (v.turno || turnoDe(v.entrada)) === 'AM').length;
  const entPM = todos.filter(v => _esHoy(v.entrada) && (v.turno || turnoDe(v.entrada)) === 'PM').length;
  const salAM = state.history.filter(h => _esHoy(h.salida) && (h.turnoSalida || turnoDe(h.salida)) === 'AM');
  const salPM = state.history.filter(h => _esHoy(h.salida) && (h.turnoSalida || turnoDe(h.salida)) === 'PM');
  const todasSal = [...salAM, ...salPM];
  const perm = h => minEntre(h.entrada, h.salida);
  const carga = h => minEntre(h.cargaInicio, h.cargaFin);
  const rows = [
    ['Entradas', entAM, entPM, entAM + entPM],
    ['Salidas', salAM.length, salPM.length, salAM.length + salPM.length],
    ['Tiempo prom. en centro', _fmtProm(_promMin(salAM, perm)), _fmtProm(_promMin(salPM, perm)), _fmtProm(_promMin(todasSal, perm))],
    ['Tiempo prom. de carga', _fmtProm(_promMin(salAM, carga)), _fmtProm(_promMin(salPM, carga)), _fmtProm(_promMin(todasSal, carga))],
  ];
  renderLista(tb, rows, r => `<tr><td class="tt-metric">${r[0]}</td><td class="mono">${r[1]}</td><td class="mono">${r[2]}</td><td class="mono tt-total">${r[3]}</td></tr>`);
}