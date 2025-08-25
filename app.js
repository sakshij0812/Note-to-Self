// Aurora Inbox - Token-on-first-run build with magical token sheet and mobile-first actions

const CONFIG = {
  owner: "sakshij0812",  
  repo: "Note-to-Self-Data",
  branch: "main",
  path: "emails.json"
};

const STORAGE_KEYS = {
  token: "auroraInbox.token",
  cache: "auroraInbox.emailsCache"
};

const qs = (s, el = document) => el.querySelector(s);

const state = {
  emails: [],
  fileSha: null,
  token: null,
  unreadLocal: new Set()
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
  // compose / inbox
  composeForm: qs("#composeForm"),
  clearForm: qs("#clearForm"),
  refreshInbox: qs("#refreshInbox"),
  exportJson: qs("#exportJson"),
  inboxList: qs("#inboxList"),
  emptyState: qs("#emptyState"),
  repoBadge: qs("#repoBadge"),
  connDot: qs("#connDot"),
  toast: qs("#toast"),

  // mobile action bars
  composeActionBar: qs("#composeActionBar"),
  inboxActionBar: qs("#inboxActionBar"),
  sendMobile: qs("#sendMobile"),
  clearMobile: qs("#clearMobile"),
  refreshMobile: qs("#refreshMobile"),
  exportMobile: qs("#exportMobile"),

  // token UX
  changeToken: qs("#changeToken"),
  keyFab: qs("#keyFab"),
  tokenDialog: qs("#tokenDialog"),
  tokenForm: qs("#tokenForm"),
  tokenInput: qs("#tokenInput"),
  toggleToken: qs("#toggleToken"),
  pasteToken: qs("#pasteToken"),
  saveToken: qs("#saveToken"),
};

const encodeBase64 = (str) => btoa(unescape(encodeURIComponent(str)));
const decodeBase64 = (b64) => decodeURIComponent(escape(atob(b64)));
const nowIso = () => new Date().toISOString();
const niceDate = (iso) => new Date(iso).toLocaleString();

function showToast(msg, ms = 2200) {
  ui.toast.textContent = msg;
  ui.toast.classList.add("show");
  setTimeout(() => ui.toast.classList.remove("show"), ms);
}

// Local cache
function saveLocalEmails() {
  localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify({
    version: 1, updatedAt: nowIso(), emails: state.emails
  }));
}
function loadLocalEmails() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cache);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data)) state.emails = data;
    else if (data && Array.isArray(data.emails)) state.emails = data.emails;
  } catch {}
}

// Token handling
function getStoredToken() {
  try { return localStorage.getItem(STORAGE_KEYS.token) || null; } catch { return null; }
}
function setToken(token) {
  state.token = token;
  try { localStorage.setItem(STORAGE_KEYS.token, token); } catch {}
  document.body.dataset.ghToken = token ? "set" : "unset";
}
function clearToken() {
  state.token = null;
  try { localStorage.removeItem(STORAGE_KEYS.token); } catch {}
  document.body.dataset.ghToken = "unset";
}

async function ensureToken() {
  const existing = getStoredToken();
  if (existing) {
    setToken(existing);
    return true;
  }
  return new Promise((resolve) => {
    ui.tokenDialog.addEventListener("cancel", (e) => e.preventDefault());
    ui.tokenDialog.showModal?.() || ui.tokenDialog.setAttribute("open", "");
    ui.tokenInput.focus();

    const onSubmit = (e) => {
      e.preventDefault();
      const token = ui.tokenInput.value.trim();
      if (!token) return;
      setToken(token);
      ui.tokenDialog.close?.();
      ui.tokenDialog.removeAttribute("open");
      ui.tokenForm.removeEventListener("submit", onSubmit);
      showToast("Secret saved ✨");
      resolve(true);
    };
    ui.tokenForm.addEventListener("submit", onSubmit);
  });
}

