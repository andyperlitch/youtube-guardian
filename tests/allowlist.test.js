const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseChannelInput,
  addAllowlistEntry,
  isChannelOnList,
  isChannelAllowed,
  isPlaybackAllowed,
  isShortsPath,
  listKindForPage,
} = require("../extension/lib/channel-utils.js");

describe("parseChannelInput", () => {
  it("parses UC ids, handles, and URLs", () => {
    assert.equal(
      parseChannelInput("UCaaaaaaaaaaaaaaaaaaaaaa").channelId,
      "UCAAAAAAAAAAAAAAAAAAAAAA"
    );
    assert.equal(parseChannelInput("@PBSKids").handle, "pbskids");
    assert.equal(
      parseChannelInput("https://www.youtube.com/@CrashCourse").handle,
      "crashcourse"
    );
    assert.equal(
      parseChannelInput("https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa")
        .channelId,
      "UCAAAAAAAAAAAAAAAAAAAAAA"
    );
    assert.equal(parseChannelInput(""), null);
    assert.equal(parseChannelInput("https://example.com"), null);
  });
});

describe("allowlist membership", () => {
  const list = addAllowlistEntry([], { handle: "pbs", channelId: null });

  it("matches handle case-insensitively", () => {
    assert.equal(isChannelOnList(null, "PBS", list), true);
    assert.equal(isChannelOnList(null, "other", list), false);
  });

  it("empty channel allowlist allows regular videos", () => {
    assert.equal(isChannelAllowed("UCX", "x", []), true);
  });

  it("empty shorts allowlist blocks shorts", () => {
    assert.equal(
      isPlaybackAllowed({
        isShorts: true,
        channelId: "UCX",
        handle: "pbs",
        channelAllowlist: list,
        shortsAllowlist: [],
      }),
      false
    );
  });

  it("channel allowlist does not grant Shorts", () => {
    assert.equal(
      isPlaybackAllowed({
        isShorts: true,
        channelId: null,
        handle: "pbs",
        channelAllowlist: list,
        shortsAllowlist: [],
      }),
      false
    );
  });

  it("shorts allowlist does not grant regular videos when channel list is non-empty", () => {
    assert.equal(
      isPlaybackAllowed({
        isShorts: false,
        channelId: null,
        handle: "pbs",
        channelAllowlist: [{ handle: "other", channelId: null }],
        shortsAllowlist: list,
      }),
      false
    );
  });

  it("shorts member can play shorts only", () => {
    assert.equal(
      isPlaybackAllowed({
        isShorts: true,
        channelId: null,
        handle: "pbs",
        channelAllowlist: [],
        shortsAllowlist: list,
      }),
      true
    );
  });
});

describe("paths", () => {
  it("detects shorts vs watch", () => {
    assert.equal(isShortsPath("/shorts/abc"), true);
    assert.equal(isShortsPath("/watch"), false);
    assert.equal(listKindForPage(true), "shorts");
    assert.equal(listKindForPage(false), "channel");
  });
});
