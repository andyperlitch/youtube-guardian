(() => {
  const onboardPanel = document.getElementById("onboard-panel");
  const onboardForm = document.getElementById("onboard-form");
  const lockPanel = document.getElementById("lock-panel");
  const unlockForm = document.getElementById("unlock-form");
  const editor = document.getElementById("editor");
  const form = document.getElementById("add-form");
  const input = document.getElementById("channel-input");
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const errorEl = document.getElementById("error");
  const pwErrorEl = document.getElementById("pw-error");
  const onboardError = document.getElementById("onboard-error");
  const listPolicy = document.getElementById("list-policy");
  const pairStatus = document.getElementById("pair-status");
  const pairError = document.getElementById("pair-error");
  const pairForm = document.getElementById("pair-form");
  const changeForm = document.getElementById("change-form");
  const changeError = document.getElementById("change-error");
  const changeMsg = document.getElementById("change-msg");

  let unlocked = false;
  /** Session-only; never written to storage. */
  let sessionPassword = "";
  let activeTab = YTG_LIST.CHANNEL;
  let state = {
    hasPassword: false,
    channelAllowlist: [],
    shortsAllowlist: [],
    pairing: { paired: false },
    syncMeta: {},
  };

  function send(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { ok: false, error: "no_response" });
      });
    });
  }

  function show(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function currentList() {
    return activeTab === YTG_LIST.SHORTS
      ? state.shortsAllowlist || []
      : state.channelAllowlist || [];
  }

  function applyState(next) {
    if (next) state = next;
    renderShell();
    renderList();
    renderPairing();
  }

  function renderShell() {
    onboardPanel.hidden = state.hasPassword;
    lockPanel.hidden = !state.hasPassword || unlocked;
    editor.hidden = !state.hasPassword || !unlocked;
  }

  function formatEntryLabel(entry) {
    if (entry.handle) return `@${entry.handle}`;
    if (entry.channelId) return entry.channelId;
    return "Unknown";
  }

  function formatEntrySub(entry) {
    const parts = [];
    if (entry.channelId) parts.push(`ID: ${entry.channelId}`);
    if (entry.handle) parts.push(`Handle: @${entry.handle}`);
    return parts.join(" · ");
  }

  function renderList() {
    const list = currentList();
    listEl.innerHTML = "";
    if (activeTab === YTG_LIST.SHORTS) {
      listPolicy.textContent =
        "Shorts allowlist: empty means every Short is blocked. Regular-video allowlist does not apply here.";
      emptyEl.textContent = "No Shorts channels — all Shorts are blocked.";
    } else {
      listPolicy.textContent =
        "Channel allowlist: empty means all regular (/watch) videos are allowed. Shorts are not included.";
      emptyEl.textContent =
        "No channels yet — all regular YouTube videos are allowed.";
    }
    emptyEl.hidden = list.length > 0;

    list.forEach((entry, index) => {
      const li = document.createElement("li");
      const meta = document.createElement("div");
      const label = document.createElement("div");
      label.className = "entry-label";
      label.textContent = formatEntryLabel(entry);
      const sub = document.createElement("div");
      sub.className = "entry-sub";
      sub.textContent = formatEntrySub(entry);
      meta.append(label, sub);
      li.appendChild(meta);
      if (unlocked) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "remove";
        btn.textContent = "Remove";
        btn.addEventListener("click", async () => {
          const res = await send({
            type: YTG_MSG.REMOVE_ENTRY,
            password: sessionPassword,
            kind: activeTab,
            index,
          });
          if (!res.ok) {
            show(errorEl, res.error === "wrong_password" ? "Session expired. Unlock again." : res.error);
            return;
          }
          applyState(res.state);
        });
        li.appendChild(btn);
      }
      listEl.appendChild(li);
    });
  }

  function renderPairing() {
    const p = state.pairing || {};
    const m = state.syncMeta || {};
    if (p.paired) {
      pairStatus.textContent = `Paired with ${p.portalUrl}. Revision ${m.revision || 0}${
        m.lastError ? ` · last error: ${m.lastError}` : ""
      }`;
    } else {
      pairStatus.textContent = "Not paired — lists stay on this browser only.";
    }
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTab = tab.getAttribute("data-tab") === "shorts" ? YTG_LIST.SHORTS : YTG_LIST.CHANNEL;
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      renderList();
    });
  });

  onboardForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    show(onboardError, "");
    const password = document.getElementById("onboard-password").value;
    const confirm = document.getElementById("onboard-confirm").value;
    const res = await send({ type: YTG_MSG.SET_PASSWORD, password, confirm });
    if (!res.ok) {
      show(onboardError, res.error);
      return;
    }
    sessionPassword = password;
    unlocked = true;
    applyState(res.state);
  });

  unlockForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    show(pwErrorEl, "");
    const password = document.getElementById("password-input").value;
    const res = await send({ type: YTG_MSG.UNLOCK, password });
    if (!res.ok) {
      show(pwErrorEl, "Wrong password.");
      return;
    }
    sessionPassword = password;
    unlocked = true;
    document.getElementById("password-input").value = "";
    applyState(res.state);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!unlocked) return;
    show(errorEl, "");
    const parsed = parseChannelInput(input.value);
    if (!parsed) {
      show(errorEl, "Could not parse that. Try a channel URL, @handle, or UC… id.");
      return;
    }
    const res = await send({
      type: YTG_MSG.ADD_ENTRY,
      password: sessionPassword,
      kind: activeTab,
      entry: parsed,
    });
    if (!res.ok) {
      show(errorEl, res.error === "wrong_password" ? "Unlock again." : res.error);
      return;
    }
    input.value = "";
    applyState(res.state);
  });

  changeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    show(changeError, "");
    show(changeMsg, "");
    const res = await send({
      type: YTG_MSG.CHANGE_PASSWORD,
      currentPassword: document.getElementById("change-current").value,
      password: document.getElementById("change-new").value,
      confirm: document.getElementById("change-confirm").value,
    });
    if (!res.ok) {
      show(
        changeError,
        res.error === "wrong_password" ? "Current password is wrong." : res.error
      );
      return;
    }
    sessionPassword = document.getElementById("change-new").value;
    changeForm.reset();
    show(changeMsg, "Password updated.");
  });

  pairForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    show(pairError, "");
    let portalUrl = document.getElementById("portal-url").value.trim();
    if (portalUrl && !/^https?:\/\//i.test(portalUrl)) {
      portalUrl = `https://${portalUrl}`;
    }
    if (portalUrl && chrome.permissions?.request) {
      try {
        const origin = `${new URL(portalUrl).origin}/*`;
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) {
          show(pairError, "Permission to contact the portal was denied.");
          return;
        }
      } catch (err) {
        show(pairError, err.message || String(err));
        return;
      }
    }
    const res = await send({
      type: YTG_MSG.PAIR,
      password: sessionPassword,
      portalUrl,
      token: document.getElementById("pair-token").value,
    });
    if (res.state) applyState(res.state);
    if (!res.ok) {
      show(pairError, res.error);
      return;
    }
    show(pairError, "");
    pairForm.reset();
  });

  document.getElementById("sync-now").addEventListener("click", async () => {
    show(pairError, "");
    const res = await send({ type: YTG_MSG.SYNC_NOW, password: sessionPassword });
    if (res.state) applyState(res.state);
    if (!res.ok) show(pairError, res.error);
  });

  document.getElementById("unpair").addEventListener("click", async () => {
    show(pairError, "");
    const res = await send({ type: YTG_MSG.UNPAIR, password: sessionPassword });
    if (res.state) applyState(res.state);
    if (!res.ok) show(pairError, res.error);
  });

  send({ type: YTG_MSG.GET_PUBLIC_STATE }).then((res) => {
    applyState(res.state || { hasPassword: false, channelAllowlist: [], shortsAllowlist: [] });
  });
})();
