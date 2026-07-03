/* ============================================================
   API — Capa de acceso a datos → SUPABASE
   ============================================================
   Fase 2: este archivo reemplaza el api.js de localStorage.
   El resto del sistema (state.js, módulos UI) no cambia.

   REQUISITOS:
   · hatta.config.js con HATTA.supabase.url y HATTA.supabase.anonKey
   · SDK de Supabase cargado antes en index.html
   · Usuario autenticado con supabase.auth
   ============================================================ */

/* GUARDIA: sin credenciales el sistema no puede arrancar.
   Mostrar el problema en pantalla en vez de morir en silencio. */
if (!HATTA.supabase || !HATTA.supabase.url || !HATTA.supabase.anonKey) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML =
      '<div style="max-width:520px;margin:80px auto;padding:28px;font-family:system-ui;' +
      'background:#1e293b;color:#f1f5f9;border-radius:12px;border:1px solid #f59e0b">' +
      '<h2 style="margin:0 0 12px">⚠ Falta configurar Supabase</h2>' +
      '<p>Abre <code>js/hatta.config.js</code> y pega tu <strong>Project URL</strong> y tu ' +
      '<strong>anon public key</strong> en el bloque <code>supabase</code>.</p>' +
      '<p style="opacity:.7">Se obtienen en: Supabase → Settings → API</p></div>';
  });
  throw new Error('HATTA: configura HATTA.supabase.url y anonKey en js/hatta.config.js');
}

const _sb = supabase.createClient(
  HATTA.supabase.url,
  HATTA.supabase.anonKey
);

let _session = null;

const _subs   = [];
const _rtSubs = [];

