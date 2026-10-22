const WHITELIST_EDIT_PASSWORD = "CHANGE_ME"; // placeholder; real password removed before publishing

const form = document.getElementById("add-form");
const input = document.getElementById("channel-input");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const errorEl = document.getElementById("error");
const lockPanel = document.getElementById("lock-panel");
const unlockForm = document.getElementById("unlock-form");
const passwordInput = document.getElementById("password-input");
const pwErrorEl = document.getElementById("pw-error");
let unlocked = false;

function showError(msg) {
  if (!msg) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = msg;
}

function showPwError(msg) {
  if (!msg) {
    pwErrorEl.hidden = true;
    pwErrorEl.textContent = "";
    return;
  }
  pwErrorEl.hidden = false;
  pwErrorEl.textContent = msg;
}

function updateLockUI() {
  lockPanel.hidden = unlocked;
  form.hidden = !unlocked;
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

async function loadList() {
  const data = await chrome.storage.sync.get(YT_WHITELIST_STORAGE_KEY);
  return data[YT_WHITELIST_STORAGE_KEY] || [];
}

async function saveList(list) {
  await chrome.storage.sync.set({ [YT_WHITELIST_STORAGE_KEY]: list });
}

function render(list) {
  listEl.innerHTML = "";
  emptyEl.hidden = list.length > 0;

  list.forEach((entry, index) => {
    const li = document.createElement("li");
    const removeBtn =
      unlocked ?
        `<button type="button" class="remove" data-index="${index}">Remove</button>`
      : "";
    li.innerHTML = `
      <div class="entry-meta">
        <div class="entry-label"></div>
        <div class="entry-sub"></div>
      </div>
      ${removeBtn}
    `;
    li.querySelector(".entry-label").textContent = formatEntryLabel(entry);
    li.querySelector(".entry-sub").textContent = formatEntrySub(entry);
    listEl.appendChild(li);
  });

  listEl.querySelectorAll(".remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!unlocked) return;
      const i = Number(btn.getAttribute("data-index"));
      const next = (await loadList()).filter((_, idx) => idx !== i);
      await saveList(next);
      render(next);
    });
  });
}

unlockForm.addEventListener("submit", (e) => {
  e.preventDefault();
  showPwError("");
  if (passwordInput.value === WHITELIST_EDIT_PASSWORD) {
    unlocked = true;
    passwordInput.value = "";
    updateLockUI();
    loadList().then(render);
  } else {
    showPwError("Wrong password.");
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!unlocked) return;
  showError("");
  const parsed = parseChannelInput(input.value);
  if (!parsed) {
    showError("Could not parse that. Try a channel URL, @handle, or UC… id.");
    return;
  }
  const current = await loadList();
  const next = addWhitelistEntry(current, parsed);
  await saveList(next);
  input.value = "";
  render(next);
});

updateLockUI();
loadList().then(render);
