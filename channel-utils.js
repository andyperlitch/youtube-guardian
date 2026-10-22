/**
 * Shared parsing + normalization for whitelist entries (no module system).
 * @typedef {{ channelId: string | null, handle: string | null }} WhitelistEntry
 */

const YT_WHITELIST_STORAGE_KEY = "ytChannelWhitelist";

/**
 * @param {string} raw
 * @returns {WhitelistEntry | null}
 */
function parseChannelInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  let channelId = null;
  let handle = null;

  const uc = s.match(/\/channel\/(UC[\w-]{22})/i) || s.match(/^(UC[\w-]{22})$/i);
  if (uc) channelId = uc[1];

  const at =
    s.match(/youtube\.com\/@([^/?#\s]+)/i) || s.match(/^@([^/?#\s]+)/i);
  if (at) handle = decodeURIComponent(at[1]);

  if (!channelId && !handle && /^[\w.-]+$/.test(s) && !s.startsWith("http")) {
    handle = s.replace(/^@/, "");
  }

  if (!channelId && !handle) return null;
  return { channelId, handle: handle ? handle.toLowerCase() : null };
}

/**
 * @param {WhitelistEntry} a
 * @param {WhitelistEntry} b
 */
function whitelistEntryKey(a) {
  const id = (a.channelId || "").toUpperCase();
  const h = (a.handle || "").toLowerCase();
  return `${id}|${h}`;
}

/**
 * @param {WhitelistEntry[]} list
 * @param {WhitelistEntry} entry
 * @returns {WhitelistEntry[]}
 */
function addWhitelistEntry(list, entry) {
  const key = whitelistEntryKey(entry);
  const next = list.filter((e) => whitelistEntryKey(e) !== key);
  next.push(entry);
  return next;
}

/**
 * @param {string | null} channelId
 * @param {string | null} handle
 * @param {WhitelistEntry[]} whitelist
 */
function isChannelAllowed(channelId, handle, whitelist) {
  if (!whitelist || whitelist.length === 0) return true;

  const id = channelId ? channelId.toUpperCase() : "";
  const h = handle ? handle.toLowerCase().replace(/^@/, "") : "";

  return whitelist.some((e) => {
    if (e.channelId && id && e.channelId.toUpperCase() === id) return true;
    if (e.handle && h && e.handle.toLowerCase() === h) return true;
    return false;
  });
}