const api = {

  onCambio(cb) { if (typeof cb === 'function') _subs.push(cb); },
  notificar()  { _subs.forEach(cb => { try { cb(); } catch {} }); },
  setSession(s) { _session = s; },
  getSession()  { return _session; },

  _eid() { return _session && _session.empresa_id; },

  _err(ctx, err) {
    console.error(`[HATTA API] ${ctx}:`, err);
    if (typeof showToast === 'function')
      showToast('Error de datos', `${ctx}: ${err.message || err}`, 'danger');
  },

  /* ---- AUTH ---- */
  auth: {
    async login(email, password) {
      const { data, error } = await _sb.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: error.message };

      const { data: perfil, error: pe } = await _sb
        .from('usuarios')
        .select('id, empresa_id, nombre, rol, activo')
        .eq('auth_id', data.user.id)
        .single();

      if (pe || !perfil) { await _sb.auth.signOut(); return { ok: false, error: 'Usuario no configurado.' }; }
      if (!perfil.activo) { await _sb.auth.signOut(); return { ok: false, error: 'Usuario inactivo.' }; }

      _session = {
        auth_id: data.user.id, usuario_id: perfil.id,
        empresa_id: perfil.empresa_id, nombre: perfil.nombre,
        rol: perfil.rol, email: data.user.email,
      };
      await _sb.from('usuarios').update({ ultimo_login: new Date().toISOString() }).eq('id', perfil.id);
      return { ok: true, session: _session };
    },

    async logout() {
      _session = null;
      _rtSubs.forEach(s => s.unsubscribe());
      _rtSubs.length = 0;
      await _sb.auth.signOut();
    },

    async restaurarSesion() {
      const { data: { session } } = await _sb.auth.getSession();
      if (!session) return null;
      const { data: perfil } = await _sb
        .from('usuarios').select('id, empresa_id, nombre, rol, activo')
        .eq('auth_id', session.user.id).single();
      if (!perfil || !perfil.activo) return null;
      _session = {
        auth_id: session.user.id, usuario_id: perfil.id,
        empresa_id: perfil.empresa_id, nombre: perfil.nombre,
        rol: perfil.rol, email: session.user.email,
      };
      return _session;
    },

    getClient() { return _sb; },
  },

  /* ---- VIAJES ---- */
  viajes: {
    async leer() {
      const eid = api._eid(); if (!eid) return [];
      const { data, error } = await _sb.from('viajes').select('*')
        .eq('empresa_id', eid).order('entrada', { ascending: true });
      if (error) { api._err('viajes.leer', error); return []; }
      return (data || []).map(fromDB_viaje);
    },
    async insertar(v) {
      const eid = api._eid(); if (!eid) return null;
      const { data, error } = await _sb.from('viajes').insert(toDB_viaje(v, eid)).select().single();
      if (error) { api._err('viajes.insertar', error); return null; }
      return fromDB_viaje(data);
    },
    async insertarLote(lista) {
      const eid = api._eid(); if (!eid || !lista.length) return false;
      const { error } = await _sb.from('viajes').insert(lista.map(v => toDB_viaje(v, eid)));
      if (error) { api._err('viajes.insertarLote', error); return false; }
      return true;
    },
    async actualizar(id, campos) {
      const { error } = await _sb.from('viajes').update(toDB_viaje(campos)).eq('id', id);
      if (error) { api._err('viajes.actualizar', error); return false; }
      return true;
    },
    async eliminar(id) {
      const { error } = await _sb.from('viajes').delete().eq('id', id);
      if (error) { api._err('viajes.eliminar', error); return false; }
      return true;
    },
  },

  /* ---- HISTORIAL ---- */
  historial: {
    async leer(limit = HATTA.HISTORY_CAP) {
      const eid = api._eid(); if (!eid) return [];
      const { data, error } = await _sb.from('historial').select('*')
        .eq('empresa_id', eid).order('entrada', { ascending: false }).limit(limit);
      if (error) { api._err('historial.leer', error); return []; }
      return (data || []).map(fromDB_historial);
    },
    async insertar(v) {
      const eid = api._eid(); if (!eid) return false;
      const { error } = await _sb.from('historial').insert(toDB_historial(v, eid));
      if (error) { api._err('historial.insertar', error); return false; }
      return true;
    },
    async insertarLote(lista) {
      const eid = api._eid(); if (!eid || !lista.length) return false;
      const { error } = await _sb.from('historial').insert(lista.map(h => toDB_historial(h, eid)));
      if (error) { api._err('historial.insertarLote', error); return false; }
      return true;
    },
  },

  /* ---- RECHAZOS ---- */
  rechazos: {
    async leer() {
      const eid = api._eid(); if (!eid) return [];
      const { data, error } = await _sb.from('rechazos').select('*')
        .eq('empresa_id', eid).order('hora', { ascending: false }).limit(200);
      if (error) { api._err('rechazos.leer', error); return []; }
      return data || [];
    },
    async insertar(r) {
      const eid = api._eid(); if (!eid) return false;
      const { error } = await _sb.from('rechazos').insert({ ...r, empresa_id: eid });
      if (error) { api._err('rechazos.insertar', error); return false; }
      return true;
    },
  },

  /* ---- DEMORAS ---- */
  demoras: {
    async leer() {
      const eid = api._eid(); if (!eid) return [];
      const { data, error } = await _sb.from('demoras').select('*')
        .eq('empresa_id', eid).order('hora', { ascending: false }).limit(300);
      if (error) { api._err('demoras.leer', error); return []; }
      return data || [];
    },
    async insertar(d) {
      const eid = api._eid(); if (!eid) return false;
      const { error } = await _sb.from('demoras').insert({ ...d, empresa_id: eid });
      if (error) { api._err('demoras.insertar', error); return false; }
      return true;
    },
  },

  /* ---- RAMPAS ---- */
  rampas: {
    async leer() {
      const eid = api._eid(); if (!eid) return [];
      const { data, error } = await _sb.from('rampas').select('*')
        .eq('empresa_id', eid).order('num');
      if (error) { api._err('rampas.leer', error); return []; }
      return data || [];
    },
    async actualizarEstado(num, activa, motivo) {
      const eid = api._eid(); if (!eid) return false;
      const { error } = await _sb.from('rampas')
        .update({ activa, motivo_baja: motivo || null })
        .eq('empresa_id', eid).eq('num', num);
      if (error) { api._err('rampas.actualizar', error); return false; }
      return true;
    },
  },

  /* ---- VEHICULOS ---- */
  vehiculos: {
    async leer() {
      const eid = api._eid(); if (!eid) return [];
      // Se cargan TODOS (activos e inactivos): el motor de catálogos
      // muestra los inactivos y los módulos operativos los filtran.
      const { data, error } = await _sb.from('vehiculos').select('*').eq('empresa_id', eid);
      if (error) { api._err('vehiculos.leer', error); return []; }
      return data || [];
    },
    async insertar(v) {
      const eid = api._eid(); if (!eid) return null;
      const { data, error } = await _sb.from('vehiculos').insert({ ...v, empresa_id: eid }).select().single();
      if (error) { api._err('vehiculos.insertar', error); return null; }
      return data;
    },
    async actualizar(id, campos) {
      const { placa, tipo, transportista, activo } = campos;
      const { error } = await _sb.from('vehiculos')
        .update({ placa, tipo, transportista, activo }).eq('id', id);
      if (error) { api._err('vehiculos.actualizar', error); return false; }
      return true;
    },
    async eliminar(id) {
      const { error } = await _sb.from('vehiculos').delete().eq('id', id);
      if (error) { api._err('vehiculos.eliminar', error); return false; }
      return true;
    },
  },

  /* ---- CHOFERES ---- */
  choferes: {
    async leer() {
      const eid = api._eid(); if (!eid) return [];
      const { data, error } = await _sb.from('choferes').select('*').eq('empresa_id', eid);
      if (error) { api._err('choferes.leer', error); return []; }
      return data || [];
    },
    async insertar(c) {
      const eid = api._eid(); if (!eid) return null;
      const { data, error } = await _sb.from('choferes').insert({ ...c, empresa_id: eid }).select().single();
      if (error) { api._err('choferes.insertar', error); return null; }
      return data;
    },
    async actualizar(id, campos) {
      const { nombre, cedula, placa, activo } = campos;
      const { error } = await _sb.from('choferes')
        .update({ nombre, cedula, placa, activo }).eq('id', id);
      if (error) { api._err('choferes.actualizar', error); return false; }
      return true;
    },
    async eliminar(id) {
      const { error } = await _sb.from('choferes').delete().eq('id', id);
      if (error) { api._err('choferes.eliminar', error); return false; }
      return true;
    },
  },

  /* ---- USUARIOS ---- */
  usuarios: {
    async leer() {
      const eid = api._eid(); if (!eid) return [];
      const { data, error } = await _sb.from('usuarios')
        .select('id, nombre, rol, activo, ultimo_login').eq('empresa_id', eid);
      if (error) { api._err('usuarios.leer', error); return []; }
      return data || [];
    },
    async desactivar(id) {
      const { error } = await _sb.from('usuarios').update({ activo: false }).eq('id', id);
      if (error) { api._err('usuarios.desactivar', error); return false; }
      return true;
    },
  },

  /* ---- CATALOGOS (tabla compartida: tipo + datos jsonb) ----
     Un catálogo nuevo NO requiere migración SQL: solo se define
     en HATTA.CATALOGOS y se guarda aquí con su `tipo`. */
  catalogos: {
    async leerTodos() {
      const eid = api._eid(); if (!eid) return {};
      const { data, error } = await _sb.from('catalogos').select('*').eq('empresa_id', eid);
      if (error) { api._err('catalogos.leer', error); return {}; }
      const porTipo = {};
      (data || []).forEach(row => {
        if (!porTipo[row.tipo]) porTipo[row.tipo] = [];
        porTipo[row.tipo].push(Object.assign({ id: row.id, activo: row.activo }, row.datos || {}));
      });
      return porTipo;
    },
    async insertar(tipo, item) {
      const eid = api._eid(); if (!eid) return null;
      const { id, activo, ...datos } = item;
      const { data, error } = await _sb.from('catalogos')
        .insert({ id, empresa_id: eid, tipo, activo: activo !== false, datos })
        .select().single();
      if (error) { api._err('catalogos.insertar', error); return null; }
      return Object.assign({ id: data.id, activo: data.activo }, data.datos || {});
    },
    async actualizar(id, item) {
      const { id: _i, activo, ...datos } = item;
      const { error } = await _sb.from('catalogos')
        .update({ activo: activo !== false, datos }).eq('id', id);
      if (error) { api._err('catalogos.actualizar', error); return false; }
      return true;
    },
    async eliminar(id) {
      const { error } = await _sb.from('catalogos').delete().eq('id', id);
      if (error) { api._err('catalogos.eliminar', error); return false; }
      return true;
    },
  },

  /* ---- CONFIG ---- */
  config: {
    async leer() {
      const eid = api._eid(); if (!eid) return null;
      const { data, error } = await _sb.from('config_empresa').select('*').eq('empresa_id', eid).single();
      if (error) { api._err('config.leer', error); return null; }
      return fromDB_config(data);
    },
    async guardar(cfg) {
      const eid = api._eid(); if (!eid) return false;
      const { error } = await _sb.from('config_empresa').update(toDB_config(cfg)).eq('empresa_id', eid);
      if (error) { api._err('config.guardar', error); return false; }
      return true;
    },
  },

  /* ---- BITACORA ---- */
  bitacora: {
    async leer(limit = HATTA.ui.bitacoraLimit) {
      const eid = api._eid(); if (!eid) return [];
      const { data, error } = await _sb.from('bitacora').select('*')
        .eq('empresa_id', eid).order('ts', { ascending: false }).limit(limit);
      if (error) { api._err('bitacora.leer', error); return []; }
      return data || [];
    },
    async insertar(e) {
      const eid = api._eid(); if (!eid) return false;
      const { error } = await _sb.from('bitacora').insert({
        empresa_id: eid,
        usuario_id: _session && _session.usuario_id,
        usuario: e.usuario, rol: e.rol, accion: e.accion, detalle: e.detalle,
      });
      if (error) console.warn('[HATTA] bitacora.insertar:', error.message);
      return !error;
    },
  },

  /* ---- REALTIME ---- */
  realtime: {
    suscribir() {
      const eid = api._eid(); if (!eid) return;
      const canal = _sb.channel(`empresa-${eid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes', filter: `empresa_id=eq.${eid}` },
          () => {
            // Debounce: una ráfaga de eventos (p.ej. carga demo de 100
            // filas) dispara UNA sola relectura, no cien.
            clearTimeout(api.realtime._t);
            api.realtime._t = setTimeout(api.realtime._refrescar, 700);
          })
        .subscribe();
      _rtSubs.push(canal);
    },
    _t: null,
    _refrescar() {
      // Nunca reemplazar el estado local con una lectura fallida:
      // si leer() falla o llega sin sesión devuelve [], y pisarlo
      // borraría de pantalla entradas recién registradas.
      if (!api._eid()) return;
      api.viajes.leer().then(vs => {
        if (Array.isArray(vs) && (vs.length || state.viajes.length === 0)) {
          state.viajes = vs; api.notificar();
          if (typeof renderAll === 'function') renderAll();
        }
      }).catch(() => {});
    },
    desuscribir() {
      _rtSubs.forEach(s => s.unsubscribe());
      _rtSubs.length = 0;
    },
  },

  guardarTodo: async () => true,
  reset: async () => true,
};

/* ---- MAPPERS ---- */
function toDB_viaje(v, eid) {
  const r = {};
  if (eid)                  r.empresa_id          = eid;
  if (v.id)                 r.id                  = v.id;
  if (v.tx != null)         r.tx                  = v.tx;
  if (v.placa)              r.placa               = v.placa;
  if (v.remolque != null)   r.remolque            = v.remolque;
  if (v.cedula != null)     r.cedula              = v.cedula;
  if (v.chofer != null)     r.chofer              = v.chofer;
  if (v.tipo_unidad != null) r.tipo_unidad        = v.tipo_unidad;
  if (v.tipoVehiculo != null) r.tipo_vehiculo     = v.tipoVehiculo;
  if (v.entidad != null)    r.entidad             = v.entidad;
  if (v.prioridad)          r.prioridad           = v.prioridad;
  if (v.tipoOperacion)      r.tipo_operacion      = v.tipoOperacion;
  if (v.destino != null)    r.destino             = v.destino;
  if (v.estado)             r.estado              = v.estado;
  if (v.dock != null)       r.dock                = v.dock;
  if (v.entrada)            r.entrada             = v.entrada;
  if (v.dispoTime != null)  r.dispo_time          = v.dispoTime;
  if (v.dockTime != null)   r.dock_time           = v.dockTime;
  if (v.cargaInicio != null) r.carga_inicio       = v.cargaInicio;
  if (v.cargaFin != null)   r.carga_fin           = v.cargaFin;
  if (v.turno != null)      r.turno               = v.turno;
  if (v.metodoAcceso != null) r.metodo_acceso     = v.metodoAcceso;
  if (v.registradoPor != null) r.registrado_por   = v.registradoPor;
  if (v.garitaEntradaPor != null) r.garita_entrada_por = v.garitaEntradaPor;
  if (v.traficoPor != null) r.trafico_por         = v.traficoPor;
  if (v.despachoPor != null) r.despacho_por       = v.despachoPor;
  if (v.motivoPatio != null) r.motivo_patio       = v.motivoPatio;
  if (v.motivoPatioHora != null) r.motivo_patio_hora = v.motivoPatioHora;
  if (v.motivoDespacho != null) r.motivo_despacho = v.motivoDespacho;
  if (v.motivoDespachoHora != null) r.motivo_despacho_hora = v.motivoDespachoHora;
  if (v.motivoSalida != null) r.motivo_salida     = v.motivoSalida;
  return r;
}

function fromDB_viaje(row) {
  return {
    id: row.id, tx: row.tx, placa: row.placa, remolque: row.remolque,
    cedula: row.cedula, chofer: row.chofer, tipo_unidad: row.tipo_unidad,
    tipoVehiculo: row.tipo_vehiculo, entidad: row.entidad,
    prioridad: row.prioridad || 'normal', tipoOperacion: row.tipo_operacion || 'descarga',
    destino: row.destino, estado: row.estado, dock: row.dock,
    entrada: row.entrada, dispoTime: row.dispo_time, dockTime: row.dock_time,
    cargaInicio: row.carga_inicio, cargaFin: row.carga_fin, turno: row.turno,
    metodoAcceso: row.metodo_acceso, registradoPor: row.registrado_por,
    garitaEntradaPor: row.garita_entrada_por, traficoPor: row.trafico_por,
    despachoPor: row.despacho_por, motivoPatio: row.motivo_patio,
    motivoPatioHora: row.motivo_patio_hora, motivoDespacho: row.motivo_despacho,
    motivoDespachoHora: row.motivo_despacho_hora, motivoSalida: row.motivo_salida,
  };
}

function toDB_historial(v, eid) {
  return {
    empresa_id: eid, id: v.id, tx: v.tx, placa: v.placa, remolque: v.remolque,
    cedula: v.cedula, chofer: v.chofer, tipo_unidad: v.tipo_unidad,
    tipo_vehiculo: v.tipoVehiculo, entidad: v.entidad, prioridad: v.prioridad,
    tipo_operacion: v.tipoOperacion, destino: v.destino, estado: 'finalizado',
    dock: v.dock, rampa_usada: v.rampaUsada,
    entrada: v.entrada, dispo_time: v.dispoTime, dock_time: v.dockTime,
    carga_inicio: v.cargaInicio, carga_fin: v.cargaFin, salida: v.salida,
    turno: v.turno, turno_salida: v.turnoSalida,
    metodo_acceso: v.metodoAcceso, metodo_salida: v.metodoSalida,
    registrado_por: v.registradoPor, garita_entrada_por: v.garitaEntradaPor,
    trafico_por: v.traficoPor, despacho_por: v.despachoPor,
    garita_salida_por: v.garitaSalidaPor,
    motivo_patio: v.motivoPatio, motivo_despacho: v.motivoDespacho, motivo_salida: v.motivoSalida,
  };
}

function fromDB_historial(row) {
  return {
    id: row.id, tx: row.tx, placa: row.placa, remolque: row.remolque,
    cedula: row.cedula, chofer: row.chofer, tipo_unidad: row.tipo_unidad,
    tipoVehiculo: row.tipo_vehiculo, entidad: row.entidad, prioridad: row.prioridad,
    tipoOperacion: row.tipo_operacion, destino: row.destino, estado: row.estado,
    dock: row.dock, rampaUsada: row.rampa_usada,
    entrada: row.entrada, dispoTime: row.dispo_time, dockTime: row.dock_time,
    cargaInicio: row.carga_inicio, cargaFin: row.carga_fin, salida: row.salida,
    turno: row.turno, turnoSalida: row.turno_salida,
    metodoAcceso: row.metodo_acceso, metodoSalida: row.metodo_salida,
    registradoPor: row.registrado_por, garitaEntradaPor: row.garita_entrada_por,
    traficoPor: row.trafico_por, despachoPor: row.despacho_por,
    garitaSalidaPor: row.garita_salida_por,
    motivoPatio: row.motivo_patio, motivoDespacho: row.motivo_despacho, motivoSalida: row.motivo_salida,
  };
}

function fromDB_config(row) {
  if (!row) return null;
  return {
    modoSalida: row.modo_salida, sla: row.sla,
    catUnidad: row.cat_unidad, catVehiculo: row.cat_vehiculo,
    motivosDemora: row.motivos_demora, motivosRampa: row.motivos_rampa,
    selPatio: row.sel_patio,
    numRampas: row.num_rampas || null,
  };
}

function toDB_config(cfg) {
  return {
    modo_salida: cfg.modoSalida, sla: cfg.sla,
    cat_unidad: cfg.catUnidad, cat_vehiculo: cfg.catVehiculo,
    motivos_demora: cfg.motivosDemora, motivos_rampa: cfg.motivosRampa,
    sel_patio: cfg.selPatio,
    num_rampas: cfg.numRampas || HATTA.NUM_RAMPAS,
  };
}
