/**
 * PBKDF2-SHA-256 password hashing via WebCrypto. Never store plaintext.
 */
(function (root) {
  const consts =
    typeof module !== "undefined" && module.exports
      ? require("./constants.js")
      : root;
  const ITERATIONS = consts.YTG_PBKDF2_ITERATIONS || 210000;

  function bytesToB64(bytes) {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function timingSafeEqualB64(a, b) {
    const x = b64ToBytes(a);
    const y = b64ToBytes(b);
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
  }

  /**
   * @param {string} password
   * @param {{ salt: string, iterations?: number } | null} [existing]
   */
  async function hashPassword(password, existing) {
    const enc = new TextEncoder();
    const salt = existing?.salt
      ? b64ToBytes(existing.salt)
      : crypto.getRandomValues(new Uint8Array(16));
    const iterations = existing?.iterations || ITERATIONS;
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );
    return {
      algo: "PBKDF2-SHA256",
      iterations,
      salt: bytesToB64(salt),
      hash: bytesToB64(bits),
    };
  }

  /**
   * @param {string} password
   * @param {{ salt: string, hash: string, iterations?: number } | null} record
   */
  async function verifyPassword(password, record) {
    if (!record || !record.salt || !record.hash) return false;
    if (typeof password !== "string" || password.length === 0) return false;
    const next = await hashPassword(password, record);
    return timingSafeEqualB64(next.hash, record.hash);
  }

  function validateNewPassword(password, confirm) {
    if (typeof password !== "string" || password.length < 8) {
      return "Password must be at least 8 characters.";
    }
    if (password !== confirm) {
      return "Passwords do not match.";
    }
    return null;
  }

  const api = {
    hashPassword,
    verifyPassword,
    validateNewPassword,
    timingSafeEqualB64,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
