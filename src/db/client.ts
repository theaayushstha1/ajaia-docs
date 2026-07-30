import { Pool, type PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * One pg Pool for the whole process.
 *
 * Two connection modes, one set of env vars:
 *   - Cloud Run  -> unix socket at /cloudsql/<INSTANCE_CONNECTION_NAME>
 *                   (pg treats a `host` starting with "/" as a socket directory)
 *   - Local dev  -> TCP against cloud-sql-proxy (or a public IP)
 *
 * Socket wins when INSTANCE_CONNECTION_NAME is set and DB_HOST is not.
 */
function buildConfig(): PoolConfig {
  const instance = process.env.INSTANCE_CONNECTION_NAME;
  const host = process.env.DB_HOST;

  const base: PoolConfig = {
    user: process.env.DB_USER ?? "postgres",
    // Trimmed for the same reason as SESSION_SECRET: secrets delivered as env
    // vars routinely carry a trailing newline that only exists in production.
    password: process.env.DB_PASSWORD?.trim(),
    database: process.env.DB_NAME ?? "ajaia",
    // Cloud Run scales to zero and can fan out to many instances; keep each
    // container's footprint small so we don't exhaust Cloud SQL connections.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  if (instance && !host) {
    // The socket is already inside Google's network, so there is no TLS to
    // negotiate — passing ssl here would fail the connection outright.
    return { ...base, host: `/cloudsql/${instance}` };
  }

  return {
    ...base,
    host: host ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 5432),
    // Cloud SQL refuses unencrypted connections over a public IP. We skip
    // certificate verification because the server presents a Google-managed
    // CA that isn't in the local trust store; this path is for local
    // development and one-off migrations, never for serving traffic.
    ssl: process.env.DB_SSL === "disable" ? undefined : { rejectUnauthorized: false },
  };
}

// Reuse across hot reloads in dev so we don't leak pools.
const globalForDb = globalThis as unknown as { __ajaiaPool?: Pool };

export const pool: Pool = globalForDb.__ajaiaPool ?? new Pool(buildConfig());

if (process.env.NODE_ENV !== "production") {
  globalForDb.__ajaiaPool = pool;
}

// Don't let an idle-client error take down the process.
pool.on("error", (err) => {
  console.error("[db] idle client error", err);
});

export const db = drizzle(pool);
