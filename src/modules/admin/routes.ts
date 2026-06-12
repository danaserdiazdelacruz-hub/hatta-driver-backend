import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q } from "../../db.js";
import { requireRol } from "../../auth.js";

// ============================================================
// ADMIN — maestros: vehículos, choferes, rampas, usuarios.
// Solo rol admin. Los UPDATE aquí tocan datos maestros, NUNCA
// el estatus operativo (ese solo cambia vía fn_cambiar_estatus).
// ============================================================

const uuid = z.string().uuid();

// Violaciones de unicidad de Postgres -> error de negocio legible
const UNIQUE_MSG: Record<string, string> = {
  vehiculos_placa_key: "Ya existe un vehículo con esa placa",
  choferes_cedula_key: "Ya existe un chofer con esa cédula",
  uq_rampa_por_cd: "Ya existe una rampa con ese número en este CD",
  centros_distribucion_codigo_key: "Ya existe un CD con ese código",
};

async function safe<T>(fn: () => Promise<T>): Promise<T | { success: false; error_code: string; error_message: string }> {
  try {
    return await fn();
  } catch (err: unknown) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === "23505") {
      return {
        success: false,
        error_code: "DUPLICADO",
        error_message: UNIQUE_MSG[e.constraint ?? ""] ?? "Ya existe un registro con ese valor",
      };
    }
    throw err;
  }
}

const vehiculoBody = z.object({
  placa: z.string().trim().min(2).max(20),
  tipo_unidad: z.string().trim().min(2).max(40),
  transportista: z.string().trim().max(80).optional(),
});

const choferBody = z.object({
  nombre: z.string().trim().min(3).max(80),
  cedula: z.string().trim().max(20).optional(),
  telefono: z.string().trim().max(20).optional(),
});

const rampaBody = z.object({ numero: z.string().trim().min(1).max(10) });

const perfilBody = z.object({
  nombre: z.string().trim().min(3).max(80),
  rol: z.enum(["admin", "trafico", "garita", "despacho"]),
});

