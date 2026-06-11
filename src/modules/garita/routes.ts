import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q } from "../../db.js";
import { requireRol } from "../../auth.js";
import { pinPermitido } from "../../rate-limit.js";

// ============================================================
// GARITA — 4 endpoints. Cada uno es transporte hacia una función
// de Postgres: la DB decide, el backend autentica y transporta.
// Errores de negocio viajan como { success:false, error_code }
// con HTTP 200; los HTTP 4xx/5xx son problemas de auth o bugs.
// ============================================================

const uuid = z.string().uuid();

const scanBody = z.object({ qrToken: uuid });

const salidaBody = z.object({
  vehiculoId: uuid,
  motivo: z.string().trim().min(3).max(300),
  pin: z.string().regex(/^[0-9]{4,8}$/),
});

const rechazoBody = z.object({
  qrToken: uuid,
  motivo: z.string().trim().min(3).max(300),
});

export async function garitaRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireRol("garita", "trafico", "admin") };

  // ----------------------------------------------------------
  // POST /api/garita/scan — entrada o salida según el FSM
  // ----------------------------------------------------------
  app.post("/api/garita/scan", auth, async (req, reply) => {
    const body = scanBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({
        success: false,
        error_code: "QR_NO_RECONOCIDO",
        error_message: "El código leído no tiene un formato válido",
      });
    }

    const rows = await q(
      `select * from fn_procesar_scan($1, 'GARITA', $2, $3)`,
      [body.data.qrToken, req.usuario.id, req.usuario.cd_id]
    );
    return reply.send(rows[0]);
  });

  // ----------------------------------------------------------
  // POST /api/garita/salida-excepcional — motivo + PIN supervisor
  // ----------------------------------------------------------
  app.post("/api/garita/salida-excepcional", auth, async (req, reply) => {
    const body = salidaBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({
        success: false,
        error_code: "DATOS_INVALIDOS",
        error_message: "Motivo (mín. 3 caracteres) y PIN numérico son obligatorios",
      });
    }

    // Freno de fuerza bruta sobre el PIN
    if (!pinPermitido(req.usuario.id)) {
      return reply.send({
        success: false,
        error_code: "PIN_BLOQUEADO",
        error_message: "Demasiados intentos. Espere un minuto.",
      });
    }

    // 1. Validar PIN server-side (hash en DB)
    const sup = await q<{ perfil_id: string; nombre: string }>(
      `select * from fn_validar_pin_supervisor($1)`,
      [body.data.pin]
    );
    if (!sup[0]) {
      req.log.warn({ usuario: req.usuario.id }, "PIN de supervisor inválido");
      return reply.send({
        success: false,
        error_code: "PIN_INVALIDO",
        error_message: "PIN de supervisor incorrecto",
      });
    }

    // 2. Ejecutar la salida excepcional firmada por el supervisor
    const rows = await q(
      `select * from fn_cambiar_estatus($1, 'SALIDA_SIN_CARGA', $2, $3, $4, null, $5)`,
      [body.data.vehiculoId, req.usuario.id, req.usuario.cd_id, body.data.motivo, sup[0].perfil_id]
    );

    // Para que el frontend pinte el veredicto completo
    const placa = await q<{ placa: string }>(`select placa from vehiculos where id = $1`, [
      body.data.vehiculoId,
    ]);
    return reply.send({ ...rows[0], vehiculo_id: body.data.vehiculoId, placa: placa[0]?.placa ?? null, condicion_especial: null });
  });

  // ----------------------------------------------------------
  // POST /api/garita/rechazar-ingreso — incidencia, no cambia estado
  // ----------------------------------------------------------
  app.post("/api/garita/rechazar-ingreso", auth, async (req, reply) => {
    const body = rechazoBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({
        success: false,
        error_message: "El rechazo requiere un motivo (mínimo 3 caracteres)",
        placa: null,
      });
    }

    const rows = await q(`select * from fn_rechazar_ingreso($1, $2, $3, $4)`, [
      body.data.qrToken,
      body.data.motivo,
      req.usuario.id,
      req.usuario.cd_id,
    ]);
    return reply.send(rows[0]);
  });

  // ----------------------------------------------------------
  // GET /api/garita/registro-dia — día calculado en zona RD, no UTC
  // ----------------------------------------------------------
  app.get("/api/garita/registro-dia", auth, async (req, reply) => {
    const rows = await q(
      `select id, creado_en, placa, evento, motivo, tipo_registro
         from v_registro_garita
        where cd_id = $1
          and creado_en >= date_trunc('day', now() at time zone 'America/Santo_Domingo')
                           at time zone 'America/Santo_Domingo'
        order by creado_en desc
        limit 200`,
      [req.usuario.cd_id]
    );
    return reply.send(rows);
  });
}
