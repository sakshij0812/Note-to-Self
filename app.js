// Aurora Inbox - fully redesigned UI, same functionality
// Mobile & iPad-first, Aurora aesthetic, magical dialogs, update banner, footer flip.
//
// Configure your repository here. Token is asked on first run and stored locally.
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

// Shortcuts
const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => [...el.querySelectorAll(s)];

// State
const state = {
  emails: [],
  fileSha: null,
  token: null,
  unreadLocal: new Set()
};

// UI refs
const ui = {
  // tabs
  composeTab: qs("#composeTab"),
  inboxTab: qs("#inboxTab"),
  composePanel: qs("#composePanel"),
  inboxPanel: qs("#inboxPanel"),

  // forms
  composeForm: qs("#composeForm"),
  clearForm: qs("#clearForm"),

  // inbox
  inboxList: qs("#inboxList"),
  emptyState: qs("#emptyState"),
  refreshInbox: qs("#refreshInbox"),
  exportJson: qs("#exportJson"),

  // mobile bars
  composeBar: qs("#composeActionBar"),
  inboxBar: qs("#inboxActionBar"),
  sendMobile: qs("#sendMobile"),
  clearMobile: qs("#clearMobile"),
  refreshMobile: qs("#refreshMobile"),
  exportMobile: qs("#exportMobile"),

  // header indicators
  repoBadge: qs("#repoBadge"),
  connDot: qs("#connDot"),
  changeToken: qs("#changeToken"),
  keyFab: qs("#keyFab"),

  // token dialog
  tokenDialog: qs("#tokenDialog"),
  tokenForm: qs("#tokenForm"),
  tokenInput: qs("#tokenInput"),
  pasteToken: qs("#pasteToken"),
  toggleToken: qs("#toggleToken"),
  saveToken: qs("#saveToken"),

  // update banner
  updateBanner: qs("#updateBanner"),
  updateNow: qs("#updateNow"),
  updateLater: qs("#updateLater"),

  // footer
  footerFlip: qs("#footerFlip"),

  // toast
  toast: qs("#toast"),
};

// Utilities
const nowIso = () => new Date().toISOString();
const niceDate = (iso) => new Date(iso).toLocaleString();

// Robust base64 utils for unicode
const enc = new TextEncoder();
const dec = new TextDecoder();
const encodeBase64 = (str) => btoa(String.fromCharCode(...enc.encode(str)));
const decodeBase64 = (b64) => dec.decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));

function toast(msg, ms = 2200) {
  ui.toast.textContent = msg;
  ui.toast.classList.add("show");
  setTimeout(() => ui.toast.classList.remove("show"), ms);
}

// Local cache
function saveLocal() {
  localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify({ version: 1, updatedAt: nowIso(), emails: state.emails }));
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cache);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data)) state.emails = data;
    else if (data && Array.isArray(data.emails)) state.emails = data.emails;
  } catch {}
}

// Token handling
function getStoredToken() { try { return localStorage.getItem(STORAGE_KEYS.token) || null; } catch { return null; } }
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
  const t = getStoredToken();
  if (t) { setToken(t); return true; }
  return new Promise((resolve) => {
    ui.tokenDialog.addEventListener("cancel", (e) => e.preventDefault(), { once: true });
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
      toast("Secret saved ✨");
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
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.token}`,
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
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.token}`,
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

// Data
async function fetchEmails() {
  loadLocal();
  renderInbox();
  ui.repoBadge.textContent = `${CONFIG.owner}/${CONFIG.repo} • ${CONFIG.branch}`;
  ui.connDot.style.background = "#b86fff";

  if (!state.token) { ui.connDot.style.background = "#ffcc66"; return; }

  try {
    const file = await githubGetFile();
    if (!file.exists) {
      state.emails = [];
      state.fileSha = null;
      saveLocal();
      renderInbox();
      ui.connDot.style.background = "#ffcc66";
      return;
    }
    const parsed = JSON.parse(file.content || "{}");
    const emails = Array.isArray(parsed) ? parsed : (parsed.emails || []);
    state.emails = emails;
    state.fileSha = file.sha;
    saveLocal();
    renderInbox();
    ui.connDot.style.background = "#7dffb3";
  } catch (e) {
    console.warn(e);
    ui.connDot.style.background = "#ff8888";
    toast("Failed to fetch from GitHub (using cache)");
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

    const h3 = document.createElement("h3");
    h3.textContent = mail.title || "(Untitled)";
    const time = document.createElement("time");
    time.dateTime = mail.createdAt || "";
    time.textContent = niceDate(mail.createdAt || nowIso());
    const body = document.createElement("p");
    body.textContent = mail.body || "";

    item.append(h3, time, body);
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
    <form method="dialog" class="sheet-body">
      <div class="sheet-aurora"></div>
      <div class="sheet-content">
        <div class="stars">✦ ✧ ✦</div>
        <h2>${escapeHtml(mail.title || "(Untitled)")}</h2>
        <p class="sub">${niceDate(mail.createdAt || nowIso())}</p>
        <div style="white-space: pre-wrap; color: var(--muted); margin-top: 6px;">${escapeHtml(mail.body || "")}</div>
        <div class="sheet-actions">
          <button class="btn ghost" value="close">Close</button>
        </div>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal?.() || dlg.setAttribute("open", "");
  renderInbox();
}

function escapeHtml(str){return (str||"").replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[s]))}

function clearCompose(){ ui.composeForm.reset(); }

function genId(){ return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }

