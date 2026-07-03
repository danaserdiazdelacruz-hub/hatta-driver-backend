/* ============================================================
   STATE — Modelo central de datos y operaciones
   ============================================================
   FILOSOFÍA:
   · state{} es el único objeto en memoria con datos en vivo
   · Toda lectura/escritura pasa por api.js (no localStorage directo)
   · HATTA.config es la fuente de constantes y defaults
   · Los módulos de UI leen de state{} pero nunca escriben directamente
     — usan las funciones exportadas aquí (setEstado, saveDatabase, etc.)
   ============================================================ */

/* ----------------------------------------------------------
   numRampas() — ÚNICA fuente del total de rampas de la empresa.
   Configurable en Maestro → Rampas (config.numRampas).
   Ningún módulo debe leer HATTA.NUM_RAMPAS directamente.
---------------------------------------------------------- */
function numRampas() {
  const n = state && state.config && state.config.numRampas;
  return (n && n >= 1 && n <= HATTA.MAX_RAMPAS) ? n : HATTA.NUM_RAMPAS;
}

/* ---- Alias de conveniencia para los estados ---- */
const EST = {
  PATIO:         'patio',
  DISPONIBLE:    'disponible',
  PENDIENTE:     'pendiente',
  CARGANDO:      'cargando',
  LISTO:         'listo_salida',
  CARGADO_PATIO: 'cargado_patio',
};

/* ---- Diccionario de estados — ahora vive en HATTA.config ---- */
function estadoInfo(v) {
  const info = HATTA.estados[v && v.estado];
  return info || {
    etiqueta: (v && v.estado) || '—',
    lugar: '—', estadoCorto: (v && v.estado) || '—',
    fase: (v && v.estado) || '—', cls: '', ucls: 'u-gray',
    icon: 'circle', tab: 'patio', slaEtapa: 'patio', desdeField: 'entrada',
  };
}

function _conDock(txt, v) {
  return String(txt).replace('{dock}', (v && v.dock != null) ? v.dock : '—');
}

/* ----------------------------------------------------------
   STATE — objeto central (único en memoria)
   Todos los módulos leen de aquí. Solo api.js + estas
   funciones escriben en él.
---------------------------------------------------------- */
let state = {
  // Datos operativos
  viajes:   [],
  history:  [],
  rechazos: [],
  demoras:  [],
  bitacora: [],

  // Configuración de rampas
  docksActive: Array(HATTA.NUM_RAMPAS).fill(true),
  docksMotivo: {},

  // Maestro
  vehiculos: [],
  choferes:  [],
  users:     [],

  // Catálogos jsonb (transportistas, destinos, …) — los gestiona
  // el motor de catalogos.js; nunca escribir aquí directo.
  catalogos: {},

  // Configuración de empresa (se sobrescribe con lo que viene de api/Supabase)
  config: {
    modoSalida:    HATTA.defaults.modoSalida,
    sla:           JSON.parse(JSON.stringify(HATTA.defaults.sla)),
    motivosDemora: [...HATTA.defaults.motivosDemora],
    motivosRampa:  [...HATTA.defaults.motivosRampa],
    catUnidad:     [...HATTA.defaults.catUnidad],
    catVehiculo:   [...HATTA.defaults.catVehiculo],
    selPatio:      { ...HATTA.defaults.selPatio },
  },

  // Contadores
  txCounter: 0,

  // Sesión activa
  currentUser:     null,
  currentUserName: '',

  // Selección UI transitoria (no se persiste)
  selViaje: null,
  selDock:  null,
};

/* ----------------------------------------------------------
   PERSISTENCIA — carga y guarda usando api.js
---------------------------------------------------------- */
function loadDatabase() {
  // Supabase: la carga inicial la hace _cargarEstadoInicial() en auth.js
  // Esta función queda como no-op de compatibilidad.
  return;
}
function _loadDatabase_UNUSED() {
  // cuerpo original conservado como referencia:
  // Usamos valores síncronos porque en esta fase localStorage es síncrono.
  // En Fase 2 esto se convierte en async/await con Supabase.
  const get = (clave, def) => {
    try { const v = JSON.parse(localStorage.getItem(HATTA.LS_PREFIX + clave)); return v ?? def; }
    catch { return def; }
  };

  state.viajes    = (get('viajes', []) || []).filter(Boolean);
  state.history   = get('history', []) || [];
  state.rechazos  = get('rechazos', []) || [];
  state.demoras   = get('demoras', []) || [];
  state.bitacora  = get('bitacora', []) || [];
  state.txCounter = get('txcounter', 0) || 0;
  state.vehiculos = get('vehiculos', []) || [];
  state.choferes  = get('choferes', []) || [];

  // Rampas
  const docksRaw = get('docks', null);
  if (Array.isArray(docksRaw) && docksRaw.length === numRampas()) {
    state.docksActive = docksRaw;
  } else {
    state.docksActive = Array(numRampas()).fill(true);
    if (Array.isArray(docksRaw)) {
      docksRaw.forEach((v, i) => { if (i < numRampas()) state.docksActive[i] = v; });
    }
  }
  state.docksMotivo = get('docks_motivo', {});

  // Config — merge de lo guardado sobre los defaults
  _cargarConfig(get('config', {}));

  // Usuarios
  const usersRaw = get('users', null);
  if (Array.isArray(usersRaw) && usersRaw.length > 0) {
    state.users = usersRaw;
  } else {
    state.users = [
      { id: 1, name: 'Admin Principal', pin: '1234', role: 'admin' },
      { id: 2, name: 'Tráfico Default',  pin: '2222', role: 'trafico' },
    ];
    saveDatabase();
  }
}

