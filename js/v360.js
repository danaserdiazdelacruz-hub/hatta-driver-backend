/* ============================================================
   360 — VISTA EN VIVO del viaje dentro del centro
   A diferencia de Historial (que cierra al salir), 360 muestra
   el estado ACTUAL y la línea de tiempo en tiempo real de cada
   camión que está dentro. Ordena por permanencia (más viejo
   primero = ranking) y permite buscar (ficha rápida).
   ============================================================ */
let sel360 = null;
let v360Filtro = '';
let v360EstadoFiltro = '';
let v360TipoVehFiltro = '';
function v360FiltrarEstado(val) { v360EstadoFiltro = val || ''; render360(); }
function v360FiltrarTipoVeh(val) { v360TipoVehFiltro = val || ''; render360(); }

function estado360(v) {
  const e = estadoInfo(v);
  return { txt: _conDock(e.etiqueta, v), cls: e.cls, etapa: e.fase, desde: v[e.desde] || v.entrada, sla: e.sla };
}

// Ubicación FÍSICA del camión (lugar real) + matiz de estado.
// Para el Top 10 del dashboard: lo accionable es DÓNDE está, no la fase.
function lugar360(v) {
  const e = estadoInfo(v);
  return { lugar: _conDock(e.lugar, v), sub: e.sub };
}

function lineaTiempo(v) {
  const ev = [];
  const add = (t, label, who, opts) => { if (t) ev.push(Object.assign({ t, label, who }, opts || {})); };
  add(v.entrada, 'Entrada por Garita', v.garitaEntradaPor, { icon: 'log-in' });
  add(v.motivoPatioHora, 'Demora en patio: ' + (v.motivoPatio || ''), null, { icon: 'alarm-clock', warn: true });
  add(v.dispoTime, 'Disponible para despacho', v.traficoPor, { icon: 'arrow-right-circle' });
  add(v.dockTime, 'Asignado a Rampa ' + (v.dock || '—'), v.despachoPor, { icon: 'warehouse' });
  add(v.motivoDespachoHora, 'Demora en rampa: ' + (v.motivoDespacho || ''), null, { icon: 'alarm-clock', warn: true });
  add(v.cargaInicio, 'Inicio de carga', null, { icon: 'play' });
  add(v.cargaFin, 'Fin de carga', null, { icon: 'check-circle' });
  add(v.motivoSalidaHora, 'Demora para salir: ' + (v.motivoSalida || ''), null, { icon: 'alarm-clock', warn: true });
  ev.sort((a, b) => new Date(a.t) - new Date(b.t));
  return ev;
}

function seleccionar360(id) { sel360 = id; render360(); }
function v360Buscar(val) { v360Filtro = (val || '').toUpperCase().trim(); render360(); }

