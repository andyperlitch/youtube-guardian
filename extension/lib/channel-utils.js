/**
 * Parsing, allowlist membership, and playback policy.
 *
 * Defaults (parental tool):
 * - Empty **channel** allowlist => all regular (/watch) videos are allowed.
 * - Empty **Shorts** allowlist => all /shorts playback is blocked.
 * - The two lists are independent: a channel on one is not auto-added to the other.
 *
 * @typedef {{ channelId: string | null, handle: string | null }} AllowlistEntry
 */
(function (root) {
  const consts =
    typeof module !== "undefined" && module.exports
      ? require("./constants.js")
      : root;
  const { YTG_LIST } = consts;

  /**
   * @param {string} raw
   * @returns {AllowlistEntry | null}
   */
  function parseChannelInput(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;

    let channelId = null;
    let handle = null;

    const uc = s.match(/\/channel\/(UC[\w-]{22})/i) || s.match(/^(UC[\w-]{22})$/i);
    if (uc) channelId = uc[1].toUpperCase();

    const at =
      s.match(/youtube\.com\/@([^/?#\s]+)/i) || s.match(/^@([^/?#\s]+)/i);
    if (at) handle = decodeURIComponent(at[1]);

    if (!channelId && !handle && /^[\w.-]+$/.test(s) && !s.startsWith("http")) {
      handle = s.replace(/^@/, "");
    }

    if (!channelId && !handle) return null;
    return {
      channelId: channelId || null,
      handle: handle ? handle.toLowerCase() : null,
    };
  }

  /**
   * @param {AllowlistEntry} a
   */
  function allowlistEntryKey(a) {
    const id = (a.channelId || "").toUpperCase();
    const h = (a.handle || "").toLowerCase().replace(/^@/, "");
    return `${id}|${h}`;
  }

  /**
   * @param {AllowlistEntry[]} list
   * @param {AllowlistEntry} entry
   * @returns {AllowlistEntry[]}
   */
  function addAllowlistEntry(list, entry) {
    const key = allowlistEntryKey(entry);
    const next = (list || []).filter((e) => allowlistEntryKey(e) !== key);
    const normalized = {
      channelId: entry.channelId ? entry.channelId.toUpperCase() : null,
      handle: entry.handle ? entry.handle.toLowerCase().replace(/^@/, "") : null,
    };
    next.push(normalized);
    return next;
  }

  /**
   * @param {AllowlistEntry[]} list
   * @param {number} index
   */
  function removeAllowlistIndex(list, index) {
    return (list || []).filter((_, i) => i !== index);
  }

  /**
   * Membership only (empty list => not a member).
   * @param {string | null} channelId
   * @param {string | null} handle
   * @param {AllowlistEntry[]} list
   */
  function isChannelOnList(channelId, handle, list) {
    if (!list || list.length === 0) return false;

    const id = channelId ? channelId.toUpperCase() : "";
    const h = handle ? handle.toLowerCase().replace(/^@/, "") : "";

    return list.some((e) => {
      if (e.channelId && id && e.channelId.toUpperCase() === id) return true;
      if (e.handle && h && e.handle.toLowerCase().replace(/^@/, "") === h) {
        return true;
      }
      return false;
    });
  }

  /**
   * Legacy helper: empty channel allowlist allows everyone.
   * @param {string | null} channelId
   * @param {string | null} handle
   * @param {AllowlistEntry[]} whitelist
   */
  function isChannelAllowed(channelId, handle, whitelist) {
    if (!whitelist || whitelist.length === 0) return true;
    return isChannelOnList(channelId, handle, whitelist);
  }

  /**
   * @param {string} pathname
   */
  function isShortsPath(pathname) {
    return String(pathname || "").startsWith("/shorts/");
  }

  /**
   * @param {string} pathname
   */
  function isWatchOrShortsPath(pathname) {
    const p = String(pathname || "");
    return p.startsWith("/watch") || p.startsWith("/shorts/");
  }

  /**
   * @param {{
   *   isShorts: boolean,
   *   channelId: string | null,
   *   handle: string | null,
   *   channelAllowlist: AllowlistEntry[],
   *   shortsAllowlist: AllowlistEntry[],
   * }} ctx
   */
  function isPlaybackAllowed(ctx) {
    const { isShorts, channelId, handle, channelAllowlist, shortsAllowlist } =
      ctx;
    if (isShorts) {
      return isChannelOnList(channelId, handle, shortsAllowlist);
    }
    return isChannelAllowed(channelId, handle, channelAllowlist);
  }

  /**
   * @param {boolean} isShorts
   */
  function listKindForPage(isShorts) {
    return isShorts ? YTG_LIST.SHORTS : YTG_LIST.CHANNEL;
  }

  /**
   * Human-readable identity for copy/UI.
   * @param {{ channelId?: string | null, handle?: string | null }} entry
   */
  function formatChannelIdentity(entry) {
    const handle = entry.handle
      ? `@${String(entry.handle).replace(/^@/, "")}`
      : null;
    const id = entry.channelId || null;
    const parts = [];
    if (handle) parts.push(handle);
    if (id) parts.push(id);
    return {
      handle,
      channelId: id,
      copyText: parts.join("\n") || "",
      label: handle || id || "Unknown channel",
    };
  }

  const api = {
    parseChannelInput,
    allowlistEntryKey,
    addAllowlistEntry,
    addWhitelistEntry: addAllowlistEntry,
    removeAllowlistIndex,
    isChannelOnList,
    isChannelAllowed,
    isShortsPath,
    isWatchOrShortsPath,
    isPlaybackAllowed,
    listKindForPage,
    formatChannelIdentity,
    YT_WHITELIST_STORAGE_KEY: "ytChannelWhitelist",
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