function _cargarConfig(raw) {
  const def = HATTA.defaults;
  const cfg = Object.assign({
    modoSalida:    def.modoSalida,
    sla:           JSON.parse(JSON.stringify(def.sla)),
    motivosDemora: [...def.motivosDemora],
    motivosRampa:  [...def.motivosRampa],
    catUnidad:     [...def.catUnidad],
    catVehiculo:   [...def.catVehiculo],
    selPatio:      { ...def.selPatio },
  }, raw);

  // Migración SLA: formato viejo plano → por etapa
  if (!cfg.sla || typeof cfg.sla.warn === 'number') {
    const w = (cfg.sla && typeof cfg.sla.warn === 'number') ? cfg.sla.warn : def.sla.patio.warn;
    const d = (cfg.sla && typeof cfg.sla.danger === 'number') ? cfg.sla.danger : def.sla.patio.danger;
    cfg.sla = JSON.parse(JSON.stringify(def.sla));
    cfg.sla.patio = { warn: w, danger: d };
  }
  for (const k in def.sla) {
    if (!cfg.sla[k] || typeof cfg.sla[k].warn !== 'number') {
      cfg.sla[k] = { ...def.sla[k] };
    }
  }

  // Garantizar arrays no vacíos para catálogos
  if (!Array.isArray(cfg.motivosDemora) || !cfg.motivosDemora.length) cfg.motivosDemora = [...def.motivosDemora];
  if (!Array.isArray(cfg.motivosRampa)  || !cfg.motivosRampa.length)  cfg.motivosRampa  = [...def.motivosRampa];
  if (!Array.isArray(cfg.catUnidad)     || !cfg.catUnidad.length)     cfg.catUnidad     = [...def.catUnidad];
  if (!Array.isArray(cfg.catVehiculo)   || !cfg.catVehiculo.length)   cfg.catVehiculo   = [...def.catVehiculo];
  if (!cfg.selPatio || typeof cfg.selPatio !== 'object')             cfg.selPatio      = { ...def.selPatio };

  state.config = cfg;
}

function saveDatabase() {
  // En Supabase, cada operación guarda directamente via api.*.actualizar/insertar.
  // saveDatabase() solo notifica a los módulos de UI para que se redibuje.
  // Las operaciones individuales (setEstado, garita, despacho, etc.) ya
  // llaman a api.viajes.actualizar() / api.viajes.insertar() por su cuenta.
  api.notificar();
}

function resetSystem() {
  uiConfirm(
    'Cerrar sesión',
    'Para borrar datos de producción, usa el panel de Supabase directamente. Esta acción cerrará la sesión.',
    () => { logout(); },
    { danger: false, okText: 'Cerrar sesión' }
  );
}

/* ----------------------------------------------------------
   HELPERS DE CONSULTA — módulos de UI usan estos
---------------------------------------------------------- */
function porEstado(...estados) {
  return state.viajes.filter(v => estados.includes(v.estado));
}

function buscarViaje(id) {
  return state.viajes.find(v => v.id === id) || null;
}

function ocupanteDe(num) {
  return state.viajes.find(v =>
    v.dock === num && (v.estado === EST.PENDIENTE || v.estado === EST.CARGANDO)
  ) || null;
}

/* ----------------------------------------------------------
   MUTACIONES — módulos de UI llaman estas funciones
   Nunca modifican state{} directamente.
---------------------------------------------------------- */
function setEstado(id, estado, extra = {}) {
  const v = buscarViaje(id);
  if (!v) return null;
  v.estado = estado;
  Object.assign(v, extra);
  // Persistir en Supabase (fire-and-forget)
  const campos = { estado, ...extra };
  api.viajes.actualizar(id, campos).catch(e => console.error('setEstado:', e));
  api.notificar();
  return v;
}

/* ----------------------------------------------------------
   BITÁCORA — registro de auditoría
   En Supabase: INSERT en tabla audit_log con empresaId, sucursalId,
   usuarioId, ip, userAgent, etc. Hoy: array en memoria/localStorage.
---------------------------------------------------------- */
function logAccion(accion, detalle) {
  // Registrar en memoria local (UI inmediata)
  if (!Array.isArray(state.bitacora)) state.bitacora = [];
  const entrada = {
    id:        uid(),
    empresaId: api.getSession() ? api.getSession().empresa_id : HATTA.empresaId,
    ts:        new Date().toISOString(),
    usuario:   state.currentUserName || 'Sistema',
    rol:       state.currentUser     || '',
    accion:    accion  || '',
    detalle:   detalle || '',
  };
  state.bitacora.unshift(entrada);
  if (state.bitacora.length > HATTA.BITACORA_CAP) {
    state.bitacora = state.bitacora.slice(0, HATTA.BITACORA_CAP);
  }
  // Persistir en Supabase (fire-and-forget — no bloquea la UI)
  api.bitacora.insertar(entrada).catch(() => {});
}

/* ----------------------------------------------------------
   TX COUNTER — número correlativo de transacción
---------------------------------------------------------- */
function nuevoTx() {
  state.txCounter = (state.txCounter || 0) + 1;
  return 'HT-' + String(state.txCounter).padStart(5, '0');
}
