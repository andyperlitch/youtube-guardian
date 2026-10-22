import { createHmac, randomBytes, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import type { Db } from "./db.js";
import { migrate } from "./schema.js";

export type EnvConfig = {
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  PUBLIC_URL?: string;
  NODE_ENV?: string;
};

export type AllowlistEntry = {
  channelId: string | null;
  handle: string | null;
};

type DeviceRow = {
  id: string;
  name: string;
  pairing_token_hash: string;
  created_at: string;
  last_seen_at: string | null;
  revision: number | string;
  updated_at: string;
};

type EntryRow = {
  id: string;
  device_id: string;
  list_kind: string;
  channel_id: string | null;
  handle: string | null;
  created_at: string;
};

const COOKIE = "ytg_admin";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function signCookie(value: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${mac}`;
}

function verifyCookie(raw: string | undefined, secret: string): boolean {
  if (!raw) return false;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return false;
  const value = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = createHmac("sha256", secret).update(value).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b) && value.startsWith("1.");
}

function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function publicBase(req: Request, env: EnvConfig): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function mapEntry(row: EntryRow): AllowlistEntry {
  return {
    channelId: row.channel_id,
    handle: row.handle,
  };
}

function normalizeEntry(raw: AllowlistEntry): AllowlistEntry | null {
  const channelId = raw?.channelId
    ? String(raw.channelId).toUpperCase()
    : null;
  const handle = raw?.handle
    ? String(raw.handle).toLowerCase().replace(/^@/, "")
    : null;
  if (!channelId && !handle) return null;
  return { channelId, handle };
}

export async function createApp(db: Db, env: EnvConfig) {
  if (!env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is required");
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is required");

  await migrate(db);

  const app = express();
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin: true,
      credentials: false,
      allowedHeaders: ["Authorization", "Content-Type"],
    })
  );
  app.use(express.json({ limit: "1mb" }));

  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));

  const loginAttempts = new Map<string, { n: number; reset: number }>();

  function rateLimit(ip: string): boolean {
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec || rec.reset < now) {
      loginAttempts.set(ip, { n: 1, reset: now + 10 * 60_000 });
      return true;
    }
    rec.n += 1;
    return rec.n <= 20;
  }

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!verifyCookie(readCookie(req, COOKIE), env.SESSION_SECRET)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  }

  async function deviceFromBearer(req: Request): Promise<DeviceRow | null> {
    const header = req.headers.authorization || "";
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const hash = sha256(m[1].trim());
    return (await db.get<DeviceRow>(
      "SELECT * FROM devices WHERE pairing_token_hash = ?",
      [hash]
    )) || null;
  }

  async function touch(deviceId: string) {
    await db.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", [
      new Date().toISOString(),
      deviceId,
    ]);
  }

  async function listsFor(deviceId: string) {
    const rows = await db.all<EntryRow>(
      "SELECT * FROM allowlist_entries WHERE device_id = ? ORDER BY created_at ASC",
      [deviceId]
    );
    return {
      channels: rows.filter((r) => r.list_kind === "channel").map(mapEntry),
      shorts: rows.filter((r) => r.list_kind === "shorts").map(mapEntry),
    };
  }

  async function replaceLists(
    deviceId: string,
    channels: AllowlistEntry[],
    shorts: AllowlistEntry[]
  ) {
    await db.run("DELETE FROM allowlist_entries WHERE device_id = ?", [deviceId]);
    const now = new Date().toISOString();
    const write = async (kind: string, list: AllowlistEntry[]) => {
      for (const raw of list) {
        const entry = normalizeEntry(raw);
        if (!entry) continue;
        await db.run(
          `INSERT INTO allowlist_entries (id, device_id, list_kind, channel_id, handle, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), deviceId, kind, entry.channelId, entry.handle, now]
        );
      }
    };
    await write("channel", channels);
    await write("shorts", shorts);
    const device = await db.get<DeviceRow>("SELECT * FROM devices WHERE id = ?", [
      deviceId,
    ]);
    const revision = Number(device?.revision || 0) + 1;
    await db.run(
      "UPDATE devices SET revision = ?, updated_at = ? WHERE id = ?",
      [revision, now, deviceId]
    );
    return { revision, updatedAt: now };
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "youtube-guardian-portal" });
  });

  app.get("/api/admin/me", requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/admin/login", (req, res) => {
    const ip = req.ip || "unknown";
    if (!rateLimit(ip)) {
      res.status(429).json({ error: "too_many_attempts" });
      return;
    }
    const password = String(req.body?.password || "");
    if (!safeEqualString(password, env.ADMIN_PASSWORD)) {
      res.status(401).json({ error: "invalid_password" });
      return;
    }
    const token = signCookie(`1.${Date.now()}`, env.SESSION_SECRET);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
        60 * 60 * 24 * 7
      }${env.NODE_ENV === "production" ? "; Secure" : ""}`
    );
    res.json({ ok: true });
  });

  app.post("/api/admin/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get("/api/admin/devices", requireAdmin, async (_req, res) => {
    const rows = await db.all<DeviceRow>(
      "SELECT id, name, created_at, last_seen_at, revision, updated_at FROM devices ORDER BY created_at DESC"
    );
    res.json({ devices: rows });
  });

  app.post("/api/admin/devices", requireAdmin, async (req, res) => {
    const name = String(req.body?.name || "").trim() || "Family device";
    const pairingToken = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO devices (id, name, pairing_token_hash, created_at, last_seen_at, revision, updated_at)
       VALUES (?, ?, ?, ?, NULL, 0, ?)`,
      [id, name, sha256(pairingToken), now, now]
    );
    res.status(201).json({
      device: { id, name, created_at: now, revision: 0 },
      pairingToken,
      portalUrl: publicBase(req, env),
    });
  });

  app.delete("/api/admin/devices/:id", requireAdmin, async (req, res) => {
    await db.run("DELETE FROM devices WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  });

  app.get("/api/admin/devices/:id/allowlists", requireAdmin, async (req, res) => {
    const device = await db.get<DeviceRow>("SELECT * FROM devices WHERE id = ?", [
      req.params.id,
    ]);
    if (!device) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const lists = await listsFor(device.id);
    res.json({
      device: {
        id: device.id,
        name: device.name,
        revision: Number(device.revision),
        updatedAt: device.updated_at,
      },
      ...lists,
    });
  });

  app.put("/api/admin/devices/:id/allowlists", requireAdmin, async (req, res) => {
    const device = await db.get<DeviceRow>("SELECT * FROM devices WHERE id = ?", [
      req.params.id,
    ]);
    if (!device) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const channels = Array.isArray(req.body?.channels) ? req.body.channels : [];
    const shorts = Array.isArray(req.body?.shorts) ? req.body.shorts : [];
    const meta = await replaceLists(device.id, channels, shorts);
    const lists = await listsFor(device.id);
    res.json({ ...meta, ...lists });
  });

  app.get("/api/device/state", async (req, res) => {
    const device = await deviceFromBearer(req);
    if (!device) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    await touch(device.id);
    const lists = await listsFor(device.id);
    res.json({
      deviceId: device.id,
      deviceName: device.name,
      revision: Number(device.revision),
      updatedAt: device.updated_at,
      ...lists,
    });
  });

  app.put("/api/device/state", async (req, res) => {
    const device = await deviceFromBearer(req);
    if (!device) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    await touch(device.id);
    const channels = Array.isArray(req.body?.channels) ? req.body.channels : [];
    const shorts = Array.isArray(req.body?.shorts) ? req.body.shorts : [];
    const meta = await replaceLists(device.id, channels, shorts);
    const lists = await listsFor(device.id);
    res.json({ deviceId: device.id, ...meta, ...lists });
  });

  app.post("/api/device/heartbeat", async (req, res) => {
    const device = await deviceFromBearer(req);
    if (!device) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    await touch(device.id);
    res.json({ ok: true, deviceId: device.id });
  });

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