export async function adminRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireRol("admin") };

  // ----------------------- VEHÍCULOS -----------------------
  app.get("/api/admin/vehiculos", auth, async (_req, reply) => {
    return reply.send(await q(`select * from v_admin_vehiculos order by activo desc, placa`));
  });

  app.post("/api/admin/vehiculos", auth, async (req, reply) => {
    const body = vehiculoBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "Placa y tipo de unidad son obligatorios" });
    }
    const out = await safe(async () => {
      const rows = await q(
        `insert into vehiculos (placa, tipo_unidad, transportista)
         values ($1, $2, $3)
         returning id, placa, qr_token`,
        [body.data.placa.toUpperCase(), body.data.tipo_unidad, body.data.transportista ?? null]
      );
      return { success: true as const, ...rows[0] };
    });
    return reply.send(out);
  });

  app.patch("/api/admin/vehiculos/:id", auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const body = vehiculoBody.partial().extend({ activo: z.boolean().optional() }).safeParse(req.body);
    if (!id.success || !body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "Datos inválidos" });
    }
    const out = await safe(async () => {
      const rows = await q(
        `update vehiculos set
           placa = coalesce($2, placa),
           tipo_unidad = coalesce($3, tipo_unidad),
           transportista = coalesce($4, transportista),
           activo = coalesce($5, activo)
         where id = $1
         returning id`,
        [id.data, body.data.placa?.toUpperCase() ?? null, body.data.tipo_unidad ?? null,
         body.data.transportista ?? null, body.data.activo ?? null]
      );
      if (!rows[0]) return { success: false as const, error_code: "NO_ENCONTRADO", error_message: "Vehículo no encontrado" };
      return { success: true as const };
    });
    return reply.send(out);
  });

  // Condición especial (sub-estatus) con trazabilidad
  app.post("/api/admin/vehiculos/:id/condicion", auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const body = z.object({
      condicion: z.string().trim().max(60).nullable(),
      motivo: z.string().trim().max(200).optional(),
    }).safeParse(req.body);
    if (!id.success || !body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "Datos inválidos" });
    }
    const rows = await q(
      `select * from fn_set_condicion_especial($1, $2, $3, $4, $5)`,
      [id.data, body.data.condicion, body.data.motivo ?? null, req.usuario.id, req.usuario.cd_id]
    );
    return reply.send(rows[0]);
  });

  // ----------------------- CHOFERES ------------------------
  app.get("/api/admin/choferes", auth, async (_req, reply) => {
    return reply.send(await q(`select * from v_admin_choferes order by activo desc, nombre`));
  });

  app.post("/api/admin/choferes", auth, async (req, reply) => {
    const body = choferBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "El nombre es obligatorio (mínimo 3 caracteres)" });
    }
    const out = await safe(async () => {
      const rows = await q(
        `insert into choferes (nombre, cedula, telefono)
         values ($1, $2, $3) returning id, nombre, qr_token`,
        [body.data.nombre, body.data.cedula ?? null, body.data.telefono ?? null]
      );
      return { success: true as const, ...rows[0] };
    });
    return reply.send(out);
  });

  app.patch("/api/admin/choferes/:id", auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const body = choferBody.partial().extend({ activo: z.boolean().optional() }).safeParse(req.body);
    if (!id.success || !body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "Datos inválidos" });
    }
    const out = await safe(async () => {
      const rows = await q(
        `update choferes set
           nombre = coalesce($2, nombre),
           cedula = coalesce($3, cedula),
           telefono = coalesce($4, telefono),
           activo = coalesce($5, activo)
         where id = $1 returning id`,
        [id.data, body.data.nombre ?? null, body.data.cedula ?? null,
         body.data.telefono ?? null, body.data.activo ?? null]
      );
      if (!rows[0]) return { success: false as const, error_code: "NO_ENCONTRADO", error_message: "Chofer no encontrado" };
      return { success: true as const };
    });
    return reply.send(out);
  });

  // Vincular / desvincular unidad (atómico en la DB)
  app.post("/api/admin/choferes/:id/vehiculo", auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const body = z.object({ vehiculoId: uuid.nullable() }).safeParse(req.body);
    if (!id.success || !body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "Datos inválidos" });
    }
    const rows = await q(`select * from fn_asignar_chofer_vehiculo($1, $2)`, [id.data, body.data.vehiculoId]);
    return reply.send(rows[0]);
  });

  // ----------------------- RAMPAS --------------------------
  app.get("/api/admin/rampas", auth, async (req, reply) => {
    return reply.send(await q(
      `select id, numero, estado, motivo_fuera_servicio, activo
         from rampas where cd_id = $1 order by numero`,
      [req.usuario.cd_id]
    ));
  });

  app.post("/api/admin/rampas", auth, async (req, reply) => {
    const body = rampaBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "El número de rampa es obligatorio" });
    }
    const out = await safe(async () => {
      const rows = await q(
        `insert into rampas (cd_id, numero) values ($1, $2) returning id, numero`,
        [req.usuario.cd_id, body.data.numero.toUpperCase()]
      );
      return { success: true as const, ...rows[0] };
    });
    return reply.send(out);
  });

  app.patch("/api/admin/rampas/:id", auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const body = z.object({
      fuera_servicio: z.boolean().optional(),
      motivo: z.string().trim().max(120).optional(),
      activo: z.boolean().optional(),
    }).safeParse(req.body);
    if (!id.success || !body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "Datos inválidos" });
    }

    // Solo se alterna disponible <-> fuera_servicio. Una rampa OCUPADA
    // no se toca desde admin: se libera sola al terminar la carga.
    if (body.data.fuera_servicio !== undefined) {
      const rows = await q(
        `update rampas
            set estado = case
              when estado = 'ocupada' then estado
              when $2 then 'fuera_servicio'::estado_rampa
              else 'disponible'::estado_rampa
            end,
            motivo_fuera_servicio = case
              when estado = 'ocupada' then motivo_fuera_servicio
              when $2 then nullif(trim(coalesce($4, '')), '')
              else null
            end
          where id = $1 and cd_id = $3
          returning estado`,
        [id.data, body.data.fuera_servicio, req.usuario.cd_id, body.data.motivo ?? null]
      );
      if (!rows[0]) return reply.send({ success: false, error_code: "NO_ENCONTRADO", error_message: "Rampa no encontrada" });
      if ((rows[0] as { estado: string }).estado === "ocupada") {
        return reply.send({ success: false, error_code: "RAMPA_OCUPADA", error_message: "La rampa está ocupada; se libera al terminar la carga" });
      }
    }
    if (body.data.activo !== undefined) {
      await q(`update rampas set activo = $2 where id = $1 and cd_id = $3`, [id.data, body.data.activo, req.usuario.cd_id]);
    }
    return reply.send({ success: true });
  });

  // ----------------------- USUARIOS ------------------------
  app.get("/api/admin/perfiles", auth, async (_req, reply) => {
    return reply.send(await q(
      `select id, nombre, rol, cd_id, activo, (pin_hash is not null) as tiene_pin, creado_en
         from perfiles order by activo desc, nombre`
    ));
  });

  // NOTA: en etapa de pruebas (AUTH_DISABLED) los perfiles se crean
  // sueltos. Con login real, el id debe ser el de auth.users — ver README.
  app.post("/api/admin/perfiles", auth, async (req, reply) => {
    const body = perfilBody.safeParse(req.body);
    if (!body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "Nombre y rol son obligatorios" });
    }
    const rows = await q(
      `insert into perfiles (id, nombre, rol, cd_id)
       values (gen_random_uuid(), $1, $2, $3) returning id, nombre, rol`,
      [body.data.nombre, body.data.rol, req.usuario.cd_id]
    );
    return reply.send({ success: true, ...rows[0] });
  });

  app.patch("/api/admin/perfiles/:id", auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const body = perfilBody.partial().extend({ activo: z.boolean().optional() }).safeParse(req.body);
    if (!id.success || !body.success) {
      return reply.send({ success: false, error_code: "DATOS_INVALIDOS", error_message: "Datos inválidos" });
    }
    await q(
      `update perfiles set
         nombre = coalesce($2, nombre),
         rol = coalesce($3, rol),
         activo = coalesce($4, activo)
       where id = $1`,
      [id.data, body.data.nombre ?? null, body.data.rol ?? null, body.data.activo ?? null]
    );
    return reply.send({ success: true });
  });

  app.post("/api/admin/perfiles/:id/pin", auth, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    const body = z.object({ pin: z.string().regex(/^[0-9]{4,8}$/) }).safeParse(req.body);
    if (!id.success || !body.success) {
      return reply.send({ success: false, error_code: "PIN_INVALIDO", error_message: "El PIN debe ser de 4 a 8 dígitos" });
    }
    const rows = await q<{ fn_asignar_pin: boolean }>(`select fn_asignar_pin($1, $2)`, [id.data, body.data.pin]);
    if (!rows[0]?.fn_asignar_pin) {
      return reply.send({ success: false, error_code: "NO_ENCONTRADO", error_message: "Perfil no encontrado o inactivo" });
    }
    return reply.send({ success: true });
  });
}
