/* ============================================================
   PATIO — Control de TRÁFICO
   MEJORAS v2:
   · Filtro por tipo de vehículo en las 3 secciones (editable desde catálogo)
   · Prioridad editable directamente en la tarjeta de patio
   · badgePrioridad() visible en las tarjetas
   · Campo destino editable en patio (no solo en despacho)
   ============================================================ */
let patioFiltros = { patio: '', dispo: '', desp: '' };
let patioFiltroVeh = { patio: '', dispo: '', desp: '' }; // NUEVO: filtro por tipo vehículo

function patioBuscarSec(sec, v) { patioFiltros[sec] = (v || '').toUpperCase().trim(); renderPatio(); }
function patioFiltrarVehiculo(sec, v) { patioFiltroVeh[sec] = v || ''; renderPatio(); } // NUEVO

function filtrarLista(lista, f) {
  if (!f) return lista;
  return lista.filter(v =>
    (v.placa || '').toUpperCase().includes(f) ||
    (v.chofer || '').toUpperCase().includes(f) ||
    (v.remolque || '').toUpperCase().includes(f));
}
function porLlegada(lista) { return [...lista].sort((a, b) => new Date(a.entrada) - new Date(b.entrada)); }

// NUEVO: Selector de tipo vehículo para filtros de patio
function _selectorFiltroVeh(sec, valorActual) {
  const tipos = state.config.catVehiculo || ['Rígido', 'Contenedor'];
  const opts = [{ value: '', label: 'Todos' }, ...tipos.map(t => ({ value: t, label: t }))];
  return `<select class="filtro-veh-sel" onchange="patioFiltrarVehiculo('${sec}',this.value)" title="Filtrar por tipo de vehículo">
    ${opts.map(o => `<option value="${esc(o.value)}" ${valorActual === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
  </select>`;
}

/* ---- Acciones ---- */
function setViajeCampo(id, campo, valor) {
  const v = buscarViaje(id);
  if (v) { v[campo] = valor; api.viajes.actualizar(id, { [campo]: valor }).catch(() => {}); }
}
function registrarDemora(id, etapa) {
  etapa = etapa || 'patio';
  const v = buscarViaje(id); if (!v) return;
  const campo = etapa === 'despacho' ? 'motivoDespacho' : etapa === 'salida' ? 'motivoSalida' : 'motivoPatio';
  const donde = etapa === 'despacho' ? 'en rampa' : etapa === 'salida' ? 'para salir' : 'en patio';
  uiChoose(`Motivo de demora ${donde} · ${v.placa}`, state.config.motivosDemora, (motivo) => {
    v[campo] = motivo;
    v[campo + 'Hora'] = new Date().toISOString();
    const demora = { id: uid(), placa: v.placa, motivo, etapa, hora: new Date().toISOString() };
    state.demoras.unshift(demora);
    if (state.demoras.length > 300) state.demoras = state.demoras.slice(0, 300);
    api.demoras.insertar(demora).catch(() => {});
    logAccion('Demora ' + donde, `${v.placa}: ${motivo}`);
    api.notificar(); renderAll();
    showToast('Demora registrada', `${v.placa}: ${motivo} (${donde})`, 'warning');
  });
}
function marcarDisponible(id) {
  const v = buscarViaje(id); if (!v) return;
  setEstado(id, EST.DISPONIBLE, { dispoTime: new Date().toISOString(), traficoPor: state.currentUserName });
  logAccion('Disponible', `${v.placa} liberado a despacho`);
  renderAll();
  showToast('Disponible', `${v.placa} pasó a Despacho`, 'success');
}
function marcarDisponibleLote(n) {
  n = Math.max(1, n || 1);
  const lista = porLlegada(porEstado(EST.PATIO)).slice(0, n);
  if (!lista.length) return showToast('Nada que enviar', 'No hay camiones en patio', 'warning');
  const now = new Date().toISOString();
  lista.forEach(v => setEstado(v.id, EST.DISPONIBLE, { dispoTime: now, traficoPor: state.currentUserName }));
  logAccion('Disponible (lote)', `${lista.length} a despacho`);
  renderAll();
  showToast('Enviados a despacho', `${lista.length} camión(es)`, 'success');
}

function devolverAPatio(id) {
  const v = buscarViaje(id); if (!v) return;
  setEstado(id, EST.PATIO, { dispoTime: null, motivoPatio: null, motivoPatioHora: null });
  logAccion('Devuelto a patio', `${v.placa}`);
  renderAll();
  showToast('Regresado', `${v.placa} volvió a patio`, 'info');
}
function enviarASalida(id) {
  const v = buscarViaje(id); if (!v) return;
  setEstado(id, EST.LISTO);
  logAccion('Enviar a salida', `${v.placa}`);
  renderAll();
  showToast('A salida', `${v.placa} listo para salir por garita`, 'success');
}

/* ---- Render ---- */
function renderPatio() {
  const enPatioAll = porEstado(EST.PATIO);
  const dispoAll = porEstado(EST.DISPONIBLE);
  const despAll = porEstado(EST.LISTO, EST.CARGADO_PATIO);
  const setTxt = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  setTxt('patio-count', enPatioAll.length);
  setTxt('patio-dispo-count', dispoAll.length);
  setTxt('patio-desp-count', despAll.length);

  /* 1) EN PATIO */
  // Aplicar filtro texto + filtro tipo vehículo
  const enPatioTxt = filtrarLista(enPatioAll, patioFiltros.patio);
  const enPatio = porLlegada(aplicarFiltroVehiculo(enPatioTxt, patioFiltroVeh.patio));

  // Inyectar selector de vehículo en el toolbar de la sección (si existe)
  const toolbarVehPatio = document.getElementById('toolbar-filtro-veh-patio');
  if (toolbarVehPatio) toolbarVehPatio.innerHTML = _selectorFiltroVeh('patio', patioFiltroVeh.patio);

  const cont = document.getElementById('patio-lista');
  if (cont) {
    renderLista(cont, enPatio, v => {
      const sel = state.config.selPatio || { unidad: false, vehiculo: false, operacion: true };
      const optU = (state.config.catUnidad || ['Seco', 'Refrigerado']).map(u => `<option ${v.tipo_unidad === u ? 'selected' : ''}>${esc(u)}</option>`).join('');
      const optV = (state.config.catVehiculo || ['Rígido', 'Contenedor']).map(x => `<option ${v.tipoVehiculo === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
      const optO = [['descarga', 'Descarga'], ['carga', 'Carga'], ['descarga_carga', 'Descarga + Carga']].map(o => `<option value="${o[0]}" ${v.tipoOperacion === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('');

      return `
      <div class="patio-card ${agingClass(v.entrada, 'patio')} prio-${v.prioridad}">
        <div class="pc-head">
          <span class="pc-placa mono">${esc(v.placa)}</span>
          <span class="mono pc-time">${calcEspera(v.entrada)}</span>
        </div>
        <div class="pc-meta"><span class="mono">${esc(v.remolque || 'N/A')}</span> · ${esc(v.chofer || 'Sin chofer')} <span class="tipo-chip" style="vertical-align:middle">${esc(v.tipoVehiculo || '—')}</span></div>

        ${v.motivoPatio ? `<span class="demora-badge"><i data-lucide="alarm-clock"></i>${esc(v.motivoPatio)}</span>` : ''}
        <div class="patio-fields">
          <div class="pf-cell"><label>Operación</label><select class="form-input sm" onchange="setViajeCampo('${v.id}','tipoOperacion',this.value)">${optO}</select></div>
          <div class="pf-cell"><label>Temp.</label><select class="form-input sm" ${sel.unidad ? '' : 'disabled'} onchange="setViajeCampo('${v.id}','tipo_unidad',this.value)">${optU}</select></div>
          <div class="pf-cell"><label>Vehículo</label><select class="form-input sm" ${sel.vehiculo ? '' : 'disabled'} onchange="setViajeCampo('${v.id}','tipoVehiculo',this.value)">${optV}</select></div>
        </div>
        <div class="patio-actions">
          <button class="btn btn-ghost" data-action="registrar-demora" data-id="${v.id}" data-etapa="patio"><i data-lucide="alarm-clock"></i> Demora</button>
          <button class="btn btn-primary" data-action="marcar-dispo" data-id="${v.id}"><i data-lucide="arrow-right-circle"></i> Disponible</button>
        </div>
      </div>`;
    }, patioFiltros.patio || patioFiltroVeh.patio
      ? vacio('search-x', 'Nada coincide', 'Prueba otro filtro')
      : vacio('truck', 'Patio vacío', 'Las entradas de Garita aparecen aquí'));
  }

  /* 2) DISPONIBLES */
  const dispoTxt = filtrarLista(dispoAll, patioFiltros.dispo);
  const disponibles = porLlegada(aplicarFiltroVehiculo(dispoTxt, patioFiltroVeh.dispo));

  const toolbarVehDispo = document.getElementById('toolbar-filtro-veh-dispo');
  if (toolbarVehDispo) toolbarVehDispo.innerHTML = _selectorFiltroVeh('dispo', patioFiltroVeh.dispo);

  const dispo = document.getElementById('patio-disponibles');
  if (dispo) {
    renderLista(dispo, disponibles, (v, i) => `
      <div class="dispo-row ${agingClass(v.entrada, 'patio')}">
        <span class="turno-badge">${i + 1}</span>
        <div class="dr-id">
          <span class="mono dr-placa">${esc(v.placa)}</span>
          <span class="dr-meta"><span class="mono">${esc(v.remolque || 'N/A')}</span> · ${esc(v.chofer || '—')}</span>
        </div>
        <span class="tipo-chip">${esc(v.tipoVehiculo || '—')}</span>
        <span class="mono dr-time">${calcEspera(v.entrada)}</span>
        <button class="btn-mini" data-action="devolver-patio" data-id="${v.id}" title="Regresar a patio">↩</button>
      </div>`,
      patioFiltros.dispo || patioFiltroVeh.dispo ? vacio('search-x', 'Nada coincide', '') : vacio('inbox', 'Nada disponible', 'Marca un camión disponible desde la izquierda'));
  }

  /* 3) YA DESPACHADO · esperando salida */
  const despTxt = filtrarLista(despAll, patioFiltros.desp);
  const despachados = porLlegada(aplicarFiltroVehiculo(despTxt, patioFiltroVeh.desp));
  const carg = document.getElementById('patio-cargados-wrap');
  const cargList = document.getElementById('patio-cargados');
  if (carg) carg.style.display = despAll.length ? 'block' : 'none';

  const toolbarVehDesp = document.getElementById('toolbar-filtro-veh-desp');
  if (toolbarVehDesp) toolbarVehDesp.innerHTML = _selectorFiltroVeh('desp', patioFiltroVeh.desp);

  if (cargList) {
    renderLista(cargList, despachados, v => {
      const cargadoPatio = v.estado === EST.CARGADO_PATIO;
      return `
      <div class="desp-row ${durClass(minDesde(v.cargaFin), 'salida')}">
        <div class="dr-id">
          <span class="mono dr-placa">${esc(v.placa)}</span>
          <span class="dr-meta"><span class="mono">${esc(v.remolque || 'N/A')}</span> · ${esc(v.chofer || '—')}</span>
        </div>
        <span class="tipo-chip">${esc(v.tipoVehiculo || '—')}</span>
        <span class="mono dr-time">${calcEspera(v.entrada)}</span>
        ${v.motivoSalida ? `<span class="demora-badge sm"><i data-lucide="alarm-clock"></i>${esc(v.motivoSalida)}</span>` : ''}
        <button class="btn-mini" data-action="registrar-demora" data-id="${v.id}" data-etapa="salida" title="Motivo de demora"><i data-lucide="alarm-clock"></i></button>
        ${cargadoPatio ? `<button class="btn btn-primary btn-sm" data-action="enviar-salida" data-id="${v.id}">Enviar a salida</button>` : ''}
      </div>`;
    }, vacio('search-x', 'Nada coincide', ''));
  }
  icons();
}
