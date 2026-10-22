import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "./app.js";
import { createSqliteDb, type Db } from "./db.js";

const env = {
  ADMIN_PASSWORD: "test-admin-password",
  SESSION_SECRET: "test-session-secret-value",
  NODE_ENV: "test",
};

describe("portal API", () => {
  let db: Db;
  let agent: ReturnType<typeof request>;

  before(async () => {
    db = createSqliteDb(":memory:");
    const app = await createApp(db, env);
    agent = request(app);
  });

  after(async () => {
    await db.close();
  });

  it("health is unauthenticated", async () => {
    const res = await agent.get("/health").expect(200);
    assert.equal(res.body.ok, true);
  });

  it("rejects admin routes without a session", async () => {
    await agent.get("/api/admin/devices").expect(401);
  });

  it("rejects bad admin password", async () => {
    await agent
      .post("/api/admin/login")
      .send({ password: "nope" })
      .expect(401);
  });

  it("logs in, creates a device, and syncs allowlists through the device API", async () => {
    const login = await agent
      .post("/api/admin/login")
      .send({ password: env.ADMIN_PASSWORD })
      .expect(200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];

    const created = await agent
      .post("/api/admin/devices")
      .set("Cookie", cookie)
      .send({ name: "Kids tablet" })
      .expect(201);

    assert.ok(created.body.pairingToken);
    assert.equal(created.body.device.name, "Kids tablet");
    const token = created.body.pairingToken;
    const id = created.body.device.id;

    await agent
      .put(`/api/admin/devices/${id}/allowlists`)
      .set("Cookie", cookie)
      .send({
        channels: [{ handle: "pbs", channelId: null }],
        shorts: [{ handle: "crashcourse", channelId: null }],
      })
      .expect(200);

    const pulled = await agent
      .get("/api/device/state")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    assert.equal(pulled.body.channels[0].handle, "pbs");
    assert.equal(pulled.body.shorts[0].handle, "crashcourse");
    assert.ok(pulled.body.revision >= 1);

    const pushed = await agent
      .put("/api/device/state")
      .set("Authorization", `Bearer ${token}`)
      .send({
        channels: [{ handle: "numberphile", channelId: null }],
        shorts: [],
      })
      .expect(200);

    assert.equal(pushed.body.channels[0].handle, "numberphile");
    assert.equal(pushed.body.shorts.length, 0);

    await agent.get("/api/device/state").expect(401);
    await agent
      .get("/api/device/state")
      .set("Authorization", "Bearer totally-wrong")
      .expect(401);
  });
});
