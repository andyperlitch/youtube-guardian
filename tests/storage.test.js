const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryAdapter,
  createStorageFacade,
  createRemotePortalAdapter,
} = require("../extension/lib/storage.js");

describe("storage facade", () => {
  it("reads synchronously after writes", async () => {
    const facade = createStorageFacade(createMemoryAdapter());
    await facade.init();
    assert.deepEqual(facade.getChannelAllowlist(), []);
    await facade.addEntry("channel", { handle: "pbs", channelId: null });
    assert.equal(facade.getChannelAllowlist()[0].handle, "pbs");
    assert.equal(facade.getSyncMeta().dirty, true);
    await facade.addEntry("shorts", { handle: "pbs", channelId: null });
    assert.equal(facade.getShortsAllowlist().length, 1);
    await facade.removeEntry("shorts", 0);
    assert.equal(facade.getShortsAllowlist().length, 0);
  });

  it("pulls and pushes through the remote adapter", async () => {
    let store = {
      revision: 2,
      updatedAt: new Date().toISOString(),
      channels: [{ handle: "remote", channelId: null }],
      shorts: [],
    };
    const fetchImpl = async (url, opts = {}) => {
      if (String(url).endsWith("/state") && (!opts.method || opts.method === "GET")) {
        return {
          ok: true,
          json: async () => store,
        };
      }
      if (opts.method === "PUT") {
        const body = JSON.parse(opts.body);
        store = {
          revision: store.revision + 1,
          updatedAt: new Date().toISOString(),
          channels: body.channels,
          shorts: body.shorts,
        };
        return { ok: true, json: async () => store };
      }
      throw new Error("unexpected " + url);
    };
    const facade = createStorageFacade(
      createMemoryAdapter(),
      createRemotePortalAdapter(fetchImpl)
    );
    await facade.init();
    await facade.setPairing({
      portalUrl: "https://portal.example",
      token: "tok",
    });
    const pulled = await facade.pullFromRemote();
    assert.equal(pulled.ok, true);
    assert.equal(facade.getChannelAllowlist()[0].handle, "remote");

    await facade.addEntry("shorts", { handle: "fun", channelId: null });
    const pushed = await facade.pushToRemote();
    assert.equal(pushed.ok, true);
    assert.equal(store.shorts[0].handle, "fun");
    assert.equal(facade.getSyncMeta().dirty, false);
  });

  it("stays local-only when unpaired", async () => {
    const facade = createStorageFacade(
      createMemoryAdapter(),
      createRemotePortalAdapter(async () => {
        throw new Error("should not fetch");
      })
    );
    await facade.init();
    await facade.addEntry("channel", { handle: "local", channelId: null });
    const result = await facade.syncNow();
    assert.equal(result.skipped, true);
    assert.equal(facade.getChannelAllowlist()[0].handle, "local");
  });
});
