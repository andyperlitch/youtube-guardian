const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const logoutBtn = document.getElementById("logout");
const loginError = document.getElementById("login-error");
const deviceList = document.getElementById("device-list");
const detail = document.getElementById("detail");

let devices = [];
let selectedId = null;
let lastToken = null;

function showError(el, msg) {
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function refreshSession() {
  try {
    await api("/api/admin/me");
    loginView.hidden = true;
    appView.hidden = false;
    logoutBtn.hidden = false;
    await loadDevices();
  } catch {
    loginView.hidden = false;
    appView.hidden = true;
    logoutBtn.hidden = true;
  }
}

async function loadDevices() {
  const data = await api("/api/admin/devices");
  devices = data.devices || [];
  renderDevices();
  if (selectedId) await loadDetail(selectedId);
}

function renderDevices() {
  deviceList.innerHTML = "";
  if (!devices.length) {
    const li = document.createElement("li");
    li.textContent = "No devices yet.";
    li.style.cursor = "default";
    deviceList.appendChild(li);
    return;
  }
  for (const d of devices) {
    const li = document.createElement("li");
    li.textContent = d.name;
    if (d.id === selectedId) li.classList.add("active");
    li.addEventListener("click", () => loadDetail(d.id));
    deviceList.appendChild(li);
  }
}

function label(entry) {
  if (entry.handle) return `@${entry.handle}`;
  return entry.channelId || "unknown";
}

async function loadDetail(id) {
  selectedId = id;
  renderDevices();
  const data = await api(`/api/admin/devices/${id}/allowlists`);
  const tokenNote = lastToken?.deviceId === id
    ? `<div class="token-box">${lastToken.token}</div>
       <p class="muted">Copy this pairing token now. It is shown only once. Portal URL: <code>${lastToken.portalUrl}</code></p>`
    : `<p class="muted">Pairing token was shown only when this device was created.</p>`;

  detail.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <h2>${data.device.name}</h2>
      <button type="button" class="danger" id="delete-device">Delete</button>
    </div>
    ${tokenNote}
    <p class="muted">Revision ${data.device.revision} · updated ${data.device.updatedAt}</p>
    <div class="lists">
      <div>
        <h2>Channels (regular videos)</h2>
        <p class="muted">Empty = all regular videos allowed on paired extensions.</p>
        <form id="add-channel" class="row">
          <input placeholder="@handle or UC…" />
          <button type="submit">Add</button>
        </form>
        <ul class="list" id="channel-list"></ul>
      </div>
      <div>
        <h2>Shorts</h2>
        <p class="muted">Empty = all Shorts blocked on paired extensions.</p>
        <form id="add-shorts" class="row">
          <input placeholder="@handle or UC…" />
          <button type="submit">Add</button>
        </form>
        <ul class="list" id="shorts-list"></ul>
      </div>
    </div>
  `;

  fillList("channel-list", data.channels || [], "channel", data);
  fillList("shorts-list", data.shorts || [], "shorts", data);

  document.getElementById("delete-device").addEventListener("click", async () => {
    if (!confirm("Delete this device and its lists?")) return;
    await api(`/api/admin/devices/${id}`, { method: "DELETE" });
    selectedId = null;
    lastToken = null;
    detail.innerHTML = `<p class="muted">Select a device to edit channel and Shorts allowlists.</p>`;
    await loadDevices();
  });

  wireAdd("add-channel", "channels", data);
  wireAdd("add-shorts", "shorts", data);
}

function parseEntry(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const uc = s.match(/\/channel\/(UC[\w-]{22})/i) || s.match(/^(UC[\w-]{22})$/i);
  const at = s.match(/@([^/?#\s]+)/) || (/^[\w.-]+$/.test(s) ? [null, s] : null);
  const channelId = uc ? uc[1].toUpperCase() : null;
  const handle = at ? String(at[1]).toLowerCase().replace(/^@/, "") : null;
  if (!channelId && !handle) return null;
  return { channelId, handle };
}

function fillList(domId, items, kind, data) {
  const ul = document.getElementById(domId);
  ul.innerHTML = "";
  items.forEach((entry, index) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = label(entry);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary";
    btn.textContent = "Remove";
    btn.addEventListener("click", async () => {
      const channels = [...(data.channels || [])];
      const shorts = [...(data.shorts || [])];
      if (kind === "channel") channels.splice(index, 1);
      else shorts.splice(index, 1);
      await api(`/api/admin/devices/${data.device.id}/allowlists`, {
        method: "PUT",
        body: JSON.stringify({ channels, shorts }),
      });
      await loadDetail(data.device.id);
    });
    li.append(span, btn);
    ul.appendChild(li);
  });
}

function wireAdd(formId, which, data) {
  document.getElementById(formId).addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.currentTarget.querySelector("input");
    const parsed = parseEntry(input.value);
    if (!parsed) return;
    const channels = [...(data.channels || [])];
    const shorts = [...(data.shorts || [])];
    const target = which === "channels" ? channels : shorts;
    target.push(parsed);
    await api(`/api/admin/devices/${data.device.id}/allowlists`, {
      method: "PUT",
      body: JSON.stringify({ channels, shorts }),
    });
    input.value = "";
    await loadDetail(data.device.id);
  });
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError(loginError, "");
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        password: document.getElementById("login-password").value,
      }),
    });
    await refreshSession();
  } catch (err) {
    showError(loginError, err.message === "invalid_password" ? "Wrong password." : err.message);
  }
});

logoutBtn.addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  selectedId = null;
  await refreshSession();
});

document.getElementById("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("device-name").value;
  const created = await api("/api/admin/devices", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  lastToken = {
    deviceId: created.device.id,
    token: created.pairingToken,
    portalUrl: created.portalUrl,
  };
  document.getElementById("device-name").value = "";
  selectedId = created.device.id;
  await loadDevices();
});

refreshSession();
