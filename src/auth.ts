import { jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ENV } from "./config/env.js";
import { q } from "./db.js";

// ============================================================
// Autenticación: verifica el JWT de Supabase LOCALMENTE (HS256
// con el JWT secret del proyecto) — cero llamadas de red por
// request — y carga el perfil operativo (rol, cd) con caché.
// ============================================================

export interface Usuario {
  id: string;
  nombre: string;
  rol: "admin" | "trafico" | "garita" | "despacho";
  cd_id: string;
}

declare module "fastify" {
  interface FastifyRequest {
    usuario: Usuario;
  }
}

const SECRET = new TextEncoder().encode(ENV.SUPABASE_JWT_SECRET);

// Caché de perfiles: evita un SELECT por request. TTL corto para
// que desactivar un usuario surta efecto en <60s.
const cache = new Map<string, { u: Usuario; exp: number }>();
const TTL_MS = 60_000;

async function cargarPerfil(userId: string): Promise<Usuario | null> {
  const hit = cache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.u;

  const rows = await q<{ id: string; nombre: string; rol: Usuario["rol"]; cd_id: string | null }>(
    `select id, nombre, rol, cd_id from perfiles where id = $1 and activo`,
    [userId]
  );
  const p = rows[0];
  if (!p || !p.cd_id) return null;

  const u: Usuario = { id: p.id, nombre: p.nombre, rol: p.rol, cd_id: p.cd_id };
  cache.set(userId, { u, exp: Date.now() + TTL_MS });
  return u;
}

export function requireRol(...roles: Usuario["rol"][]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Modo pruebas: sin login. Todas las operaciones quedan
    // atribuidas al perfil de desarrollo (trazabilidad intacta).
    if (ENV.AUTH_DISABLED) {
      if (!ENV.DEV_PERFIL_ID) {
        reply.code(500).send({ error: "CONFIG", message: "AUTH_DISABLED requiere DEV_PERFIL_ID" });
        return;
      }
      const dev = await cargarPerfil(ENV.DEV_PERFIL_ID);
      if (!dev) {
        reply.code(500).send({ error: "CONFIG", message: "DEV_PERFIL_ID no existe o está inactivo" });
        return;
      }
      req.usuario = dev;
      return;
    }

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "NO_AUTORIZADO" });
      return;
    }

    let userId: string;
    try {
      const { payload } = await jwtVerify(header.slice(7), SECRET);
      if (!payload.sub) throw new Error("sin sub");
      userId = payload.sub;
    } catch {
      reply.code(401).send({ error: "TOKEN_INVALIDO" });
      return;
    }

    const usuario = await cargarPerfil(userId);
    if (!usuario) {
      reply.code(403).send({ error: "PERFIL_INACTIVO", message: "Usuario sin perfil activo o sin CD asignado" });
      return;
    }
    if (!roles.includes(usuario.rol)) {
      reply.code(403).send({ error: "ROL_INSUFICIENTE" });
      return;
    }

    req.usuario = usuario;
  };
}

/** Solo para tests/admin: limpiar caché de perfiles. */
export function limpiarCachePerfiles() {
  cache.clear();
}
