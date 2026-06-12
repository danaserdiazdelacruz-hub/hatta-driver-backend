import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q } from "../../db.js";
import { requireRol } from "../../auth.js";

// ============================================================
// DESPACHO — Pestaña 1: asignación de rampas + monitor.
//            Pestaña 2: scan en rampa (inicio/fin de carga).
// Igual que garita: la DB decide, esto autentica y transporta.
// ============================================================

const uuid = z.string().uuid();

const asignarBody = z.object({ vehiculoId: uuid, rampaId: uuid });
const scanBody = z.object({ qrToken: uuid });
const cancelarBody = z.object({
  vehiculoId: uuid,
  motivo: z.string().trim().min(3).max(300),
});

export async function despachoRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireRol("despacho", "trafico", "admin") };

  // ----------------------------------------------------------
  // GET /api/despacho/contexto — lo que la pestaña 1 necesita
  // para pintar los selects: rampas del CD y unidades EN_PATIO.
  // ----------------------------------------------------------
  app.get("/api/despacho/contexto", auth, async (req, reply) => {
    const [rampas, unidades] = await Promise.all([
      q(
        `select r.id, r.numero, r.estado, r.motivo_fuera_servicio,
                v.placa as placa_ocupada
           from rampas r
           left join solicitudes_despacho s
             on s.rampa_id = r.id and s.estado in ('pendiente','cargando')
           left join vehiculos v on v.id = s.vehiculo_id
          where r.cd_id = $1 and r.activo
          order by r.numero`,
        [req.usuario.cd_id]
      ),
      q(
        // Cola del patio: refrigerados primero, luego quien más espera
        `select v.id, v.placa, v.tipo_unidad, v.condicion_especial,
                floor(extract(epoch from (now() - vi.abierto_en)) / 60)::int as min_espera
           from vehiculos v
           left join viajes vi on vi.vehiculo_id = v.id and vi.estado = 'abierto'
          where v.cd_actual_id = $1 and v.estatus = 'EN_PATIO' and v.activo
          order by (v.tipo_unidad ilike '%refri%') desc, vi.abierto_en nulls last`,
        [req.usuario.cd_id]
      ),
    ]);
    return reply.send({ rampas, unidades });
  });

  // ----------------------------------------------------------
  // POST /api/despacho/asignar — rampa + unidad (pestaña 1)
  // ----------------------------------------------------------
  app.post("/api/despacho/asignar", auth, async (req, reply) => {
    const body = asignarBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({
        success: false,
        error_code: "DATOS_INVALIDOS",
        error_message: "Seleccione una unidad y una rampa",
      });
    }

    const rows = await q(
      `select * from fn_cambiar_estatus($1, 'ASIGNAR_RAMPA', $2, $3, null, $4)`,
      [body.data.vehiculoId, req.usuario.id, req.usuario.cd_id, body.data.rampaId]
    );
    return reply.send(rows[0]);
  });

  // ----------------------------------------------------------
  // POST /api/despacho/scan — QR en rampa (pestaña 2):
  // PENDIENTE_CARGA -> CARGANDO -> CARGADO (la DB infiere cuál)
  // ----------------------------------------------------------
  app.post("/api/despacho/scan", auth, async (req, reply) => {
    const body = scanBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({
        success: false,
        error_code: "QR_NO_RECONOCIDO",
        error_message: "El código leído no tiene un formato válido",
      });
    }

    const rows = await q(
      `select * from fn_procesar_scan($1, 'RAMPA', $2, $3)`,
      [body.data.qrToken, req.usuario.id, req.usuario.cd_id]
    );
    return reply.send(rows[0]);
  });

  // ----------------------------------------------------------
  // POST /api/despacho/cancelar — cancela una solicitud viva
  // (la unidad vuelve a EN_PATIO y la rampa se libera)
  // ----------------------------------------------------------
  app.post("/api/despacho/cancelar", auth, async (req, reply) => {
    const body = cancelarBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({
        success: false,
        error_code: "MOTIVO_REQUERIDO",
        error_message: "La cancelación requiere un motivo (mínimo 3 caracteres)",
      });
    }

    const rows = await q(
      `select * from fn_cambiar_estatus($1, 'CANCELAR_SOLICITUD', $2, $3, $4)`,
      [body.data.vehiculoId, req.usuario.id, req.usuario.cd_id, body.data.motivo]
    );
    return reply.send(rows[0]);
  });

  // ----------------------------------------------------------
  // GET /api/despacho/monitor — las 3 listas con minutos ya
  // calculados por la vista (pendientes / cargando / realizados 24h)
  // ----------------------------------------------------------
  app.get("/api/despacho/monitor", auth, async (req, reply) => {
    const rows = await q(
      `select id, estado, placa, tipo_unidad, rampa,
              vehiculo_id, creado_en, inicio_carga_en, fin_carga_en,
              min_pendiente, min_cargando
         from v_monitor_despacho
        where cd_id = $1
        order by case estado when 'cargando' then 0 when 'pendiente' then 1 else 2 end,
                 creado_en desc`,
      [req.usuario.cd_id]
    );
    return reply.send(rows);
  });
}
