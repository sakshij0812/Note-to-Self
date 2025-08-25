// Aurora Inbox - Vanilla JS PWA using GitHub Contents API
// Notes are saved to {owner}/{repo}@{branch}:{path} as JSON.
// Token needs repository permissions → Contents: Read and Write for that repo.
// WARNING: Storing a token in localStorage exposes it to anyone with device/browser access. For personal use only.

const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  emails: [],
  fileSha: null, // last known sha of JSON in repo
  config: {
    owner: "",
    repo: "",
    branch: "main",
    path: "emails.json",
    token: ""
  },
  unreadLocal: new Set() // track unread locally (ids)
};

const ui = {
  tabs: {
    compose: qs("#composeTab"),
    inbox: qs("#inboxTab"),
  },
  panels: {
    compose: qs("#composePanel"),
    inbox: qs("#inboxPanel"),
  },
  composeForm: qs("#composeForm"),
  clearForm: qs("#clearForm"),
  refreshInbox: qs("#refreshInbox"),
  exportJson: qs("#exportJson"),
  inboxList: qs("#inboxList"),
  emptyState: qs("#emptyState"),
  toast: qs("#toast"),
  settings: {
    dialog: qs("#settingsDialog"),
    open: qs("#openSettings"),
    save: qs("#saveSettings"),
    toggleToken: qs("#toggleToken"),
    fields: {
      owner: qs("#owner"),
      repo: qs("#repo"),
      branch: qs("#branch"),
      path: qs("#path"),
      token: qs("#token"),
    }
  }
};

// Utilities
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const encodeBase64 = (str) => btoa(unescape(encodeURIComponent(str)));
const decodeBase64 = (b64) => decodeURIComponent(escape(atob(b64)));
const nowIso = () => new Date().toISOString();
const niceDate = (iso) => new Date(iso).toLocaleString();

function showToast(msg, ms = 2200) {
  ui.toast.textContent = msg;
  ui.toast.classList.add("show");
  setTimeout(() => ui.toast.classList.remove("show"), ms);
}

function loadConfig() {
  try {
    const raw = localStorage.getItem("auroraInbox.config");
    if (raw) {
      const cfg = JSON.parse(raw);
      state.config = { ...state.config, ...cfg };
    }
  } catch {}
  // Seed UI
  const { owner, repo, branch, path, token } = state.config;
  ui.settings.fields.owner.value = owner || "";
  ui.settings.fields.repo.value = repo || "";
  ui.settings.fields.branch.value = branch || "main";
  ui.settings.fields.path.value = path || "emails.json";
  ui.settings.fields.token.value = token || "";
}

function saveConfig() {
  const cfg = {
    owner: ui.settings.fields.owner.value.trim(),
    repo: ui.settings.fields.repo.value.trim(),
    branch: ui.settings.fields.branch.value.trim() || "main",
    path: ui.settings.fields.path.value.trim() || "emails.json",
    token: ui.settings.fields.token.value.trim(),
  };
  state.config = cfg;
  localStorage.setItem("auroraInbox.config", JSON.stringify(cfg));
  showToast("Settings saved");
}

function isConfigComplete() {
  const { owner, repo, branch, path, token } = state.config;
  return owner && repo && branch && path && token;
}

function saveLocalEmails() {
  localStorage.setItem("auroraInbox.emailsCache", JSON.stringify({
    version: 1, updatedAt: nowIso(), emails: state.emails
  }));
}

function loadLocalEmails() {
  try {
    const raw = localStorage.getItem("auroraInbox.emailsCache");
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      state.emails = data;
    } else if (data && Array.isArray(data.emails)) {
      state.emails = data.emails;
    }
  } catch {}
}

async function githubGetFile() {
  const { owner, repo, path, branch, token } = state.config;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const json = await res.json();
  return {
    exists: true,
    sha: json.sha,
    content: decodeBase64(json.content || "")
  };
}

async function githubPutFile(contentText, message, existingSha = null) {
  const { owner, repo, path, branch, token } = state.config;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: encodeBase64(contentText),
    branch
  };
  if (existingSha) body.sha = existingSha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`GitHub PUT failed: ${res.status} ${errText}`);
  }
  const json = await res.json();
  return { content: json.content, commit: json.commit, sha: json.content?.sha };
}

async function fetchEmails() {
  loadLocalEmails(); // optimistic render
  renderInbox();

  if (!isConfigComplete()) return;

  try {
    const file = await githubGetFile();
    if (!file.exists) {
      state.emails = [];
      state.fileSha = null;
      saveLocalEmails();
      renderInbox();
      return;
    }
    const parsed = JSON.parse(file.content || "{}");
    const emails = Array.isArray(parsed) ? parsed : (parsed.emails || []);
    state.emails = emails;
    state.fileSha = file.sha;
    saveLocalEmails();
    renderInbox();
  } catch (e) {
    console.warn(e);
    showToast("Failed to fetch from GitHub (using cache)");
  }
}

