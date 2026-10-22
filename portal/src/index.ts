import { createApp } from "./app.js";
import { openDbFromEnv } from "./db.js";

const port = Number(process.env.PORT || 3000);
const env = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "",
  SESSION_SECRET: process.env.SESSION_SECRET || "",
  PUBLIC_URL: process.env.PUBLIC_URL,
  NODE_ENV: process.env.NODE_ENV,
};

if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
  console.error(
    "Set ADMIN_PASSWORD and SESSION_SECRET in the environment before starting."
  );
  process.exit(1);
}

const db = openDbFromEnv(process.env);
const app = await createApp(db, env);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`YouTube Guardian portal listening on :${port} (${db.kind})`);
});

async function shutdown() {
  server.close();
  await db.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
