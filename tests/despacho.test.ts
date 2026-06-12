import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import type { FastifyInstance } from "fastify";

// ============================================================
// Tests de integración de DESPACHO contra Postgres real
// (migraciones 001-006 aplicadas). Ciclo completo de rampa.
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
const QR_CHOFER_2 = "00000000-0000-0000-0000-0000000000b2"; // AE-003
const VEH_2 = "00000000-0000-0000-0000-0000000d0002";

let app: FastifyInstance;
let token: string;
let perfilId: string;
let rampaId: string;

function call(method: "GET" | "POST", url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
}

beforeAll(async () => {
  app = await buildApp();

  const p = await q<{ id: string }>(
    `insert into perfiles (id, nombre, rol, cd_id)
     values (gen_random_uuid(), 'Despacho Test', 'despacho', $1) returning id`,
    [CD]
  );
  perfilId = p[0].id;
  token = await new SignJWT({ app_metadata: { rol: "despacho" } })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(perfilId)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));

  // Estado de partida: AE-003 EN_PATIO con viaje abierto, rampas libres
  await q(`update solicitudes_despacho set estado='cancelada', cancelada_en=now(), motivo_cancel='test reset' where vehiculo_id=$1 and estado in ('pendiente','cargando')`, [VEH_2]);
  await q(`update rampas set estado='disponible' where cd_id=$1 and estado='ocupada'`, [CD]);
  await q(`update viajes set estado='cerrado', cerrado_en=now() where vehiculo_id=$1 and estado='abierto'`, [VEH_2]);
  await q(`update vehiculos set estatus='FUERA_CD', cd_actual_id=null, condicion_especial=null where id=$1`, [VEH_2]);
  await q(`select fn_cambiar_estatus($1, 'ENTRADA_GARITA', null, $2)`, [VEH_2, CD]);

  const r = await q<{ id: string }>(`select id from rampas where cd_id=$1 and numero='R25'`, [CD]);
  rampaId = r[0].id;
});

afterAll(async () => {
  await q(`update perfiles set activo=false where id=$1`, [perfilId]);
  await app.close();
  await pool.end();
});

describe("despacho: ciclo de rampa completo", () => {
  it("contexto: AE-003 aparece EN_PATIO y R25 disponible", async () => {
    const res = await call("GET", "/api/despacho/contexto");
    expect(res.statusCode).toBe(200);
    const ctx = res.json() as { rampas: Array<{ numero: string; estado: string }>; unidades: Array<{ placa: string }> };
    expect(ctx.unidades.some((u) => u.placa === "AE-003")).toBe(true);
    expect(ctx.rampas.find((r) => r.numero === "R25")?.estado).toBe("disponible");
  });

  it("asignar: EN_PATIO -> PENDIENTE_CARGA, rampa ocupada", async () => {
    const res = await call("POST", "/api/despacho/asignar", { vehiculoId: VEH_2, rampaId });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.estatus_nuevo).toBe("PENDIENTE_CARGA");

    const r = await q<{ estado: string }>(`select estado from rampas where id=$1`, [rampaId]);
    expect(r[0].estado).toBe("ocupada");
  });

  it("doble asignación al mismo vehículo -> TRANSICION_INVALIDA", async () => {
    const res = await call("POST", "/api/despacho/asignar", { vehiculoId: VEH_2, rampaId });
    expect(res.json().error_code).toBe("TRANSICION_INVALIDA");
  });

  it("scan en rampa #1: PENDIENTE_CARGA -> CARGANDO", async () => {
    const res = await call("POST", "/api/despacho/scan", { qrToken: QR_CHOFER_2 });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.estatus_nuevo).toBe("CARGANDO");
  });

  it("monitor: AE-003 aparece cargando con minutos y vehiculo_id", async () => {
    const res = await call("GET", "/api/despacho/monitor");
    const items = res.json() as Array<{ placa: string; estado: string; min_cargando: number | null; vehiculo_id: string }>;
    const it2 = items.find((i) => i.placa === "AE-003" && i.estado === "cargando");
    expect(it2).toBeTruthy();
    expect(it2!.vehiculo_id).toBe(VEH_2);
    expect(it2!.min_cargando).toBeGreaterThanOrEqual(0);
  });

  it("scan en rampa #2: CARGANDO -> CARGADO, rampa liberada", async () => {
    const res = await call("POST", "/api/despacho/scan", { qrToken: QR_CHOFER_2 });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.estatus_nuevo).toBe("CARGADO");

    const r = await q<{ estado: string }>(`select estado from rampas where id=$1`, [rampaId]);
    expect(r[0].estado).toBe("disponible");
  });

  it("scan en rampa #3 (ya CARGADO) -> OPERACION_NO_PERMITIDA", async () => {
    const res = await call("POST", "/api/despacho/scan", { qrToken: QR_CHOFER_2 });
    expect(res.json().error_code).toBe("OPERACION_NO_PERMITIDA");
  });

  it("cancelar: requiere motivo, devuelve unidad a EN_PATIO y libera rampa", async () => {
    // Volver a meter la unidad al ciclo: salir y reentrar para nuevo viaje
    await q(`select fn_cambiar_estatus($1, 'SALIDA_GARITA', null, $2)`, [VEH_2, CD]);
    await q(`select fn_cambiar_estatus($1, 'ENTRADA_GARITA', null, $2)`, [VEH_2, CD]);
    const asign = await call("POST", "/api/despacho/asignar", { vehiculoId: VEH_2, rampaId });
    expect(asign.json().success).toBe(true);

    const sinMotivo = await call("POST", "/api/despacho/cancelar", { vehiculoId: VEH_2, motivo: "x" });
    expect(sinMotivo.json().error_code).toBe("MOTIVO_REQUERIDO");

    const res = await call("POST", "/api/despacho/cancelar", { vehiculoId: VEH_2, motivo: "Cambio de plan" });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.estatus_nuevo).toBe("EN_PATIO");

    const r = await q<{ estado: string }>(`select estado from rampas where id=$1`, [rampaId]);
    expect(r[0].estado).toBe("disponible");
  });

  it("rol garita NO puede asignar rampas", async () => {
    const g = await q<{ id: string }>(
      `insert into perfiles (id, nombre, rol, cd_id)
       values (gen_random_uuid(), 'Garita Test 2', 'garita', $1) returning id`,
      [CD]
    );
    const tokenGarita = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(g[0].id)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    const res = await app.inject({
      method: "POST",
      url: "/api/despacho/asignar",
      headers: { authorization: `Bearer ${tokenGarita}` },
      payload: { vehiculoId: VEH_2, rampaId },
    });
    expect(res.statusCode).toBe(403);
    await q(`update perfiles set activo=false where id=$1`, [g[0].id]);
  });
});