// GitHub API
async function githubGetFile() {
  const { owner, repo, path, branch } = CONFIG;
  if (!state.token) throw new Error("Missing token");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${state.token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const json = await res.json();
  return { exists: true, sha: json.sha, content: decodeBase64(json.content || "") };
}

async function githubPutFile(contentText, message, existingSha = null) {
  const { owner, repo, path, branch } = CONFIG;
  if (!state.token) throw new Error("Missing token");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = { message, content: encodeBase64(contentText), branch };
  if (existingSha) body.sha = existingSha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${state.token}`,
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

// Data flow
async function fetchEmails() {
  loadLocalEmails();
  renderInbox();

  ui.repoBadge.textContent = `${CONFIG.owner}/${CONFIG.repo} • ${CONFIG.branch}`;
  ui.connDot.style.background = "#b86fff";

  if (!state.token) {
    ui.connDot.style.background = "#ffcc66";
    return;
  }

  try {
    const file = await githubGetFile();
    if (!file.exists) {
      state.emails = [];
      state.fileSha = null;
      saveLocalEmails();
      renderInbox();
      ui.connDot.style.background = "#ffcc66";
      return;
    }
    const parsed = JSON.parse(file.content || "{}");
    const emails = Array.isArray(parsed) ? parsed : (parsed.emails || []);
    state.emails = emails;
    state.fileSha = file.sha;
    saveLocalEmails();
    renderInbox();
    ui.connDot.style.background = "#7dffb3";
  } catch (e) {
    console.warn(e);
    ui.connDot.style.background = "#ff8888";
    showToast("Failed to fetch from GitHub (using cache)");
  }
}

function renderInbox() {
  const list = ui.inboxList;
  list.innerHTML = "";
  const emails = [...state.emails].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (!emails.length) { ui.emptyState.style.display = "block"; return; }
  ui.emptyState.style.display = "none";

  for (const mail of emails) {
    const item = document.createElement("article");
    item.className = "mail";
    item.setAttribute("role", "listitem");
    item.tabIndex = 0;

    if (state.unreadLocal.has(mail.id)) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "NEW";
      item.appendChild(badge);
    }

    const title = document.createElement("h3");
    title.textContent = mail.title || "(Untitled)";
    const time = document.createElement("time");
    time.dateTime = mail.createdAt || "";
    time.textContent = niceDate(mail.createdAt || nowIso());
    const body = document.createElement("p");
    body.textContent = mail.body || "";

    item.appendChild(title); item.appendChild(time); item.appendChild(body);
    item.addEventListener("click", () => openMail(mail));
    item.addEventListener("keypress", (e) => { if (e.key === "Enter") openMail(mail); });
    list.appendChild(item);
  }
}

function openMail(mail) {
  state.unreadLocal.delete(mail.id);
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.innerHTML = `
    <form method="dialog" class="sheet-content card sheet-aurora">
      <header class="sheet-header">
        <div class="sparkles">✨</div>
        <h2>${escapeHtml(mail.title || "(Untitled)")}</h2>
        <p class="sheet-subtitle">${niceDate(mail.createdAt || nowIso())}</p>
      </header>
      <div class="sheet-body">
        <div style="white-space: pre-wrap; color: var(--muted); margin-top: 10px;">${escapeHtml(mail.body || "")}</div>
      </div>
      <footer class="sheet-footer sticky">
        <button class="btn ghost" value="close">Close</button>
      </footer>
    </form>
  `;
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal?.() || dlg.setAttribute("open", "");
  renderInbox();
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function clearCompose() { ui.composeForm.reset(); }

function generateId() {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${rnd}`;
}

async function handleSend(e) {
  e?.preventDefault?.();
  const form = ui.composeForm;
  const title = form.title.value.trim();
  const body = form.body.value.trim();

  if (!title || !body) { showToast("Please fill in title and message"); return; }

  const email = { id: generateId(), title, body, createdAt: nowIso() };

  state.emails.push(email);
  saveLocalEmails();
  state.unreadLocal.add(email.id);
  renderInbox();

  if (!state.token) {
    showToast("Saved locally. Add your secret to sync ✨");
    ui.tokenDialog.showModal?.() || ui.tokenDialog.setAttribute("open", "");
    return;
  }

  const payload = { version: 1, updatedAt: nowIso(), emails: state.emails };
  const contentText = JSON.stringify(payload, null, 2);
  const commitMsg = `Add note: ${title.slice(0, 64)}`;

  try {
    try {
      const file = await githubGetFile();
      state.fileSha = file.exists ? file.sha : null;
    } catch {}
    const put = await githubPutFile(contentText, commitMsg, state.fileSha);
    state.fileSha = put.sha || state.fileSha;
    showToast("Sent and saved to GitHub ✓");
    clearCompose();
    ui.connDot.style.background = "#7dffb3";
  } catch (err) {
    console.warn(err);
    showToast("Saved locally. GitHub sync failed.");
    ui.connDot.style.background = "#ff8888";
  }
}

function exportJson() {
  const payload = { version: 1, updatedAt: nowIso(), emails: state.emails };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "emails.json"; a.click();
  URL.revokeObjectURL(url);
}

function bindUI() {
  // Tabs
  ui.tabs.compose.addEventListener("click", () => switchTab("compose"));
  ui.tabs.inbox.addEventListener("click", () => switchTab("inbox"));

  // Compose
  ui.composeForm.addEventListener("submit", handleSend);
  ui.clearForm?.addEventListener("click", clearCompose);

  // Inbox
  ui.refreshInbox?.addEventListener("click", fetchEmails);
  ui.exportJson?.addEventListener("click", exportJson);

  // Mobile bars
  ui.sendMobile.addEventListener("click", handleSend);
  ui.clearMobile.addEventListener("click", clearCompose);
  ui.refreshMobile.addEventListener("click", fetchEmails);
  ui.exportMobile.addEventListener("click", exportJson);

  // Token dialog controls
  ui.toggleToken.addEventListener("click", () => {
    const el = ui.tokenInput;
    el.type = el.type === "password" ? "text" : "password";
    ui.toggleToken.textContent = el.type === "password" ? "Reveal" : "Hide";
  });
  ui.pasteToken.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { ui.tokenInput.value = text.trim(); showToast("Pasted ✨"); }
    } catch { showToast("Clipboard not available"); }
  });
  ui.changeToken.addEventListener("click", () => {
    ui.tokenInput.value = "";
    clearToken();
    ui.tokenDialog.showModal?.() || ui.tokenDialog.setAttribute("open", "");
  });
  ui.keyFab.addEventListener("click", () => {
    ui.tokenInput.value = getStoredToken() || "";
    ui.tokenDialog.showModal?.() || ui.tokenDialog.setAttribute("open", "");
    ui.tokenInput.focus();
  });
}

function switchTab(which) {
  const entries = [
    ["compose", ui.tabs.compose, ui.panels.compose, ui.composeActionBar],
    ["inbox", ui.tabs.inbox, ui.panels.inbox, ui.inboxActionBar]
  ];
  for (const [name, tab, panel, bar] of entries) {
    const active = name === which;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    panel.classList.toggle("active", active);
    // Toggle relevant mobile bar
    if (window.matchMedia("(min-width: 980px)").matches) {
      bar.style.display = "none";
    } else {
      bar.style.display = active ? "flex" : "none";
    }
  }
}

async function init() {
  ui.repoBadge.textContent = `${CONFIG.owner}/${CONFIG.repo} • ${CONFIG.branch}`;
  bindUI();
  // Default to compose view with correct mobile bar visibility
  switchTab("compose");
  await ensureToken();
  await fetchEmails();
}

init();