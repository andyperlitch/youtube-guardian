const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  hashPassword,
  verifyPassword,
  validateNewPassword,
} = require("../extension/lib/password.js");

describe("password hashing", () => {
  it("rejects short or mismatched passwords", () => {
    assert.ok(validateNewPassword("short", "short"));
    assert.equal(validateNewPassword("long-enough", "other"), "Passwords do not match.");
    assert.equal(validateNewPassword("long-enough", "long-enough"), null);
  });

  it("stores a salted hash and verifies", async () => {
    const record = await hashPassword("correct-horse");
    assert.equal(record.algo, "PBKDF2-SHA256");
    assert.ok(record.salt);
    assert.ok(record.hash);
    assert.equal(record.hash.includes("correct-horse"), false);
    assert.equal(await verifyPassword("correct-horse", record), true);
    assert.equal(await verifyPassword("wrong-password", record), false);
    assert.equal(await verifyPassword("correct-horse", null), false);
  });
});