function renderInbox() {
  const list = ui.inboxList;
  list.innerHTML = "";
  const emails = [...state.emails].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (!emails.length) {
    ui.emptyState.style.display = "block";
    return;
  }
  ui.emptyState.style.display = "none";

  for (const mail of emails) {
    const item = document.createElement("article");
    item.className = "mail";
    item.setAttribute("role", "listitem");
    item.tabIndex = 0;

    const unread = state.unreadLocal.has(mail.id);
    const title = document.createElement("h3");
    title.textContent = mail.title || "(Untitled)";
    if (unread) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "NEW";
      item.appendChild(badge);
    }

    const time = document.createElement("time");
    time.dateTime = mail.createdAt || "";
    time.textContent = niceDate(mail.createdAt || nowIso());

    const body = document.createElement("p");
    body.textContent = mail.body || "";

    item.appendChild(title);
    item.appendChild(time);
    item.appendChild(body);

    item.addEventListener("click", () => openMail(mail));
    item.addEventListener("keypress", (e) => { if (e.key === "Enter") openMail(mail); });

    list.appendChild(item);
  }
}

function openMail(mail) {
  state.unreadLocal.delete(mail.id);
  const dlg = document.createElement("dialog");
  dlg.className = "settings";
  dlg.innerHTML = `
    <form method="dialog" class="settings-content card">
      <header class="settings-header">
        <h2>${escapeHtml(mail.title || "(Untitled)")}</h2>
        <button class="icon-btn" value="close" aria-label="Close">✕</button>
      </header>
      <div class="settings-body">
        <p class="hint">${niceDate(mail.createdAt || nowIso())}</p>
        <div style="white-space: pre-wrap; color: var(--muted); margin-top: 10px;">${escapeHtml(mail.body || "")}</div>
      </div>
      <footer class="settings-footer">
        <button class="btn ghost" value="close">Close</button>
      </footer>
    </form>
  `;
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
  renderInbox();
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function clearCompose() {
  ui.composeForm.reset();
}

function generateId() {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${rnd}`;
}

async function handleSend(e) {
  e.preventDefault();
  const form = ui.composeForm;
  const title = form.title.value.trim();
  const body = form.body.value.trim();

  if (!title || !body) {
    showToast("Please fill in title and message");
    return;
  }
  const email = {
    id: generateId(),
    title,
    body,
    createdAt: nowIso()
  };

  // Update local first
  state.emails.push(email);
  saveLocalEmails();
  state.unreadLocal.add(email.id);
  renderInbox();

  if (!isConfigComplete()) {
    showToast("Saved locally. Configure GitHub in Settings to sync.");
    clearCompose();
    return;
  }

  // Prepare JSON
  const payload = {
    version: 1,
    updatedAt: nowIso(),
    emails: state.emails
  };
  const contentText = JSON.stringify(payload, null, 2);
  const commitMsg = `Add note: ${title.slice(0, 64)}`;

  try {
    // Ensure we use latest sha
    try {
      const file = await githubGetFile();
      if (file.exists) state.fileSha = file.sha;
    } catch {}

    const put = await githubPutFile(contentText, commitMsg, state.fileSha);
    state.fileSha = put.sha || state.fileSha;
    showToast("Sent and saved to GitHub ✓");
    clearCompose();
  } catch (err) {
    console.warn(err);
    showToast("Saved locally. GitHub sync failed.");
  }
}

function exportJson() {
  const payload = {
    version: 1,
    updatedAt: nowIso(),
    emails: state.emails
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "emails.json";
  a.click();
  URL.revokeObjectURL(url);
}

function bindUI() {
  // Tabs
  ui.tabs.compose.addEventListener("click", () => switchTab("compose"));
  ui.tabs.inbox.addEventListener("click", () => switchTab("inbox"));

  // Compose
  ui.composeForm.addEventListener("submit", handleSend);
  ui.clearForm.addEventListener("click", clearCompose);

  // Inbox
  ui.refreshInbox.addEventListener("click", fetchEmails);
  ui.exportJson.addEventListener("click", exportJson);

  // Settings
  ui.settings.open.addEventListener("click", () => ui.settings.dialog.showModal());
  ui.settings.save.addEventListener("click", (e) => {
    e.preventDefault();
    saveConfig();
    ui.settings.dialog.close();
    fetchEmails();
  });
  ui.settings.toggleToken.addEventListener("click", () => {
    const el = ui.settings.fields.token;
    el.type = el.type === "password" ? "text" : "password";
    ui.settings.toggleToken.textContent = el.type === "password" ? "Show" : "Hide";
  });

  // Keyboard close for dialog
  ui.settings.dialog.addEventListener("cancel", () => ui.settings.dialog.close());
}

function switchTab(which) {
  const tabs = ui.tabs;
  const panels = ui.panels;
  const entries = [["compose", tabs.compose, panels.compose], ["inbox", tabs.inbox, panels.inbox]];
  for (const [name, tab, panel] of entries) {
    const active = name === which;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    panel.classList.toggle("active", active);
  }
}

async function init() {
  loadConfig();
  bindUI();
  await fetchEmails();
}

init();