async function handleSend(e){
  e?.preventDefault?.();
  const title = ui.composeForm.title.value.trim();
  const body = ui.composeForm.body.value.trim();
  if(!title || !body){ toast("Please fill in title and message"); return; }

  const email = { id: genId(), title, body, createdAt: nowIso() };
  state.emails.push(email);
  saveLocal();
  state.unreadLocal.add(email.id);
  renderInbox();

  if(!state.token){
    toast("Saved locally. Add your secret to sync ✨");
    ui.tokenDialog.showModal?.() || ui.tokenDialog.setAttribute("open",""); 
    return;
  }

  const payload = { version:1, updatedAt: nowIso(), emails: state.emails };
  const contentText = JSON.stringify(payload, null, 2);
  const msg = `Add note: ${title.slice(0,64)}`;

  try{
    try{ const file = await githubGetFile(); state.fileSha = file.exists ? file.sha : null; }catch{}
    const put = await githubPutFile(contentText, msg, state.fileSha);
    state.fileSha = put.sha || state.fileSha;
    toast("Sent and saved to GitHub ✓");
    clearCompose();
    ui.connDot.style.background = "#7dffb3";
  }catch(err){
    console.warn(err);
    toast("Saved locally. GitHub sync failed.");
    ui.connDot.style.background = "#ff8888";
  }
}

function exportJson(){
  const payload = { version:1, updatedAt: nowIso(), emails: state.emails };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "emails.json"; a.click(); URL.revokeObjectURL(url);
}

// Service worker update prompt
function setupUpdateBanner(){
  if(!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());

  window.addEventListener("load", async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if(!reg) return;

    const show = () => { ui.updateBanner.hidden = false; requestAnimationFrame(()=> ui.updateBanner.classList.add("show")); };
    const hide = () => { ui.updateBanner.classList.remove("show"); setTimeout(()=> ui.updateBanner.hidden = true, 200); };
    const prompt = () => {
      if(!reg.waiting) return;
      show();
      ui.updateNow.onclick = () => { ui.updateNow.disabled = true; ui.updateNow.textContent = "Updating…"; reg.waiting.postMessage({type:"SKIP_WAITING"}); };
      ui.updateLater.onclick = () => hide();
    };

    if(reg.waiting) prompt();
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if(!sw) return;
      sw.addEventListener("statechange", ()=> {
        if(sw.state === "installed" && navigator.serviceWorker.controller) prompt();
      });
    });

    setInterval(()=> reg.update(), 30*60*1000);
    document.addEventListener("visibilitychange", ()=> { if(document.visibilityState === "visible") reg.update(); });
  });
}

// Bind UI
function bind(){
  // Tabs
  ui.composeTab.addEventListener("click", ()=> switchTab("compose"));
  ui.inboxTab.addEventListener("click", ()=> switchTab("inbox"));

  // Compose
  ui.composeForm.addEventListener("submit", handleSend);
  ui.clearForm?.addEventListener("click", clearCompose);

  // Inbox
  ui.refreshInbox?.addEventListener("click", fetchEmails);
  ui.exportJson?.addEventListener("click", exportJson);

  // Mobile actions
  ui.sendMobile.addEventListener("click", handleSend);
  ui.clearMobile.addEventListener("click", clearCompose);
  ui.refreshMobile.addEventListener("click", fetchEmails);
  ui.exportMobile.addEventListener("click", exportJson);

  // Token helpers
  ui.toggleToken.addEventListener("click", ()=>{
    const el = ui.tokenInput;
    el.type = el.type === "password" ? "text" : "password";
    ui.toggleToken.textContent = el.type === "password" ? "Reveal" : "Hide";
  });
  ui.pasteToken.addEventListener("click", async ()=>{
    try{ const t = await navigator.clipboard.readText(); if(t){ ui.tokenInput.value = t.trim(); toast("Pasted ✨"); } }
    catch{ toast("Clipboard not available"); }
  });
  ui.changeToken.addEventListener("click", ()=>{
    ui.tokenInput.value = "";
    clearToken();
    ui.tokenDialog.showModal?.() || ui.tokenDialog.setAttribute("open","");
  });
  ui.keyFab.addEventListener("click", ()=>{
    ui.tokenInput.value = getStoredToken() || "";
    ui.tokenDialog.showModal?.() || ui.tokenDialog.setAttribute("open","");
    ui.tokenInput.focus();
  });

  // Footer flip
  ui.footerFlip?.addEventListener("click", ()=>{
    const flipped = ui.footerFlip.classList.toggle("flipped");
    ui.footerFlip.setAttribute("aria-pressed", String(flipped));
    if(navigator.vibrate) try{ navigator.vibrate(10); }catch{}
  });

  setupUpdateBanner();
}

function switchTab(which){
  const entries = [
    ["compose", ui.composeTab, ui.composePanel, ui.composeBar],
    ["inbox", ui.inboxTab, ui.inboxPanel, ui.inboxBar]
  ];
  for(const [name, tab, panel, bar] of entries){
    const active = name === which;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    panel.classList.toggle("active", active);
    if(window.matchMedia("(min-width: 960px)").matches) bar.style.display = "none";
    else bar.style.display = active ? "flex" : "none";
  }
}

// Init
async function init(){
  ui.repoBadge.textContent = `${CONFIG.owner}/${CONFIG.repo} • ${CONFIG.branch}`;
  bind();
  switchTab("compose");
  await ensureToken();
  await fetchEmails();
}

init();