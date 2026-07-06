/* ============================================================
   MIGRACIÓN — Importar datos de localStorage a Supabase
   ============================================================
   Ejecutar UNA SOLA VEZ desde la consola del navegador
   ANTES de borrar los datos locales del HATTA v4.

   INSTRUCCIONES:
   1. Abrir el HATTA v4 viejo (con los datos en localStorage)
   2. Abrir la consola del navegador (F12 → Console)
   3. Pegar y ejecutar este script
   4. Copiar el JSON que aparece
   5. Enviarselo al admin de Supabase para cargar los datos

   O, si el admin tiene acceso a ambos:
   1. Abrir el HATTA v2 (Supabase) ya configurado
   2. Ejecutar migrarDatos() desde la consola
   ============================================================ */

async function migrarDatos() {
  const EMPRESA_ID = prompt('¿Cuál es el empresa_id de Supabase? (ver tabla empresas)');
  if (!EMPRESA_ID) { console.log('Migración cancelada'); return; }

  const PREFIX = 'yms_w_';
  const get = (k, def) => {
    try { return JSON.parse(localStorage.getItem(PREFIX + k)) ?? def; } catch { return def; }
  };

  const viajes    = (get('viajes', []) || []).filter(Boolean);
  const historial = get('history', []) || [];
  const vehiculos = get('vehiculos', []) || [];
  const choferes  = get('choferes', []) || [];

  console.log(`Encontrado: ${viajes.length} viajes, ${historial.length} historial, ${vehiculos.length} vehículos, ${choferes.length} choferes`);

  if (!confirm(`¿Migrar ${viajes.length} viajes y ${historial.length} registros de historial?`)) return;

  let ok = 0, err = 0;

  // Migrar viajes activos
  for (const v of viajes) {
    const row = {
      id: v.id, empresa_id: EMPRESA_ID,
      tx: v.tx, placa: v.placa, remolque: v.remolque, cedula: v.cedula,
      chofer: v.chofer, tipo_unidad: v.tipo_unidad, tipo_vehiculo: v.tipoVehiculo,
      entidad: v.entidad, prioridad: v.prioridad || 'normal',
      tipo_operacion: v.tipoOperacion || 'descarga', destino: v.destino || '',
      estado: v.estado, dock: v.dock || null,
      entrada: v.entrada, dispo_time: v.dispoTime || null,
      dock_time: v.dockTime || null, carga_inicio: v.cargaInicio || null,
      carga_fin: v.cargaFin || null, turno: v.turno,
      metodo_acceso: v.metodoAcceso || 'manual',
      registrado_por: v.registradoPor || '', garita_entrada_por: v.garitaEntradaPor || '',
      trafico_por: v.traficoPor || '', despacho_por: v.despachoPor || '',
      motivo_patio: v.motivoPatio || null, motivo_despacho: v.motivoDespacho || null,
      motivo_salida: v.motivoSalida || null,
    };
    const { error } = await api.auth.getClient().from('viajes').upsert(row);
    if (error) { console.error('Error viaje', v.placa, error.message); err++; }
    else ok++;
  }
  console.log(`Viajes: ${ok} OK, ${err} errores`);

  // Migrar historial
  ok = 0; err = 0;
  for (const h of historial) {
    const row = {
      id: h.id, empresa_id: EMPRESA_ID,
      tx: h.tx, placa: h.placa, remolque: h.remolque, cedula: h.cedula,
      chofer: h.chofer, tipo_unidad: h.tipo_unidad, tipo_vehiculo: h.tipoVehiculo,
      entidad: h.entidad, prioridad: h.prioridad, tipo_operacion: h.tipoOperacion,
      destino: h.destino, estado: 'finalizado', dock: h.dock || null,
      rampa_usada: h.rampaUsada || h.dock || null,
      entrada: h.entrada, dispo_time: h.dispoTime || null,
      dock_time: h.dockTime || null, carga_inicio: h.cargaInicio || null,
      carga_fin: h.cargaFin || null, salida: h.salida || null,
      turno: h.turno, turno_salida: h.turnoSalida || null,
      metodo_acceso: h.metodoAcceso || 'manual', metodo_salida: h.metodoSalida || null,
      registrado_por: h.registradoPor || '', garita_entrada_por: h.garitaEntradaPor || '',
      trafico_por: h.traficoPor || '', despacho_por: h.despachoPor || '',
      garita_salida_por: h.garitaSalidaPor || '',
      motivo_patio: h.motivoPatio || null, motivo_despacho: h.motivoDespacho || null,
      motivo_salida: h.motivoSalida || null,
    };
    const { error } = await api.auth.getClient().from('historial').upsert(row);
    if (error) { console.error('Error historial', h.placa, error.message); err++; }
    else ok++;
  }
  console.log(`Historial: ${ok} OK, ${err} errores`);
  alert(`Migración completa. Viajes: ${viajes.length}, Historial: ${historial.length}.`);
}

console.log('[HATTA] Script de migración cargado. Ejecutar: await migrarDatos()');
