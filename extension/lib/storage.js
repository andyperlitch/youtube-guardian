/**
 * Storage layer: synchronous reads from an in-memory cache, async writes.
 * Interface is adapter-based so a remote backend can be swapped in.
 *
 * Local adapter: chrome.storage.local (+ onChanged).
 * Remote adapter: portal REST API (pairing token). Local-only works when unpaired.
 */
(function (root) {
  const consts =
    typeof module !== "undefined" && module.exports
      ? require("./constants.js")
      : root;
  const utils =
    typeof module !== "undefined" && module.exports
      ? require("./channel-utils.js")
      : root;
  const { YTG_KEYS, YTG_LIST } = consts;

  function defaultSettings() {
    return {
      password: null,
      pairing: null,
    };
  }

  function defaultSyncMeta() {
    return {
      revision: 0,
      updatedAt: 0,
      dirty: false,
      lastPulledAt: 0,
      lastPushAt: 0,
      lastError: null,
    };
  }

  function defaultState() {
    return {
      channelAllowlist: [],
      shortsAllowlist: [],
      settings: defaultSettings(),
      syncMeta: defaultSyncMeta(),
    };
  }

  /** @typedef {ReturnType<typeof defaultState>} GuardianState */

  /**
   * In-memory adapter (tests / Node).
   * @returns {import('./storage-types').StorageAdapter}
   */
  function createMemoryAdapter(initial) {
    let cache = { ...defaultState(), ...(initial || {}) };
    cache.settings = { ...defaultSettings(), ...(cache.settings || {}) };
    cache.syncMeta = { ...defaultSyncMeta(), ...(cache.syncMeta || {}) };
    const listeners = new Set();

    function notify() {
      for (const fn of listeners) fn(cache);
    }

    return {
      kind: "memory",
      async init() {},
      getState() {
        return cache;
      },
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      async writePartial(partial) {
        cache = {
          ...cache,
          ...partial,
          settings: partial.settings
            ? { ...cache.settings, ...partial.settings }
            : cache.settings,
          syncMeta: partial.syncMeta
            ? { ...cache.syncMeta, ...partial.syncMeta }
            : cache.syncMeta,
        };
        notify();
      },
    };
  }

  /**
   * chrome.storage.local adapter with sync cache.
   */
  function createChromeLocalAdapter() {
    let cache = defaultState();
    let ready = false;
    const listeners = new Set();

    function notify() {
      for (const fn of listeners) fn(cache);
    }

    function applyRaw(data) {
      cache = {
        channelAllowlist: data[YTG_KEYS.CHANNEL] || [],
        shortsAllowlist: data[YTG_KEYS.SHORTS] || [],
        settings: { ...defaultSettings(), ...(data[YTG_KEYS.SETTINGS] || {}) },
        syncMeta: { ...defaultSyncMeta(), ...(data[YTG_KEYS.SYNC] || {}) },
      };
    }

    async function hydrate() {
      const data = await chrome.storage.local.get([
        YTG_KEYS.CHANNEL,
        YTG_KEYS.SHORTS,
        YTG_KEYS.SETTINGS,
        YTG_KEYS.SYNC,
      ]);
      applyRaw(data);
      ready = true;
      notify();
    }

    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        let touched = false;
        if (changes[YTG_KEYS.CHANNEL]) {
          cache.channelAllowlist = changes[YTG_KEYS.CHANNEL].newValue || [];
          touched = true;
        }
        if (changes[YTG_KEYS.SHORTS]) {
          cache.shortsAllowlist = changes[YTG_KEYS.SHORTS].newValue || [];
          touched = true;
        }
        if (changes[YTG_KEYS.SETTINGS]) {
          cache.settings = {
            ...defaultSettings(),
            ...(changes[YTG_KEYS.SETTINGS].newValue || {}),
          };
          touched = true;
        }
        if (changes[YTG_KEYS.SYNC]) {
          cache.syncMeta = {
            ...defaultSyncMeta(),
            ...(changes[YTG_KEYS.SYNC].newValue || {}),
          };
          touched = true;
        }
        if (touched) notify();
      });
    }

    return {
      kind: "chrome-local",
      async init() {
        await hydrate();
      },
      isReady() {
        return ready;
      },
      getState() {
        return cache;
      },
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      async writePartial(partial) {
        const payload = {};
        if (Object.prototype.hasOwnProperty.call(partial, "channelAllowlist")) {
          payload[YTG_KEYS.CHANNEL] = partial.channelAllowlist;
          cache.channelAllowlist = partial.channelAllowlist;
        }
        if (Object.prototype.hasOwnProperty.call(partial, "shortsAllowlist")) {
          payload[YTG_KEYS.SHORTS] = partial.shortsAllowlist;
          cache.shortsAllowlist = partial.shortsAllowlist;
        }
        if (partial.settings) {
          cache.settings = { ...cache.settings, ...partial.settings };
          payload[YTG_KEYS.SETTINGS] = cache.settings;
        }
        if (partial.syncMeta) {
          cache.syncMeta = { ...cache.syncMeta, ...partial.syncMeta };
          payload[YTG_KEYS.SYNC] = cache.syncMeta;
        }
        await chrome.storage.local.set(payload);
        notify();
      },
    };
  }

  /**
   * Portal HTTP adapter. Does not own local state.
   */
  function createRemotePortalAdapter(fetchImpl) {
    const f = fetchImpl || fetch.bind(globalThis);

    function headers(token) {
      return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };
    }

    function originOf(portalUrl) {
      const u = new URL(portalUrl);
      return u.origin;
    }

    return {
      kind: "portal",
      async pull(pairing) {
        const url = `${originOf(pairing.portalUrl)}/api/device/state`;
        const res = await f(url, { headers: headers(pairing.token) });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Pull failed (${res.status}): ${text.slice(0, 200)}`);
        }
        return res.json();
      },
      async push(pairing, body) {
        const url = `${originOf(pairing.portalUrl)}/api/device/state`;
        const res = await f(url, {
          method: "PUT",
          headers: headers(pairing.token),
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Push failed (${res.status}): ${text.slice(0, 200)}`);
        }
        return res.json();
      },
      async heartbeat(pairing) {
        const url = `${originOf(pairing.portalUrl)}/api/device/heartbeat`;
        const res = await f(url, {
          method: "POST",
          headers: headers(pairing.token),
          body: "{}",
        });
        if (!res.ok) throw new Error(`Heartbeat failed (${res.status})`);
        return res.json().catch(() => ({ ok: true }));
      },
    };
  }

  /**
   * Facade used by extension code. Sync reads, async writes.
   */
  function createStorageFacade(adapter, remoteAdapter) {
    const remote = remoteAdapter || null;

    function getState() {
      return adapter.getState();
    }

    async function markDirty() {
      const meta = { ...getState().syncMeta, dirty: true, updatedAt: Date.now() };
      await adapter.writePartial({ syncMeta: meta });
    }

    async function writeList(kind, list) {
      const partial =
        kind === YTG_LIST.SHORTS
          ? { shortsAllowlist: list }
          : { channelAllowlist: list };
      await adapter.writePartial(partial);
      await markDirty();
    }

    return {
      adapterKind: adapter.kind,
      init: () => adapter.init(),
      onChange: (fn) => adapter.onChange(fn),
      getState,
      getChannelAllowlist() {
        return getState().channelAllowlist || [];
      },
      getShortsAllowlist() {
        return getState().shortsAllowlist || [];
      },
      getSettings() {
        return getState().settings;
      },
      getSyncMeta() {
        return getState().syncMeta;
      },
      getPasswordRecord() {
        return getState().settings.password || null;
      },
      getPairing() {
        return getState().settings.pairing || null;
      },
      async setPasswordRecord(record) {
        await adapter.writePartial({
          settings: { ...getState().settings, password: record },
        });
      },
      async setPairing(pairing) {
        await adapter.writePartial({
          settings: { ...getState().settings, pairing },
        });
      },
      writeList,
      async addEntry(kind, entry) {
        const current =
          kind === YTG_LIST.SHORTS
            ? this.getShortsAllowlist()
            : this.getChannelAllowlist();
        const next = utils.addAllowlistEntry(current, entry);
        await writeList(kind, next);
        return next;
      },
      async removeEntry(kind, index) {
        const current =
          kind === YTG_LIST.SHORTS
            ? this.getShortsAllowlist()
            : this.getChannelAllowlist();
        const next = utils.removeAllowlistIndex(current, index);
        await writeList(kind, next);
        return next;
      },
      async replaceAllowlists({ channels, shorts, revision, updatedAt }) {
        const syncMeta = {
          ...getState().syncMeta,
          revision: revision ?? getState().syncMeta.revision,
          updatedAt: updatedAt ?? Date.now(),
          dirty: false,
          lastPulledAt: Date.now(),
          lastError: null,
        };
        await adapter.writePartial({
          channelAllowlist: channels,
          shortsAllowlist: shorts,
          syncMeta,
        });
      },
      async setSyncMeta(partial) {
        await adapter.writePartial({
          syncMeta: { ...getState().syncMeta, ...partial },
        });
      },
      async pullFromRemote() {
        if (!remote) return { skipped: true, reason: "no-remote" };
        const pairing = this.getPairing();
        if (!pairing?.portalUrl || !pairing?.token) {
          return { skipped: true, reason: "unpaired" };
        }
        const data = await remote.pull(pairing);
        const localRev = getState().syncMeta.revision || 0;
        const remoteRev = data.revision || 0;
        if (getState().syncMeta.dirty && localRev >= remoteRev) {
          return { skipped: true, reason: "local-dirty" };
        }
        await this.replaceAllowlists({
          channels: data.channels || [],
          shorts: data.shorts || [],
          revision: data.revision,
          updatedAt: Date.parse(data.updatedAt) || Date.now(),
        });
        return { ok: true, data };
      },
      async pushToRemote() {
        if (!remote) return { skipped: true, reason: "no-remote" };
        const pairing = this.getPairing();
        if (!pairing?.portalUrl || !pairing?.token) {
          return { skipped: true, reason: "unpaired" };
        }
        const body = {
          channels: this.getChannelAllowlist(),
          shorts: this.getShortsAllowlist(),
          revision: getState().syncMeta.revision || 0,
        };
        const data = await remote.push(pairing, body);
        await this.setSyncMeta({
          dirty: false,
          revision: data.revision ?? body.revision,
          lastPushAt: Date.now(),
          lastError: null,
          updatedAt: Date.now(),
        });
        return { ok: true, data };
      },
      async syncNow() {
        const pairing = this.getPairing();
        if (!pairing) return { skipped: true, reason: "unpaired" };
        try {
          if (getState().syncMeta.dirty) {
            const pushed = await this.pushToRemote();
            if (pushed.skipped) return pushed;
          }
          return await this.pullFromRemote();
        } catch (err) {
          const message = err && err.message ? err.message : String(err);
          await this.setSyncMeta({ lastError: message });
          throw err;
        }
      },
    };
  }

  const api = {
    YTG_KEYS,
    defaultState,
    defaultSettings,
    defaultSyncMeta,
    createMemoryAdapter,
    createChromeLocalAdapter,
    createRemotePortalAdapter,
    createStorageFacade,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
