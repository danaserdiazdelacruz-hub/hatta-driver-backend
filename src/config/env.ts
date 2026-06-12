import { z } from "zod";

// Validación de entorno al arrancar: si falta algo, el proceso
// muere con un mensaje claro en vez de fallar a las 3am.
// Nota: nunca usar z.coerce.boolean() para flags — Boolean("false")
// es true. Se compara el string explícitamente.
const boolFlag = z
  .string()
  .optional()
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  // Conexión directa a Postgres (Supabase: usar el "Connection string"
  // del pooler en modo transaction, puerto 6543).
  DATABASE_URL: z.string().min(10),

  // Secreto JWT del proyecto Supabase (Settings -> API -> JWT Secret).
  // Permite verificar tokens localmente sin llamar a Supabase por request.
  SUPABASE_JWT_SECRET: z.string().min(32),

  // Origen permitido del frontend (CORS)
  FRONTEND_ORIGIN: z.string().url().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TRUST_PROXY: boolFlag, // true detrás de Railway

  // ⚠️ SOLO PARA PRUEBAS: salta la autenticación y atribuye todas
  // las operaciones al perfil DEV_PERFIL_ID. Nunca con datos reales.
  AUTH_DISABLED: boolFlag,
  DEV_PERFIL_ID: z.string().uuid().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Variables de entorno inválidas:");
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`   ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const ENV = parsed.data;
