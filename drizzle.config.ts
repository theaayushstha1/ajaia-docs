import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does NOT auto-load .env.local — load it explicitly.
config({ path: ".env.local" });

const host = process.env.DB_HOST;
const instance = process.env.INSTANCE_CONNECTION_NAME;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Same precedence as src/db/client.ts: socket only when there is no DB_HOST.
    host: host ?? (instance ? `/cloudsql/${instance}` : "127.0.0.1"),
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "ajaia",
    // Cloud SQL rejects unencrypted connections over a public IP. Verification
    // is skipped because the instance presents a Google-managed CA that isn't
    // in the local trust store; migrations run from a trusted machine on an
    // IP-allowlisted connection.
    ssl: host ? { rejectUnauthorized: false } : false,
  },
});
