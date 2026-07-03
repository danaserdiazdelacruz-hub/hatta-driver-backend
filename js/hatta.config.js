/* ============================================================
   HATTA.CONFIG — Fuente única de verdad
   ============================================================
   FILOSOFÍA:
   Todo valor que pueda variar por empresa, instalación o
   preferencia operativa vive aquí. El resto del código lee
   de este objeto. Cuando llegue Supabase, solo este archivo
   cambia — los módulos no se enteran.

   CAPAS:
   1. SISTEMA   — constantes técnicas que el operador nunca ve
   2. OPERACIÓN — valores que el admin configura en Maestro
   3. UI        — comportamiento de la interfaz
   ============================================================ */

const HATTA = {

  /* ----------------------------------------------------------
     1. SISTEMA
  ---------------------------------------------------------- */
  version: '4.1.0',

  // Identificador de empresa (preparado para multi-tenant / Supabase)
  // En esta fase sigue siendo un valor fijo; en Supabase vendrá del login.
  empresaId: 'empresa-default',

  // Rampas por defecto para una empresa nueva.
  // El total real por empresa vive en Maestro → Rampas (config.numRampas).
  // Los módulos deben leer numRampas(), nunca esta constante directa.
  NUM_RAMPAS: 60,

  // Techo absoluto del sistema (protege el grid y el rendimiento)
  MAX_RAMPAS: 120,

  // Máximo de registros históricos en memoria local
  HISTORY_CAP: 5000,

  // Máximo de entradas en bitácora de auditoría
  BITACORA_CAP: 1000,

  // Intervalo de auto-refresh en milisegundos
  REFRESH_INTERVAL_MS: 30000,

  // Intervalo de refresco de la vista 360
  REFRESH_360_MS: 10000,

  // Intervalo del modo TV (dashboard en pantalla grande)
  REFRESH_TV_MS: 8000,

  // Prefijo de las claves de localStorage (cambiar si hay varios HATTA en el mismo dominio)
  LS_PREFIX: 'yms_w_',

  /* ----------------------------------------------------------
     2. OPERACIÓN — defaults que el admin puede sobrescribir
     desde Maestro. Estos valores aplican si el admin aún no
     configuró nada.
  ---------------------------------------------------------- */
  defaults: {

    // SLA por etapa (en minutos)
    sla: {
      patio:  { warn: 30,  danger: 60  },
      carga:  { warn: 45,  danger: 90  },
      salida: { warn: 15,  danger: 30  },
      total:  { warn: 90,  danger: 180 },
    },

    // Comportamiento al finalizar carga
    // 'garita' → el camión queda listo para salir por garita
    // 'patio'  → el camión queda cargado en patio esperando orden de salida
    modoSalida: 'garita',

    // Catálogos de clasificación (el admin puede editarlos desde Maestro)
    catUnidad: ['Seco', 'Frío', 'Termo'],

    catVehiculo: [
      'Rígido',
      'Contenedor',
      'Cola abierta',
      'De cortina',
      'Dolly',
      'Plataforma',
      'Camioneta',
    ],

    // Motivos predefinidos para registrar demoras en Patio
    motivosDemora: [
      'Espera de documentación',
      'No hay rampa disponible',
      'Chofer ausente',
      'Avería mecánica',
      'Carga no lista',
    ],

    // Motivos predefinidos para desactivar una rampa
    motivosRampa: [
      'Avería',
      'Mantenimiento',
      'Limpieza',
      'Bloqueada',
    ],

    // Qué campos son editables en la tarjeta de Patio
    // false → se muestra pero el operador de tráfico no puede cambiarlo
    selPatio: {
      unidad:    false,   // Temperatura/tipo de carga
      vehiculo:  false,   // Tipo de vehículo
      operacion: true,    // Operación (descarga / carga / descarga+carga)
    },
  },

  /* ----------------------------------------------------------
     2.5 CATÁLOGOS — definiciones declarativas del Maestro
     ============================================================
     REGLA DE ORO: agregar un catálogo nuevo = agregar un bloque
     aquí. NO se escribe código nuevo. El motor (catalogos.js)
     genera formulario, tabla, validación, auditoría y
     persistencia a partir de esta definición.

     storage:
       'tabla' → tabla propia en Supabase (vehiculos, choferes)
       'jsonb' → tabla compartida `catalogos` (tipo + datos jsonb)
                 → los catálogos nuevos NO requieren migración SQL

     campos[].tipo:
       'texto' | 'numero' | 'lista' (select) | 'ref' (datalist
       alimentado por otro catálogo)

     campoPrincipal: el campo que representa al registro en
     selects, auditoría y validación de duplicados.
  ---------------------------------------------------------- */
  CATALOGOS: {

    vehiculos: {
      titulo: 'Vehículos', singular: 'vehículo', icono: 'truck',
      storage: 'tabla', stateKey: 'vehiculos', apiKey: 'vehiculos',
      campoPrincipal: 'placa',
      campos: [
        { key: 'placa', label: 'Placa', tipo: 'texto', requerido: true, unico: true, mayus: true, min: 2 },
        { key: 'tipo', label: 'Tipo', tipo: 'lista', opcionesDe: 'config.catUnidad' },
        { key: 'transportista', label: 'Transportista', tipo: 'ref', ref: 'transportistas' },
      ],
    },

    choferes: {
      titulo: 'Choferes', singular: 'chofer', icono: 'user',
      storage: 'tabla', stateKey: 'choferes', apiKey: 'choferes',
      campoPrincipal: 'nombre',
      ayuda: 'Con cédula y placa se usan en el acceso facial/huella de Garita.',
      campos: [
        { key: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true, min: 2 },
        { key: 'cedula', label: 'Cédula', tipo: 'texto' },
        { key: 'placa', label: 'Placa', tipo: 'texto', mayus: true },
      ],
    },

    transportistas: {
      titulo: 'Transportistas', singular: 'transportista', icono: 'building-2',
      storage: 'jsonb',
      campoPrincipal: 'nombre',
      ayuda: 'Alimenta el campo Transportista de Vehículos y la entidad del viaje.',
      campos: [
        { key: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true, unico: true, min: 2 },
        { key: 'rnc', label: 'RNC', tipo: 'texto' },
        { key: 'contacto', label: 'Contacto', tipo: 'texto' },
        { key: 'telefono', label: 'Teléfono', tipo: 'texto' },
      ],
    },

    destinos: {
      titulo: 'Destinos / Clientes', singular: 'destino', icono: 'map-pin',
      storage: 'jsonb',
      campoPrincipal: 'nombre',
      campos: [
        { key: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true, unico: true, min: 2 },
        { key: 'ciudad', label: 'Ciudad', tipo: 'texto' },
      ],
    },

  },

  /* ----------------------------------------------------------
     3. ESTADOS — diccionario único del ciclo de vida de un viaje
     Cualquier cambio en el flujo operativo se hace aquí.
  ---------------------------------------------------------- */
  estados: {
    patio: {
      etiqueta: 'En patio',
      lugar: 'Patio',
      estadoCorto: 'En patio',
      fase: 'En patio',
      cls: 'st-patio',
      ucls: 'u-amber',
      icon: 'truck',
      tab: 'patio',
      slaEtapa: 'patio',
      desdeField: 'entrada',
    },
    disponible: {
      etiqueta: 'Disponible',
      lugar: 'Patio',
      estadoCorto: 'Disponible',
      fase: 'Esperando rampa',
      cls: 'st-dispo',
      ucls: 'u-blue',
      icon: 'clock',
      tab: 'despacho',
      slaEtapa: 'patio',
      desdeField: 'dispoTime',
    },
    pendiente: {
      etiqueta: 'Rampa {dock}',
      lugar: 'Rampa {dock}',
      estadoCorto: 'Pendiente',
      fase: 'En rampa (sin iniciar)',
      cls: 'st-rampa',
      ucls: 'u-blue',
      icon: 'warehouse',
      tab: 'despacho',
      slaEtapa: 'carga',
      desdeField: 'dockTime',
    },
    cargando: {
      etiqueta: 'Rampa {dock} · cargando',
      lugar: 'Rampa {dock}',
      estadoCorto: 'Cargando',
      fase: 'Cargando',
      cls: 'st-carga',
      ucls: 'u-amber',
      icon: 'loader',
      tab: 'despacho',
      slaEtapa: 'carga',
      desdeField: 'cargaInicio',
    },
    listo_salida: {
      etiqueta: 'Listo · sale por garita',
      lugar: 'Salida',
      estadoCorto: 'Esperando garita',
      fase: 'Esperando salida',
      cls: 'st-listo',
      ucls: 'u-green',
      icon: 'check-circle',
      tab: 'patio',
      slaEtapa: 'salida',
      desdeField: 'cargaFin',
    },
    cargado_patio: {
      etiqueta: 'Cargado en patio',
      lugar: 'Patio',
      estadoCorto: 'Cargado',
      fase: 'Esperando salida',
      cls: 'st-listo',
      ucls: 'u-green',
      icon: 'package-check',
      tab: 'patio',
      slaEtapa: 'salida',
      desdeField: 'cargaFin',
    },
  },

  /* ----------------------------------------------------------
     4. UI — comportamiento visual y de interacción
  ---------------------------------------------------------- */
  ui: {
    // Duración del toast en milisegundos
    toastDurationMs: 3200,

    // Cuántos registros mostrar por página en Historial
    historialPageSize: 100,

    // Cuántos registros mostrar en la Bitácora
    bitacoraLimit: 500,

    // Atajos de teclado Alt+N para cambiar de pestaña
    tabShortcuts: {
      '1': 'dashboard',
      '2': 'garita',
      '3': 'patio',
      '4': 'despacho',
      '5': 'historial',
      '6': '360',
    },
  },

  /* ----------------------------------------------------------
     5. API — preparado para Supabase (fase siguiente)
     En esta fase estos valores no se usan. Cuando llegue el
     backend, solo hay que llenar estas constantes y cambiar
     la capa api.js.
  ---------------------------------------------------------- */
  supabase: {
    // ============================================================
    // CONFIGURACIÓN SUPABASE — llenar estos dos valores:
    //
    // 1. Ir a https://supabase.com → tu proyecto → Settings → API
    // 2. Copiar "Project URL"   → url
    // 3. Copiar "anon public"   → anonKey
    //
    // NUNCA subir este archivo a GitHub con las credenciales.
    // Para producción usar variables de entorno.
    // ============================================================
    url:     '',   // ← pegar aquí tu Project URL
    anonKey: '',   // ← pegar aquí tu anon public key
    // Nombres de tablas (cambia aquí si el DBA los nombra diferente)
    tablas: {
      viajes:      'viajes',
      historial:   'historial',
      usuarios:    'usuarios',
      vehiculos:   'vehiculos',
      choferes:    'choferes',
      rampas:      'rampas',
      bitacora:    'audit_log',
      config:      'config_empresa',
      catalogos:   'catalogos',
    },
  },

};

// Congelar en producción para detectar mutaciones accidentales
// (en desarrollo se puede comentar para inspeccionar)
Object.freeze(HATTA.supabase);
Object.freeze(HATTA.ui);
