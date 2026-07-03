/* ============================================================
   BÚSQUEDA GLOBAL — encuentra un camión en cualquier estado
   Indexa: placa, cola, TX, chofer, cédula, transportista, rampa.
   Responde al instante dónde está la unidad y salta a su pestaña.
   ============================================================ */
function ubicacionViaje(v) {
  const e = estadoInfo(v);
  return { txt: _conDock(e.etiqueta, v), tab: e.tab, cls: e.ucls };
}
function _gblob(h) {
  return [h.tx, h.placa, h.remolque, h.cedula, h.chofer, h.entidad, h.dock ? ('rampa ' + h.dock) : '']
    .filter(Boolean).join(' ').toLowerCase();
}

function buscarGlobal(qRaw) {
  const box = document.getElementById('gsearch-results');
  if (!box) return;
  const q = (qRaw || '').trim().toLowerCase();
  if (q.length < 1) { box.style.display = 'none'; box.innerHTML = ''; return; }

  const activos = state.viajes.filter(v => _gblob(v).includes(q));
  const salidos = state.history.filter(h => _gblob(h).includes(q)).slice(0, 25);

  if (!activos.length && !salidos.length) {
    box.innerHTML = `<div class="gs-empty">Sin coincidencias para "${esc(qRaw)}"</div>`;
    box.style.display = 'block'; return;
  }

  let html = '';
  if (activos.length) {
    html += `<div class="gs-section">En operación · ${activos.length}</div>`;
    html += activos.slice(0, 40).map(v => {
      const u = ubicacionViaje(v);
      return `<button class="gs-item" onclick="irAResultado('${u.tab}')">
        <span class="gs-placa mono">${esc(v.placa)}</span>
        <span class="gs-tx mono">${esc(v.tx || '')}</span>
        <span class="gs-chofer">${esc(v.chofer || '—')}</span>
        <span class="gs-loc ${u.cls}">${u.txt}</span>
      </button>`;
    }).join('');
  }
  if (salidos.length) {
    html += `<div class="gs-section">Ya salieron · ${salidos.length}</div>`;
    html += salidos.map(h => `<button class="gs-item" onclick="irAResultado('historial')">
        <span class="gs-placa mono">${esc(h.placa)}</span>
        <span class="gs-tx mono">${esc(h.tx || '')}</span>
        <span class="gs-chofer">${esc(h.chofer || '—')}</span>
        <span class="gs-loc u-gray">Salió ${h.salida ? formatHora(h.salida) : ''}</span>
      </button>`).join('');
  }
  box.innerHTML = html;
  box.style.display = 'block';
  icons();
}

function irAResultado(tab) {
  cerrarBuscador();
  const i = document.getElementById('gsearch'); if (i) i.value = '';
  if (typeof switchTab === 'function') switchTab(tab);
}
function cerrarBuscador() {
  const b = document.getElementById('gsearch-results'); if (b) b.style.display = 'none';
}
document.addEventListener('click', (e) => {
  const gs = document.querySelector('.global-search');
  if (gs && !gs.contains(e.target)) cerrarBuscador();
});
