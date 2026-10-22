(() => {
  let whitelist = [];
  let playBlocker = null;
  let overlayEl = null;
  let lastVideoEl = null;
  let mo = null;
  let pollTimer = null;

  function isWatchOrShorts() {
    const p = location.pathname;
    return p.startsWith("/watch") || p.startsWith("/shorts/");
  }

  function extractChannelFromPage() {
    let channelId = null;
    let handle = null;

    const ownerSelectors = [
      "ytd-video-owner-renderer",
      "ytd-reel-video-renderer ytd-channel-name",
      "ytd-watch-metadata ytd-channel-name",
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
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function detachPlayBlocker() {
    if (playBlocker && lastVideoEl) {
      lastVideoEl.removeEventListener("play", playBlocker, true);
    }
    playBlocker = null;
    lastVideoEl = null;
  }

  function ensureBlockedUI() {
    if (overlayEl && overlayEl.isConnected) return;

    removeOverlay();
    overlayEl = document.createElement("div");
    overlayEl.id = "yt-whitelist-block-overlay";
    overlayEl.setAttribute(
      "style",
      [
        "position:fixed",
        "inset:0",
        "z-index:2147483646",
        "background:rgba(15,15,15,0.92)",
        "color:#f1f1f1",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "font-family:Roboto,Arial,sans-serif",
        "padding:24px",
        "box-sizing:border-box",
        "text-align:center",
      ].join(";")
    );
    overlayEl.innerHTML = `
      <div style="max-width:420px;line-height:1.5">
        <div style="font-size:20px;font-weight:500;margin-bottom:12px">This channel is not on your whitelist</div>
        <div style="font-size:14px;opacity:0.85;margin-bottom:20px">
          Only channels you add in the extension popup can play videos here.
        </div>
        <div style="font-size:13px;opacity:0.7;margin-bottom:16px">
          Click the extension icon to manage allowed channels.
        </div>
        <a href="https://www.youtube.com/" style="font-size:14px;font-weight:500;color:#8ab4f8;text-decoration:underline">
          Go to YouTube home
        </a>
      </div>
    `;
    const mount = document.body || document.documentElement;
    mount.appendChild(overlayEl);
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

  async function refreshWhitelist() {
    const data = await chrome.storage.sync.get(YT_WHITELIST_STORAGE_KEY);
    whitelist = data[YT_WHITELIST_STORAGE_KEY] || [];
  }

  function evaluate() {
    if (!isWatchOrShorts()) {
      removeOverlay();
      detachPlayBlocker();
      return;
    }

    const video = findPrimaryVideo();
    const { channelId, handle } = extractChannelFromPage();

    const allowed = isChannelAllowed(channelId, handle, whitelist);

    if (allowed) {
      removeOverlay();
      detachPlayBlocker();
      return;
    }

    if (!channelId && !handle) {
      return;
    }

    ensureBlockedUI();
    if (video) attachPlayBlocker(video);
  }

  function startObservers() {
    if (mo) return;
    mo = new MutationObserver(() => {
      evaluate();
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      evaluate();
    }, 1000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[YT_WHITELIST_STORAGE_KEY]) return;
    whitelist = changes[YT_WHITELIST_STORAGE_KEY].newValue || [];
    evaluate();
  });

  window.addEventListener("popstate", () => evaluate());
  window.addEventListener("hashchange", () => evaluate());

  refreshWhitelist().then(() => {
    startObservers();
    evaluate();
  });
})();
