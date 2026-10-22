/**
 * Shared constants for YouTube Guardian (classic script + Node).
 */
(function (root) {
  const YTG_KEYS = Object.freeze({
    CHANNEL: "ytg.channelAllowlist",
    SHORTS: "ytg.shortsAllowlist",
    SETTINGS: "ytg.settings",
    SYNC: "ytg.syncMeta",
    /** Legacy key from v1 (chrome.storage.sync). */
    LEGACY_WHITELIST: "ytChannelWhitelist",
  });

  const YTG_MSG = Object.freeze({
    GET_PUBLIC_STATE: "YTG_GET_PUBLIC_STATE",
    HAS_PASSWORD: "YTG_HAS_PASSWORD",
    SET_PASSWORD: "YTG_SET_PASSWORD",
    UNLOCK: "YTG_UNLOCK",
    CHANGE_PASSWORD: "YTG_CHANGE_PASSWORD",
    ADD_ENTRY: "YTG_ADD_ENTRY",
    REMOVE_ENTRY: "YTG_REMOVE_ENTRY",
    REPLACE_LIST: "YTG_REPLACE_LIST",
    QUICK_ADD: "YTG_QUICK_ADD",
    PAIR: "YTG_PAIR",
    UNPAIR: "YTG_UNPAIR",
    SYNC_NOW: "YTG_SYNC_NOW",
  });

  const YTG_LIST = Object.freeze({
    CHANNEL: "channel",
    SHORTS: "shorts",
  });

  const YTG_PBKDF2_ITERATIONS = 210_000;

  const api = { YTG_KEYS, YTG_MSG, YTG_LIST, YTG_PBKDF2_ITERATIONS };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
