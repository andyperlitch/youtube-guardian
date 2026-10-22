(() => {
  const storage = createStorageFacade(createChromeLocalAdapter());

  let playBlocker = null;
  let lastVideoEl = null;
  let overlayHost = null;
  let shadow = null;
  let mo = null;
  let pollTimer = null;
  let copyTimer = null;

  function currentIsShorts() {
    return isShortsPath(location.pathname);
  }

  function extractChannelFromPage() {
    let channelId = null;
    let handle = null;

    const ownerSelectors = [
      "ytd-video-owner-renderer",
      "ytd-reel-video-renderer ytd-channel-name",
      "ytd-watch-metadata ytd-channel-name",
      "ytd-reel-player-overlay-renderer ytd-channel-name",
    ];

    for (const sel of ownerSelectors) {
      const root = document.querySelector(sel);
      if (!root) continue;
      const links = root.querySelectorAll('a[href*="/channel/"], a[href*="/@"]');
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        const uc = href.match(/\/channel\/(UC[\w-]{22})/i);
        if (uc) channelId = uc[1].toUpperCase();
        const at = href.match(/\/@([^/?#]+)/i);
        if (at) handle = decodeURIComponent(at[1]).toLowerCase();
      }
      if (channelId || handle) break;
    }

    if (!channelId) {
      const m = location.href.match(/\/channel\/(UC[\w-]{22})/i);
      if (m) channelId = m[1].toUpperCase();
    }

    return { channelId, handle };
  }

  function removeOverlay() {
    if (overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      shadow = null;
    }
  }

  function detachPlayBlocker() {
    if (playBlocker && lastVideoEl) {
      lastVideoEl.removeEventListener("play", playBlocker, true);
    }
    playBlocker = null;
    lastVideoEl = null;
  }

  function overlayStyles() {
    return `
      :host { all: initial; }
      .wrap {
        position: fixed; inset: 0; z-index: 2147483646;
        background: rgba(15,15,15,0.94);
        color: #f1f1f1;
        display: flex; align-items: center; justify-content: center;
        font-family: Roboto, Arial, system-ui, sans-serif;
        padding: 24px; box-sizing: border-box;
      }
      .card {
        width: min(460px, 100%);
        text-align: left;
        line-height: 1.5;
      }
      h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
      .sub { font-size: 14px; opacity: 0.85; margin: 0 0 16px; }
      .ident {
        display: flex; gap: 8px; align-items: flex-start;
        background: #1f1f1f; border: 1px solid #333; border-radius: 8px;
        padding: 10px 12px; margin-bottom: 12px;
      }
      .ident code {
        flex: 1; font-size: 13px; white-space: pre-wrap; word-break: break-all;
        color: #e8eaed;
      }
      button, .link {
        font: 13px/1.4 Roboto, Arial, sans-serif;
        cursor: pointer;
      }
      .copy {
        flex-shrink: 0;
        border: 1px solid #5f6368; background: #2b2b2b; color: #fff;
        border-radius: 6px; padding: 6px 10px;
      }
      .copy:hover { background: #3a3a3a; }
      form { display: flex; flex-direction: column; gap: 8px; margin: 12px 0 8px; }
      input[type="password"] {
        padding: 10px 12px; border-radius: 6px; border: 1px solid #5f6368;
        background: #111; color: #fff; font-size: 14px;
      }
      .add {
        padding: 10px 12px; border: none; border-radius: 6px;
        background: #1a73e8; color: #fff; font-weight: 500;
      }
      .add:hover { background: #1557b0; }
      .err { color: #f28b82; font-size: 13px; min-height: 1.2em; }
      .ok { color: #81c995; font-size: 13px; }
      .home { color: #8ab4f8; font-size: 14px; }
      .hint { font-size: 12px; opacity: 0.7; margin: 0 0 8px; }
    `;
  }

  function ensureBlockedUI(info) {
    const identity = formatChannelIdentity(info);
    const isShorts = currentIsShorts();
    const listLabel = isShorts ? "Shorts allowlist" : "channel allowlist";

    if (!overlayHost || !overlayHost.isConnected || !shadow) {
      removeOverlay();
      overlayHost = document.createElement("div");
      overlayHost.id = "ytg-block-host";
      shadow = overlayHost.attachShadow({ mode: "closed" });
      (document.body || document.documentElement).appendChild(overlayHost);
    }

    shadow.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = overlayStyles();
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.innerHTML = `
      <div class="card">
        <h1></h1>
        <p class="sub"></p>
        <div class="ident">
          <code></code>
          <button type="button" class="copy">Copy</button>
        </div>
        <p class="hint"></p>
        <form>
          <input type="password" autocomplete="off" spellcheck="false" placeholder="Parent password" />
          <button type="submit" class="add"></button>
        </form>
        <p class="err" hidden></p>
        <p class="ok" hidden></p>
        <a class="home" href="https://www.youtube.com/">Go to YouTube home</a>
      </div>
    `;
    wrap.querySelector("h1").textContent = isShorts
      ? "This Short is blocked"
      : "This channel is not allowed";
    wrap.querySelector(".sub").textContent = isShorts
      ? "Shorts only play when the channel is on the Shorts allowlist (separate from regular videos)."
      : "Only channels on the allowlist can play regular videos. An empty channel list allows all regular videos.";
    wrap.querySelector("code").textContent =
      identity.copyText || identity.label;
    wrap.querySelector(".hint").textContent =
      `Enter the parent password to add this channel to the ${listLabel} and resume.`;
    wrap.querySelector(".add").textContent = isShorts
      ? "Allow for Shorts"
      : "Allow for regular videos";

    wrap.querySelector(".copy").addEventListener("click", async () => {
      const text = identity.copyText || identity.label;
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      wrap.querySelector(".copy").textContent = "Copied";
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        if (wrap.querySelector(".copy")) wrap.querySelector(".copy").textContent = "Copy";
      }, 1500);
    });

    const form = wrap.querySelector("form");
    const pw = wrap.querySelector("input");
    const errEl = wrap.querySelector(".err");
    const okEl = wrap.querySelector(".ok");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errEl.hidden = true;
      okEl.hidden = true;
      chrome.runtime.sendMessage(
        {
          type: YTG_MSG.QUICK_ADD,
          password: pw.value,
          kind: listKindForPage(isShorts),
          entry: { channelId: info.channelId, handle: info.handle },
        },
        (res) => {
          if (chrome.runtime.lastError || !res?.ok) {
            errEl.hidden = false;
            errEl.textContent =
              res?.error === "wrong_password"
                ? "Wrong password."
                : res?.error || chrome.runtime.lastError?.message || "Could not add.";
            return;
          }
          okEl.hidden = false;
          okEl.textContent = "Added. Resuming…";
          pw.value = "";
          evaluate();
          const video = findPrimaryVideo();
          if (video) {
            video.play().catch(() => {});
          }
        }
      );
    });

    shadow.append(style, wrap);
  }

  function attachPlayBlocker(video) {
    detachPlayBlocker();
    lastVideoEl = video;
    playBlocker = () => {
      video.pause();
    };
    video.addEventListener("play", playBlocker, true);
    video.pause();
    try {
      video.currentTime = 0;
    } catch (_) {
      /* ignore */
    }
  }

  function findPrimaryVideo() {
    const v = document.querySelector("ytd-app video");
    return v || document.querySelector("video");
  }

  function evaluate() {
    if (!isWatchOrShortsPath(location.pathname)) {
      removeOverlay();
      detachPlayBlocker();
      return;
    }

    const video = findPrimaryVideo();
    const { channelId, handle } = extractChannelFromPage();
    const isShorts = currentIsShorts();
    const allowed = isPlaybackAllowed({
      isShorts,
      channelId,
      handle,
      channelAllowlist: storage.getChannelAllowlist(),
      shortsAllowlist: storage.getShortsAllowlist(),
    });

    if (allowed) {
      removeOverlay();
      detachPlayBlocker();
      return;
    }

    if (!channelId && !handle) {
      return;
    }

    ensureBlockedUI({ channelId, handle });
    if (video) attachPlayBlocker(video);
  }

  function startObservers() {
    if (mo) return;
    mo = new MutationObserver(() => evaluate());
    mo.observe(document.documentElement, { childList: true, subtree: true });
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => evaluate(), 1000);
  }

  storage.onChange(() => evaluate());

  window.addEventListener("popstate", () => evaluate());
  window.addEventListener("hashchange", () => evaluate());

  storage.init().then(() => {
    startObservers();
    evaluate();
  });
})();
