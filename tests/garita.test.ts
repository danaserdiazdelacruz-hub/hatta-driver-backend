import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import type { FastifyInstance } from "fastify";

// ============================================================
// Tests de integración REALES: levantan la app y golpean los
// endpoints contra el Postgres local con las migraciones 001-005
// aplicadas. Sin mocks: si esto pasa, el sistema funciona.
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
const QR_CHOFER_1 = "00000000-0000-0000-0000-0000000000b1"; // ATL-008
const VEH_1 = "00000000-0000-0000-0000-0000000d0001";

let app: FastifyInstance;
let tokenGarita: string;
let operarioId: string;
let supervisorId: string;

async function jwt(sub: string) {
  return new SignJWT({ app_metadata: { rol: "garita" } })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

function post(url: string, payload: unknown, token = tokenGarita) {
  return app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

beforeAll(async () => {
  app = await buildApp();

  // Perfiles de prueba: operario de garita + supervisor con PIN
  const op = await q<{ id: string }>(
    `insert into perfiles (id, nombre, rol, cd_id)
     values (gen_random_uuid(), 'Operario Test', 'garita', $1) returning id`,
    [CD]
  );
  operarioId = op[0].id;

  const sup = await q<{ id: string }>(
    `insert into perfiles (id, nombre, rol, cd_id)
     values (gen_random_uuid(), 'Supervisor Test', 'trafico', $1) returning id`,
    [CD]
  );
  supervisorId = sup[0].id;
  await q(`select fn_asignar_pin($1, '4321')`, [supervisorId]);

  // Estado de partida conocido para el vehículo de prueba
  await q(`update solicitudes_despacho set estado='cancelada', cancelada_en=now(), motivo_cancel='test reset' where vehiculo_id=$1 and estado in ('pendiente','cargando')`, [VEH_1]);
  await q(`update rampas set estado='disponible' where estado='ocupada'`);
  await q(`update viajes set estado='cerrado', cerrado_en=now() where vehiculo_id=$1 and estado='abierto'`, [VEH_1]);
  await q(`update vehiculos set estatus='FUERA_CD', cd_actual_id=null, condicion_especial=null where id=$1`, [VEH_1]);

  tokenGarita = await jwt(operarioId);
});

afterAll(async () => {
  // Los inserts de prueba quedan (movimientos es inmutable a propósito);
  // desactivar perfiles de prueba para no dejar accesos vivos.
  await q(`update perfiles set activo=false where id in ($1,$2)`, [operarioId, supervisorId]);
  await app.close();
  await pool.end();
});

describe("auth", () => {
  it("rechaza sin token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/garita/registro-dia" });
    expect(res.statusCode).toBe(401);
  });

  it("rechaza token firmado con otro secreto", async () => {
    const malo = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(operarioId)
      .sign(new TextEncoder().encode("otro-secreto-otro-secreto-otro-secreto"));
    const res = await app.inject({
      method: "GET",
      url: "/api/garita/registro-dia",
      headers: { authorization: `Bearer ${malo}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rechaza usuario sin perfil", async () => {
    const fantasma = await jwt("00000000-0000-0000-0000-00000000ffff");
    const res = await app.inject({
      method: "GET",
      url: "/api/garita/registro-dia",
      headers: { authorization: `Bearer ${fantasma}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("ciclo de garita", () => {
  it("scan de entrada: FUERA_CD -> EN_PATIO", async () => {
    const res = await post("/api/garita/scan", { qrToken: QR_CHOFER_1 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.placa).toBe("ATL-008");
    expect(body.estatus_nuevo).toBe("EN_PATIO");
    expect(body.viaje_id).toBeTruthy();
  });

  it("segundo scan en garita queda bloqueado (EN_PATIO no entra ni sale normal)", async () => {
    const res = await post("/api/garita/scan", { qrToken: QR_CHOFER_1 });
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error_code).toBe("OPERACION_NO_PERMITIDA");
    expect(body.vehiculo_id).toBeTruthy(); // identificado: la UI ofrece acciones controladas
  });

  it("salida excepcional con PIN incorrecto -> PIN_INVALIDO", async () => {
    const res = await post("/api/garita/salida-excepcional", {
      vehiculoId: VEH_1,
      motivo: "Unidad averiada",
      pin: "9999",
    });
    expect(res.json().error_code).toBe("PIN_INVALIDO");
  });

  it("salida excepcional con PIN correcto -> FUERA_CD firmado por supervisor", async () => {
    const res = await post("/api/garita/salida-excepcional", {
      vehiculoId: VEH_1,
      motivo: "Unidad averiada",
      pin: "4321",
    });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.estatus_nuevo).toBe("FUERA_CD");
    expect(body.placa).toBe("ATL-008");

    const mov = await q<{ autorizado_por: string }>(
      `select autorizado_por from movimientos where id = $1`,
      [body.movimiento_id]
    );
    expect(mov[0].autorizado_por).toBe(supervisorId);
  });

  it("rechazo de ingreso: registra incidencia sin cambiar estado", async () => {
    const res = await post("/api/garita/rechazar-ingreso", {
      qrToken: QR_CHOFER_1,
      motivo: "Sin EPP (test)",
    });
    expect(res.json().success).toBe(true);

    const veh = await q<{ estatus: string }>(`select estatus from vehiculos where id=$1`, [VEH_1]);
    expect(veh[0].estatus).toBe("FUERA_CD");
  });

  it("registro del día incluye entrada, excepción y rechazo", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/garita/registro-dia",
      headers: { authorization: `Bearer ${tokenGarita}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json() as Array<{ placa: string; tipo_registro: string }>;
    const deHoy = items.filter((i) => i.placa === "ATL-008");
    const tipos = new Set(deHoy.map((i) => i.tipo_registro));
    expect(tipos.has("MOVIMIENTO")).toBe(true);
    expect(tipos.has("RECHAZO_INGRESO")).toBe(true);
  });

  it("entrada manual (formulario v6.0): crea placa nueva, abre viaje urgente, y queda primera en la cola", async () => {
    const placaTest = `man-${Date.now().toString().slice(-6)}`;
    const res = await post("/api/garita/entrada-manual", {
      placa: placaTest, tipo_unidad: "R. Seco", chofer: "Manuel Prueba",
      prioridad: "urgente", tipo_operacion: "descarga", destino: "Tienda Centro",
    });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.placa).toBe(placaTest.toUpperCase());
    expect(body.estatus_nuevo).toBe("EN_PATIO");

    const viaje = await q<{ prioridad: string; destino: string; notas: string }>(
      `select prioridad, destino, notas from viajes where id = $1`, [body.viaje_id]
    );
    expect(viaje[0].prioridad).toBe("urgente");
    expect(viaje[0].destino).toBe("Tienda Centro");
    expect(viaje[0].notas).toContain("Manuel Prueba");

    // misma placa otra vez -> ya está dentro
    const dup = await post("/api/garita/entrada-manual", { placa: placaTest });
    expect(dup.json().error_code).toBe("TRANSICION_INVALIDA");

    // limpieza: sacarla y desactivar el vehículo de prueba
    await q(`select fn_cambiar_estatus((select id from vehiculos where placa=$2), 'SALIDA_SIN_CARGA', null, $1, 'test cleanup')`, [CD, placaTest.toUpperCase()]);
    await q(`update vehiculos set activo=false where placa=$1`, [placaTest.toUpperCase()]);

    // placa desactivada -> error claro, no 500 (bug real corregido)
    const inactivo = await post("/api/garita/entrada-manual", { placa: placaTest });
    expect(inactivo.json().error_code).toBe("VEHICULO_INACTIVO");
  });

  it("rate limit: el 6º intento de PIN en el minuto queda bloqueado", async () => {
    let last: { error_code?: string } = {};
    for (let i = 0; i < 5; i++) {
      const r = await post("/api/garita/salida-excepcional", {
        vehiculoId: VEH_1,
        motivo: "Prueba rate limit",
        pin: "0000",
      });
      last = r.json();
    }
    expect(["PIN_INVALIDO", "PIN_BLOQUEADO"]).toContain(last.error_code);
    const res = await post("/api/garita/salida-excepcional", {
      vehiculoId: VEH_1,
      motivo: "Prueba rate limit",
      pin: "0000",
    });
    expect(res.json().error_code).toBe("PIN_BLOQUEADO");
  });
});
