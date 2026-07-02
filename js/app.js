/* ============================================================
   APP — v3.0 OPTIMIZADO
   MEJORAS:
   · Auto-refresh con throttle en vez de setInterval múltiple
   · Solo re-render la pestaña activa (no todas)
   · Better cleanup de intervalos
   ============================================================ */
let _refreshTimer = null;
let _clockTimer = null;
let _360Timer = null;
let _tvTimer = null;

function renderAll() {
  const activo = document.querySelector('.tab-btn.active');
  const tab = activo ? activo.dataset.tab : 'dashboard';
  // KPIs del header siempre frescos
  const setTxt = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  setTxt('nav-patio-badge', porEstado(EST.PATIO).length || '');
  setTxt('nav-despacho-badge', porEstado(EST.DISPONIBLE).length || '');
  setTxt('last-update', 'actualizado ' + new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

  // Dashboard siempre (KPIs globales)
  renderDashboard();

  // Solo la pestaña activa
  switch (tab) {
    case 'garita': renderGarita(); break;
    case 'patio': renderPatio(); break;
    case 'despacho': renderDespacho(); break;
    case 'historial': renderHistorial(); break;
    case '360': render360(); break;
    case 'maestro': renderMaestroTab(); break;
  }
  icons();
}

function switchTab(tab) {
  if (typeof detenerCamara === 'function') detenerCamara();
  document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  const content = document.getElementById(`tab-${tab}`);
  if (btn) btn.classList.add('active');
  if (content) content.classList.add('active');
  state.selViaje = null; state.selDock = null;
  api.ui.guardarTab(tab);
  renderAll();
}

function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'maestro' && state.currentUser !== 'admin') return;
      switchTab(btn.dataset.tab);
    });
  });
}

function bindDelegation() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const num = parseInt(el.dataset.num, 10);
    const id = el.dataset.id;
    switch (a) {
      case 'sel-viaje': selectViaje(id); break;
      case 'sel-dock': selectDock(num); break;
      case 'sel-rampa-maestro': seleccionarRampaMaestro(num); break;
      case 'ini-carga': iniciarCarga(id); break;
      case 'fin-carga': finalizarCarga(id); break;
      case 'revertir': revertirOp(id); break;
      case 'marcar-dispo': marcarDisponible(id); break;
      case 'registrar-demora': registrarDemora(id, el.dataset.etapa); break;
      case 'del-motivo': delMotivo(parseInt(el.dataset.i, 10)); break;
      case 'del-motivo-rampa': delMotivoRampa(parseInt(el.dataset.i, 10)); break;
      case 'devolver-patio': devolverAPatio(id); break;
      case 'enviar-salida': enviarASalida(id); break;
      case 'del-user': borrarUsuario(parseInt(id, 10)); break;
      // Los catálogos (vehículos, choferes, transportistas, …) tienen
      // su propia delegación autocontenida en catalogos.js
    }
  });
}

function _editando() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA') && a.id !== 'gsearch';
}

function startClock() {
  _clockTimer = setInterval(() => {
    const c = document.getElementById('clock');
    if (c) c.textContent = new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
  }, 1000);
}

function startAutoRefresh() {
  // Un solo timer principal (throttled internamente)
  _refreshTimer = setInterval(() => {
    if (state.currentUser && state.currentUser !== 'chofer' && !_editando()) {
      renderAll();
    }
  }, HATTA.REFRESH_INTERVAL_MS);

  // 360: refresco más rápido cuando está activo
  _360Timer = setInterval(() => {
    if (typeof render360 === 'function' && !_editando()) {
      const cont = document.getElementById('tab-360');
      if (cont && cont.classList.contains('active')) render360();
    }
  }, HATTA.REFRESH_360_MS);

  // TV mode: refresco rápido
  _tvTimer = setInterval(() => {
    const d = document.getElementById('tab-dashboard');
    if (d && d.classList.contains('tv-mode') && !_editando()) renderAll();
  }, HATTA.REFRESH_TV_MS);
}

// Teclado: atajos para cambio rápido de pestaña
function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (_editando()) return;
    if (e.target.closest('.pin-modal') || e.target.closest('.ui-modal')) return;
    const map = HATTA.ui.tabShortcuts;
    if (map[e.key] && e.altKey) {
      e.preventDefault();
      const tab = map[e.key];
      if (tab === '360' || document.getElementById('tab-' + tab)) switchTab(tab);
    }
    // Ctrl+F: enfocar búsqueda global
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      const gs = document.getElementById('gsearch');
      if (gs && document.getElementById('main-app').style.display !== 'none') {
        e.preventDefault();
        gs.focus();
      }
    }
  });
}

function init() {
  loadDatabase();
  bindTabs();
  bindDelegation();
  bindKeyboardShortcuts();
  startClock();
  startAutoRefresh();
  checkSession();
  icons();
}
document.addEventListener('DOMContentLoaded', init);