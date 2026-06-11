import { buildApp } from "./app.js";
import { ENV } from "./config/env.js";
import { pool } from "./db.js";

const app = await buildApp();

// Apagado limpio: Railway manda SIGTERM en cada deploy
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, "apagando");
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: ENV.PORT, host: "0.0.0.0" });
