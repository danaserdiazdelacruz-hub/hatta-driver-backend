import Fastify from "fastify";
import cors from "@fastify/cors";
import { ENV } from "./config/env.js";
import { garitaRoutes } from "./modules/garita/routes.js";
import { despachoRoutes } from "./modules/despacho/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";

export async function buildApp() {
  const app = Fastify({
    trustProxy: ENV.TRUST_PROXY,
    logger: {
      level: ENV.LOG_LEVEL,
      // PII fuera de los logs desde el día 1 (lección de CitasMed)
      redact: {
        paths: ["req.headers.authorization", "*.pin", "*.cedula", "*.telefono"],
        censor: "[redactado]",
      },
    },
  });

  await app.register(cors, {
    origin: ENV.FRONTEND_ORIGIN ? [ENV.FRONTEND_ORIGIN] : false,
    credentials: true,
  });

  // Errores no controlados: log completo adentro, mensaje genérico afuera
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, "error no controlado");
    reply.code(500).send({ error: "ERROR_INTERNO", message: "Error interno del servidor" });
  });

  if (ENV.AUTH_DISABLED) {
    app.log.warn("⚠️  AUTH_DISABLED=true — backend SIN autenticación. Solo para pruebas, nunca con datos reales.");
  }

  app.get("/health", async () => ({ ok: true }));

  await app.register(garitaRoutes);
  await app.register(despachoRoutes);
  await app.register(adminRoutes);

  return app;
}