function render360() {
  const cont = document.getElementById('tab-360');
  if (!cont || !cont.classList.contains('active')) return;

  let activos = [...state.viajes].sort((a, b) => new Date(a.entrada) - new Date(b.entrada));
  if (v360Filtro) activos = activos.filter(v =>
    (v.placa || '').toUpperCase().includes(v360Filtro) ||
    (v.chofer || '').toUpperCase().includes(v360Filtro) ||
    (v.remolque || '').toUpperCase().includes(v360Filtro) ||
    (v.tx || '').toUpperCase().includes(v360Filtro));
  if (v360EstadoFiltro) activos = activos.filter(v => v.estado === v360EstadoFiltro);
  if (v360TipoVehFiltro) activos = activos.filter(v => (v.tipoVehiculo || '') === v360TipoVehFiltro);

  // Popular selector de tipo de vehículo
  const selTV = document.getElementById('v360-tipoveh-sel');
  if (selTV) {
    const tipos = (state.config.catVehiculo || ['Rígido']);
    const opts = [{ value: '', label: 'Tipo vehículo' }, ...tipos.map(t => ({ value: t, label: t }))];
    selTV.innerHTML = opts.map(o => `<option value="${esc(o.value)}" ${v360TipoVehFiltro === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  }

  const cnt = document.getElementById('v360-count'); if (cnt) cnt.textContent = activos.length;

  if (!activos.find(v => v.id === sel360)) sel360 = activos.length ? activos[0].id : null;

  const lista = document.getElementById('v360-lista');
  if (lista) {
    renderLista(lista, activos, (v, i) => {
      const st = estado360(v);
      return `<button class="v360-item ${v.id === sel360 ? 'sel' : ''}" onclick="seleccionar360('${v.id}')">
        <span class="v360-rank">${i + 1}</span>
        <div class="v360-it-main">
          <span class="v360-it-top"><span class="v360-it-placa mono">${esc(v.placa)}</span><span class="tipo-chip">${esc(v.tipoVehiculo || '—')}</span></span>
          <span class="v360-it-est ${st.cls}">${st.txt}</span>
        </div>
        <div class="v360-it-times">
          <span class="mono v360-total ${durClass(minDesde(v.entrada), 'total')}">${calcEspera(v.entrada)}</span>
          <span class="v360-etapa">${st.etapa}</span>
        </div>
      </button>`;
    }, v360Filtro ? vacio('search-x', 'Nada coincide', 'Prueba otra placa, cola, TX o chofer')
      : vacio('truck', 'Sin camiones en el centro', 'Las entradas aparecerán aquí en vivo'));
  }

  const det = document.getElementById('v360-detalle');
  if (det) {
    const v = state.viajes.find(x => x.id === sel360);
    if (!v) { det.innerHTML = `<div class="v360-empty"><i data-lucide="radar"></i><span>${activos.length ? 'Selecciona un camión' : 'Sin camiones activos'}</span></div>`; icons(); return; }
    const st = estado360(v);
    const ev = lineaTiempo(v);
    const pasos = ev.map((e, idx) => {
      const next = ev[idx + 1];
      const dur = next ? calcTiempo(e.t, next.t) : null;
      return `<div class="tl-step ${e.warn ? 'warn' : ''}">
        <div class="tl-dot"><i data-lucide="${e.icon || 'circle'}"></i></div>
        <div class="tl-body">
          <div class="tl-head"><span class="tl-label">${esc(e.label)}</span><span class="tl-time mono"><span class="tl-date">${formatFecha(e.t)}</span> ${formatHora(e.t)}</span></div>
          ${e.who ? `<div class="tl-who">por ${esc(e.who)}</div>` : ''}
          ${dur ? `<div class="tl-dur">+${dur} hasta el siguiente paso</div>` : ''}
        </div>
      </div>`;
    }).join('');
    const vivo = `<div class="tl-step live">
      <div class="tl-dot"><i data-lucide="loader"></i></div>
      <div class="tl-body">
        <div class="tl-head"><span class="tl-label">Ahora · ${st.etapa}</span><span class="tl-live mono ${durClass(minDesde(st.desde), st.sla)}">${calcEspera(st.desde)}</span></div>
        <div class="tl-who">${st.txt}</div>
      </div>
    </div>`;

    det.innerHTML = `
      <div class="v360-ficha">
        <div class="v360-fhead">
          <span class="v360-fplaca mono">${esc(v.placa)}</span>
          <span class="v360-fest ${st.cls}">${st.txt}</span>
        </div>
        <div class="v360-fgrid">
          <div><label>Transacción</label><span class="mono">${esc(v.tx || '—')}</span></div>
          <div><label>Cola</label><span class="mono">${esc(v.remolque || 'N/A')}</span></div>
          <div><label>Chofer</label><span>${esc(v.chofer || '—')}</span></div>
          <div><label>Cédula</label><span class="mono">${esc(v.cedula || '—')}</span></div>
          <div><label>Transportista</label><span>${esc(v.entidad || '—')}</span></div>
          <div><label>Operación</label><span>${badgeOperacion(v.tipoOperacion)}</span></div>
          <div><label>Temperatura</label><span>${esc(v.tipo_unidad || '—')} · ${esc(v.tipoVehiculo || '—')}</span></div>
          <div><label>Destino</label><span>${esc(v.destino || '—')}</span></div>
          <div class="v360-ftotal"><label>Tiempo total en centro</label><span class="mono v360-bigtime ${durClass(minDesde(v.entrada), 'total')}">${calcEspera(v.entrada)}</span></div>
        </div>
      </div>
      <div class="v360-timeline">
        <h4 class="v360-tl-title"><i data-lucide="activity"></i> Línea de tiempo · en vivo</h4>
        <div class="tl-track">${pasos}${vivo}</div>
      </div>`;
  }
  icons();
}
