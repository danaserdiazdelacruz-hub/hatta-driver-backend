/* ============================================================
   DB — Compatibilidad (shim)
   ============================================================
   En Fase 1 este archivo solo redirige al nuevo api.js.
   Todo el código nuevo usa api.* directamente.
   En Fase 2 (Supabase) se elimina este archivo.
   ============================================================ */

const DB = {
  HISTORY_CAP:  HATTA.HISTORY_CAP,
  BITACORA_CAP: HATTA.BITACORA_CAP,
};

// Para compatibilidad con cualquier referencia residual
function onDatosCambiaron(cb) { api.onCambio(cb); }
function emitirCambio()        { api.notificar(); }
