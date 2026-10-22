/* global importScripts, chrome, YTG_MSG, YTG_LIST, YTG_KEYS,
   createChromeLocalAdapter, createRemotePortalAdapter, createStorageFacade,
   hashPassword, verifyPassword, validateNewPassword */

importScripts(
  "lib/constants.js",
  "lib/channel-utils.js",
  "lib/password.js",
  "lib/storage.js"
);

const storage = createStorageFacade(
  createChromeLocalAdapter(),
  createRemotePortalAdapter()
);

const ready = storage.init().then(() => migrateLegacyWhitelist());

chrome.runtime.onInstalled.addListener(() => {
  ready.then(() => {
    ensureAlarm();
    return storage.syncNow().catch(() => {});
  });
});

chrome.runtime.onStartup.addListener(() => {
  ready.then(() => {
    ensureAlarm();
    return storage.syncNow().catch(() => {});
  });
});

function ensureAlarm() {
  chrome.alarms.create("ytg-sync", { periodInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "ytg-sync") return;
  ready.then(() => storage.syncNow().catch(() => {}));
});

async function migrateLegacyWhitelist() {
  try {
    const local = storage.getChannelAllowlist();
    if (local.length > 0) return;
    const data = await chrome.storage.sync.get(YTG_KEYS.LEGACY_WHITELIST);
    const legacy = data[YTG_KEYS.LEGACY_WHITELIST];
    if (!Array.isArray(legacy) || legacy.length === 0) return;
    await storage.writeList(YTG_LIST.CHANNEL, legacy);
    await chrome.storage.sync.remove(YTG_KEYS.LEGACY_WHITELIST);
  } catch (_) {
    /* ignore */
  }
}

function publicState() {
  const pairing = storage.getPairing();
  const meta = storage.getSyncMeta();
  return {
    hasPassword: Boolean(storage.getPasswordRecord()),
    channelAllowlist: storage.getChannelAllowlist(),
    shortsAllowlist: storage.getShortsAllowlist(),
    pairing: pairing
      ? { portalUrl: pairing.portalUrl, paired: true }
      : { paired: false },
    syncMeta: {
      revision: meta.revision,
      dirty: meta.dirty,
      lastPulledAt: meta.lastPulledAt,
      lastPushAt: meta.lastPushAt,
      lastError: meta.lastError,
    },
  };
}

async function requestPortalPermission(portalUrl) {
  const origin = `${new URL(portalUrl).origin}/*`;
  if (!chrome.permissions?.request) return true;
  return chrome.permissions.request({ origins: [origin] });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ready
    .then(() => handleMessage(msg))
    .then(sendResponse)
    .catch((err) => {
      sendResponse({
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    });
  return true;
});

async function handleMessage(msg) {
  if (!msg || !msg.type) return { ok: false, error: "bad_message" };

  switch (msg.type) {
    case YTG_MSG.GET_PUBLIC_STATE:
      return { ok: true, state: publicState() };

    case YTG_MSG.HAS_PASSWORD:
      return { ok: true, hasPassword: Boolean(storage.getPasswordRecord()) };

    case YTG_MSG.SET_PASSWORD: {
      if (storage.getPasswordRecord()) {
        return { ok: false, error: "already_set" };
      }
      const err = validateNewPassword(msg.password, msg.confirm);
      if (err) return { ok: false, error: err };
      const record = await hashPassword(msg.password);
      await storage.setPasswordRecord(record);
      return { ok: true, state: publicState() };
    }

    case YTG_MSG.UNLOCK: {
      const ok = await verifyPassword(msg.password, storage.getPasswordRecord());
      if (!ok) return { ok: false, error: "wrong_password" };
      return { ok: true, state: publicState() };
    }

    case YTG_MSG.CHANGE_PASSWORD: {
      const ok = await verifyPassword(
        msg.currentPassword,
        storage.getPasswordRecord()
      );
      if (!ok) return { ok: false, error: "wrong_password" };
      const err = validateNewPassword(msg.password, msg.confirm);
      if (err) return { ok: false, error: err };
      const record = await hashPassword(msg.password);
      await storage.setPasswordRecord(record);
      return { ok: true };
    }

    case YTG_MSG.ADD_ENTRY: {
      if (!(await verifyPassword(msg.password, storage.getPasswordRecord()))) {
        return { ok: false, error: "wrong_password" };
      }
      const next = await storage.addEntry(msg.kind, msg.entry);
      queuePush();
      return { ok: true, list: next, state: publicState() };
    }

    case YTG_MSG.REMOVE_ENTRY: {
      if (!(await verifyPassword(msg.password, storage.getPasswordRecord()))) {
        return { ok: false, error: "wrong_password" };
      }
      const next = await storage.removeEntry(msg.kind, msg.index);
      queuePush();
      return { ok: true, list: next, state: publicState() };
    }

    case YTG_MSG.QUICK_ADD: {
      if (!(await verifyPassword(msg.password, storage.getPasswordRecord()))) {
        return { ok: false, error: "wrong_password" };
      }
      const kind = msg.kind === YTG_LIST.SHORTS ? YTG_LIST.SHORTS : YTG_LIST.CHANNEL;
      const next = await storage.addEntry(kind, msg.entry);
      queuePush();
      return { ok: true, list: next, state: publicState() };
    }

    case YTG_MSG.PAIR: {
      if (!(await verifyPassword(msg.password, storage.getPasswordRecord()))) {
        return { ok: false, error: "wrong_password" };
      }
      let portalUrl = String(msg.portalUrl || "").trim();
      const token = String(msg.token || "").trim();
      if (!portalUrl || !token) {
        return { ok: false, error: "Portal URL and pairing token are required." };
      }
      if (!/^https?:\/\//i.test(portalUrl)) portalUrl = `https://${portalUrl}`;
      const granted = await requestPortalPermission(portalUrl);
      if (!granted) {
        return { ok: false, error: "Permission to contact the portal was denied." };
      }
      await storage.setPairing({ portalUrl, token });
      try {
        const result = await storage.syncNow();
        return { ok: true, state: publicState(), result };
      } catch (err) {
        return {
          ok: false,
          error: err.message || String(err),
          state: publicState(),
        };
      }
    }

    case YTG_MSG.UNPAIR: {
      if (!(await verifyPassword(msg.password, storage.getPasswordRecord()))) {
        return { ok: false, error: "wrong_password" };
      }
      await storage.setPairing(null);
      return { ok: true, state: publicState() };
    }

    case YTG_MSG.SYNC_NOW: {
      if (!(await verifyPassword(msg.password, storage.getPasswordRecord()))) {
        return { ok: false, error: "wrong_password" };
      }
      try {
        await storage.syncNow();
        return { ok: true, state: publicState() };
      } catch (err) {
        return { ok: false, error: err.message || String(err), state: publicState() };
      }
    }

    default:
      return { ok: false, error: "unknown_message" };
  }
}

let pushTimer = null;
function queuePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    storage.syncNow().catch(() => {});
  }, 400);
}

ensureAlarm();
