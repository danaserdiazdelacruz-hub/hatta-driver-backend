import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import type { FastifyInstance } from "fastify";

// ============================================================
// Tests de integración de ADMIN contra Postgres real (001-007).
// ============================================================

const SECRET = "test-secret-test-secret-test-secret-1234";
process.env.NODE_ENV = "test";
process.env.SUPABASE_JWT_SECRET = SECRET;
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:5432/yms";
process.env.LOG_LEVEL = "error";

const { buildApp } = await import("../src/app.js");
const { q, pool } = await import("../src/db.js");

const CD = "00000000-0000-0000-0000-00000000c001";

let app: FastifyInstance;
let token: string;
let adminId: string;
const creados = { vehiculos: [] as string[], choferes: [] as string[], perfiles: [] as string[], rampas: [] as string[] };

function call(method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, tk = token) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${tk}` }, payload });
}

beforeAll(async () => {
  app = await buildApp();
  const p = await q<{ id: string }>(
    `insert into perfiles (id, nombre, rol, cd_id)
     values (gen_random_uuid(), 'Admin Test', 'admin', $1) returning id`,
    [CD]
  );
  adminId = p[0].id;
  creados.perfiles.push(adminId);
  token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId).setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
});

afterAll(async () => {
  // Limpieza de datos de prueba (los maestros sin historial sí se pueden borrar)
  for (const id of creados.vehiculos) {
    await q(`delete from chofer_vehiculo where vehiculo_id=$1`, [id]).catch(() => {});
    await q(`delete from vehiculos where id=$1`, [id]).catch(() => {});
  }
  for (const id of creados.choferes) {
    await q(`delete from chofer_vehiculo where chofer_id=$1`, [id]).catch(() => {});
    await q(`delete from choferes where id=$1`, [id]).catch(() => {});
  }
  for (const id of creados.rampas) await q(`delete from rampas where id=$1`, [id]).catch(() => {});
  await q(`update perfiles set activo=false where id = any($1)`, [creados.perfiles]);
  await app.close();
  await pool.end();
});

describe("admin: maestros", () => {
  it("crea un vehículo y devuelve su qr_token", async () => {
    const res = await call("POST", "/api/admin/vehiculos", {
      placa: "tst-901", tipo_unidad: "R. Seco", transportista: "Trans Test",
    });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.placa).toBe("TST-901"); // normalizada a mayúsculas
    expect(body.qr_token).toMatch(/^[0-9a-f-]{36}$/);
    creados.vehiculos.push(body.id);
  });

  it("placa duplicada -> DUPLICADO con mensaje claro", async () => {
    const res = await call("POST", "/api/admin/vehiculos", { placa: "TST-901", tipo_unidad: "R. Seco" });
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error_code).toBe("DUPLICADO");
  });

  it("crea chofer y lo vincula a la unidad; revincular cierra la anterior", async () => {
    const ch1 = (await call("POST", "/api/admin/choferes", { nombre: "Chofer Test Uno" })).json();
    const ch2 = (await call("POST", "/api/admin/choferes", { nombre: "Chofer Test Dos" })).json();
    creados.choferes.push(ch1.id, ch2.id);
    const vehId = creados.vehiculos[0];

    const v1 = (await call("POST", `/api/admin/choferes/${ch1.id}/vehiculo`, { vehiculoId: vehId })).json();
    expect(v1.success).toBe(true);

    // Chofer 2 toma la misma unidad: la vinculación de chofer 1 debe cerrarse
    const v2 = (await call("POST", `/api/admin/choferes/${ch2.id}/vehiculo`, { vehiculoId: vehId })).json();
    expect(v2.success).toBe(true);

    const vivas = await q<{ chofer_id: string }>(
      `select chofer_id from chofer_vehiculo where vehiculo_id=$1 and activo`, [vehId]
    );
    expect(vivas).toHaveLength(1);
    expect(vivas[0].chofer_id).toBe(ch2.id);
  });

  it("crea rampa, duplicada falla, y fuera de servicio alterna", async () => {
    const r = (await call("POST", "/api/admin/rampas", { numero: "T99" })).json();
    expect(r.success).toBe(true);
    creados.rampas.push(r.id);

    const dup = (await call("POST", "/api/admin/rampas", { numero: "T99" })).json();
    expect(dup.error_code).toBe("DUPLICADO");

    const fs = (await call("PATCH", `/api/admin/rampas/${r.id}`, { fuera_servicio: true })).json();
    expect(fs.success).toBe(true);
    const estado = await q<{ estado: string }>(`select estado from rampas where id=$1`, [r.id]);
    expect(estado[0].estado).toBe("fuera_servicio");
  });

  it("crea perfil de usuario y le asigna PIN hasheado", async () => {
    const p = (await call("POST", "/api/admin/perfiles", { nombre: "Supervisor Nuevo", rol: "trafico" })).json();
    expect(p.success).toBe(true);
    creados.perfiles.push(p.id);

    const pin = (await call("POST", `/api/admin/perfiles/${p.id}/pin`, { pin: "7788" })).json();
    expect(pin.success).toBe(true);

    const row = await q<{ pin_hash: string }>(`select pin_hash from perfiles where id=$1`, [p.id]);
    expect(row[0].pin_hash).not.toBe("7788");
    const valida = await q(`select * from fn_validar_pin_supervisor('7788')`);
    expect(valida.length).toBeGreaterThan(0);
  });

  it("rol despacho NO entra a admin (403)", async () => {
    const d = await q<{ id: string }>(
      `insert into perfiles (id, nombre, rol, cd_id)
       values (gen_random_uuid(), 'Despacho NoAdmin', 'despacho', $1) returning id`, [CD]
    );
    creados.perfiles.push(d[0].id);
    const tk = await new SignJWT({}).setProtectedHeader({ alg: "HS256" })
      .setSubject(d[0].id).setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    const res = await call("GET", "/api/admin/vehiculos", undefined, tk);
    expect(res.statusCode).toBe(403);
  });
});
