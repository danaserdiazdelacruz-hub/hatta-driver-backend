import pg from "pg";
import { ENV } from "./config/env.js";

// Pool único de conexiones. Las funciones fn_* de Postgres son la
// capa de lógica; este backend solo las invoca y transporta.
export const pool = new pg.Pool({
  connectionString: ENV.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function q<T extends pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}
