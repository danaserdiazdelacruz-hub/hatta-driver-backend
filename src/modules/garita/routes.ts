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

const entradaBody = z.object({
  placa: z.string().trim().min(2).max(20),
  tipo_unidad: z.string().trim().min(2).max(40).default("R. Seco"),
  chofer: z.string().trim().max(80).optional(),
  prioridad: z.enum(["normal", "urgente", "refrigerado"]).default("normal"),
  tipo_operacion: z.enum(["carga", "descarga"]).optional(),
  destino: z.string().trim().max(120).optional(),
  notas: z.string().trim().max(300).optional(),
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
  // POST /api/garita/entrada-manual — el formulario de Entrada
  // del borrador v6.0: registra (creando el vehículo si la placa
  // es nueva) y abre el viaje con prioridad/destino/notas.
  // ----------------------------------------------------------
  app.post("/api/garita/entrada-manual", auth, async (req, reply) => {
    const body = entradaBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({
        success: false,
        error_code: "DATOS_INVALIDOS",
        error_message: "La placa es obligatoria (mínimo 2 caracteres)",
      });
    }
    const d = body.data;
    const placa = d.placa.toUpperCase();

    // Buscar el vehículo por placa (activo o no)
    let veh = (await q<{ id: string; activo: boolean }>(
      `select id, activo from vehiculos where placa = $1`, [placa]
    ))[0];

    if (veh && !veh.activo) {
      return reply.send({
        success: false,
        error_code: "VEHICULO_INACTIVO",
        error_message: `La placa ${placa} pertenece a un vehículo desactivado. Reactívelo en Admin → Vehículos.`,
        placa,
      });
    }

    if (!veh) {
      try {
        veh = (await q<{ id: string; activo: boolean }>(
          `insert into vehiculos (placa, tipo_unidad) values ($1, $2) returning id, activo`,
          [placa, d.tipo_unidad]
        ))[0];
      } catch (err: unknown) {
        // Carrera: dos garitas registrando la misma placa a la vez
        if ((err as { code?: string }).code === "23505") {
          veh = (await q<{ id: string; activo: boolean }>(
            `select id, activo from vehiculos where placa = $1`, [placa]
          ))[0];
        } else {
          throw err;
        }
      }
    }

    const rows = await q<{ success: boolean; error_code: string | null; error_message: string | null;
      estatus_anterior: string | null; estatus_nuevo: string | null; viaje_id: string | null; movimiento_id: string | null }>(
      `select * from fn_cambiar_estatus($1, 'ENTRADA_GARITA', $2, $3)`,
      [veh.id, req.usuario.id, req.usuario.cd_id]
    );
    const r = rows[0];

    if (r.success && r.viaje_id) {
      const notas = [
        d.chofer ? `Chofer: ${d.chofer}` : null,
        d.notas || null,
      ].filter(Boolean).join(" · ") || null;
      await q(
        `update viajes set prioridad = $2, tipo_operacion = $3, destino = $4, notas = $5 where id = $1`,
        [r.viaje_id, d.prioridad, d.tipo_operacion ?? null, d.destino ?? null, notas]
      );
    }

    return reply.send({ ...r, vehiculo_id: veh.id, placa, condicion_especial: null });
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
