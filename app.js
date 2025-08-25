// Hardcoded constellation (change in code if you like)
/* Ensure the repo exists and your token has:
   - Repository permissions → Contents: Read and write
*/
const OWNER = 'sakshij0812';
const REPO = 'Note-to-Self-Data';
const BRANCH = 'main';
const FILE_PATH = 'data/emails.json';

const GH_API = 'https://api.github.com';
const API_HEADERS = (token) => ({
  'Accept': 'application/vnd.github+json',
  'Authorization': `token ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

let magicToken = null; // lives in memory
let emails = []; // local cache
let currentSha = null; // sha of the JSON file (if exists)
let openedId = null; // track by id instead of index for safety

// Helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const encode64 = (str) => btoa(unescape(encodeURIComponent(str)));
const decode64 = (b64) => {
  try {
    const clean = String(b64 || '').replace(/\r?\n/g, '');
    return decodeURIComponent(escape(atob(clean)));
  } catch {
    return '';
  }
};
const datePretty = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// Token storage
function loadToken() {
  const remembered = localStorage.getItem('magicToken');
  if (remembered) return remembered;
  return null;
}
function saveToken(token) {
  magicToken = token;
  try { localStorage.setItem('magicToken', token); } catch {}
}
function forgetToken() {
  magicToken = null;
  localStorage.removeItem('magicToken');
}

// GitHub Contents API: get file
async function getEmailsFile() {
  const url = `${GH_API}/repos/${OWNER}/${REPO}/contents/${encodeURI(FILE_PATH)}?ref=${encodeURIComponent(BRANCH)}`;
  const res = await fetch(url, { headers: API_HEADERS(magicToken) });
  if (res.status === 404) {
    currentSha = null;
    return { exists: false, emails: [] };
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Could not reach your constellation: ${res.status} ${t}`);
  }

  // Try metadata + base64 first (gives us sha)
  const json = await res.json();
  currentSha = json.sha || null;
  let content = decode64(json.content || '');

  // If parsing fails, try raw media type as a fallback
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const rawRes = await fetch(url, {
      headers: { ...API_HEADERS(magicToken), Accept: 'application/vnd.github.v3.raw' }
    });
    if (rawRes.ok) {
      content = await rawRes.text();
      try { parsed = JSON.parse(content); } catch { parsed = null; }
    }
  }

  if (Array.isArray(parsed)) {
    return { exists: true, emails: parsed };
  }
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.emails)) return { exists: true, emails: parsed.emails };
    // Support object maps {id: email, ...}
    return { exists: true, emails: Object.values(parsed) };
  }
  return { exists: true, emails: [] };
}

// GitHub Contents API: put file
async function putEmailsFile(nextEmails, message = 'chore: add a magical letter 💌') {
  const url = `${GH_API}/repos/${OWNER}/${REPO}/contents/${encodeURI(FILE_PATH)}`;
  const body = {
    message,
    content: encode64(JSON.stringify(nextEmails, null, 2)),
    branch: BRANCH,
  };
  if (currentSha) body.sha = currentSha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...API_HEADERS(magicToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`The stars hesitated: ${res.status} ${t}`);
  }
  const json = await res.json();
  currentSha = json.content?.sha || currentSha;
  return json;
}

// UI wiring
function setupTabs() {
  const tabs = $$('.tab');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      $$('.panel').forEach(p => p.classList.remove('active'));
      if (tab === 'compose') {
        $('#composePanel').classList.add('active');
      } else {
        $('#inboxPanel').classList.add('active');
        refreshInbox();
      }
    });
  });
}

function sparkleStatus(el, msg, kind = 'info') {
  el.textContent = msg;
  el.style.color = kind === 'error' ? '#ffb8c8' : '#ffd7ff';
}

function renderInbox() {
  const grid = $('#inboxGrid');
  grid.innerHTML = '';
  if (!emails.length) {
    grid.innerHTML = `
      <div class="card glass" style="padding:16px; text-align:center;">
        <p>No letters yet. Your sky awaits its first sparkle 💖</p>
      </div>`;
    return;
  }
  // Show most recent first
  const list = [...emails].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const tpl = $('#cardTemplate');

  list.forEach((e, idx) => {
    const node = tpl.content.cloneNode(true);
    const card = $('.note-card', node);
    $('.note-title', node).textContent = e.title || '(Untitled)';
    $('.note-preview', node).textContent = (e.body || '').slice(0, 200);
    $('.date', node).textContent = datePretty(e.createdAt || new Date().toISOString());
    $('.read-btn', node).addEventListener('click', () => openReader(e));
    grid.appendChild(node);
    // sprinkle pastel accents
    const hues = ['#ffd9f2', '#e3d5ff', '#caffff', '#ffe7c2'];
    const pick = hues[idx % hues.length];
    card.style.border = '1px solid rgba(255,255,255,0.35)';
    card.style.backgroundImage = `radial-gradient(220px 90px at 90% -10%, ${pick}55, transparent 60%)`;
  });
}

async function refreshInbox() {
  const status = $('#inboxStatus');
  sparkleStatus(status, 'Calling friendly fireflies...');
  try {
    const res = await getEmailsFile();
    emails = res.emails;
    sparkleStatus(status, `Fetched ${emails.length} letters ✨`);
    renderInbox();
  } catch (e) {
    sparkleStatus(status, e.message, 'error');
  }
}

function openReader(email) {
  openedId = email.id || null;
  $('#readerTitle').textContent = email.title || '(Untitled)';
  $('#readerBody').textContent = email.body || '';
  const dlg = $('#readerModal');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}

function closeReader() {
  const dlg = $('#readerModal');
  if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  openedId = null;
}

function shareCurrent() {
  if (!openedId) return;
  const e = emails.find(x => x.id === openedId);
  if (!e) return;
  const text = `💌 ${e.title}\n\n${e.body}`;
  if (navigator.share) {
    navigator.share({ title: e.title || 'Aurora Mail', text });
  } else {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard ✨');
  }
}

async function deleteCurrent() {
  if (!openedId) return;
  if (!confirm('Gently release this letter into the night?')) return;
  const composeStatus = $('#composeStatus');
  try {
    const res = await getEmailsFile();
    const list = res.emails;
    const after = list.filter(x => x.id !== openedId);
    await putEmailsFile(after, 'chore: release a letter into the night 🌙');
    emails = after;
    renderInbox();
    closeReader();
    sparkleTrail();
    sparkleStatus(composeStatus, 'Letter released with grace 🌙');
  } catch (e) {
    alert('The stars murmured: ' + e.message);
  }
}

function sparkleTrail() {
  // Tiny ephemeral sparkle effect near the send button
  const btn = $('#sendBtn');
  if (!btn) return;
  const burst = document.createElement('span');
  burst.className = 'burst';
  burst.innerHTML = '✨';
  const rect = btn.getBoundingClientRect();
  burst.style.position = 'fixed';
  burst.style.left = `${rect.left + rect.width/2}px`;
  burst.style.top = `${rect.top}px`;
  burst.style.pointerEvents = 'none';
  burst.style.animation = 'burst 800ms ease forwards';
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 900);
}
const style = document.createElement('style');
style.textContent = `
@keyframes burst { from { transform: translate(-50%, -10px) scale(0.8); opacity: 0 } 30% { opacity:1 } to { transform: translate(-50%, -60px) scale(1.2); opacity: 0 } }
`;
document.head.appendChild(style);

// Compose actions
async function onSend() {
  const title = $('#mailTitle').value.trim();
  const body = $('#mailBody').value.trim();
  const status = $('#composeStatus');
  if (!title && !body) {
    sparkleStatus(status, 'Write a little something lovely first ✨', 'error');
    return;
  }
  if (!magicToken) {
    openTokenModal(true);
    sparkleStatus(status, 'We need your Magic Key to send this note ✨', 'error');
    return;
  }
  $('#sendBtn').disabled = true;
  sparkleStatus(status, 'Sending with stardust…');

  const newEmail = {
    id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
    title,
    body,
    createdAt: new Date().toISOString(),
  };

  try {
    const res = await getEmailsFile();
    const next = [...res.emails, newEmail];
    await putEmailsFile(next, 'chore: add a magical letter 💌');
    emails = next;
    renderInbox();
    sparkleStatus(status, 'Your letter is shining in the night sky ✨');
    sparkleTrail();
    $('#mailTitle').value = '';
    $('#mailBody').value = '';
    // switch to inbox
    $$('[data-tab]').forEach(b => b.classList.remove('active'));
    $$('[data-tab="inbox"]')[0].classList.add('active');
    $$('.panel').forEach(p => p.classList.remove('active'));
    $('#inboxPanel').classList.add('active');
  } catch (e) {
    if (String(e.message).includes('403')) {
      sparkleStatus(status, 'Your Magic Key can read the stars but not write. Grant “Contents: Read and write” to your token and try again 💫', 'error');
    } else if (String(e.message).includes('404')) {
      sparkleStatus(status, 'Could not find your constellation (repo or branch). Make sure it exists ✨', 'error');
    } else {
      sparkleStatus(status, e.message, 'error');
    }
  } finally {
    $('#sendBtn').disabled = false;
  }
}

function onClear() {
  $('#mailTitle').value = '';
  $('#mailBody').value = '';
  $('#composeStatus').textContent = '';
}

// Token modal
function openTokenModal(force = false) {
  const dlg = $('#tokenModal');
  if (force || !magicToken) {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
}
function closeTokenModal() {
  const dlg = $('#tokenModal');
  if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
}

function setupSettings() {
  $('#settingsBtn').addEventListener('click', () => {
    $('#settingsModal').showModal();
  });
  $('#closeSettings').addEventListener('click', () => {
    $('#settingsModal').close();
  });
  $('#reenterTokenBtn').addEventListener('click', () => {
    $('#settingsModal').close();
    openTokenModal(true);
  });
  $('#forgetTokenBtn').addEventListener('click', () => {
    if (confirm('Forget your Magic Key on this device?')) {
      forgetToken();
      alert('Magic Key forgotten. You’ll be asked again next time ✨');
    }
  });
}

// Update flow (show a magical popup when a new version is available)
function setupUpdateFlow() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting) {
      showUpdateModal(reg);
    }
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateModal(reg);
        }
      });
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }).catch(() => {});
}

function showUpdateModal(reg) {
  const dlg = $('#updateModal');
  if (!dlg) return;

  const close = () => (typeof dlg.close === 'function' ? dlg.close() : dlg.removeAttribute('open'));
  const updateNow = () => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    close();
  };

  $('#updateNowBtn').onclick = updateNow;
  $('#updateLaterBtn').onclick = close;
  $('#closeUpdate').onclick = close;

  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

// Init
window.addEventListener('DOMContentLoaded', () => {
  // Gentle 1s loader fade
  const loader = $('#loadingScreen');
  setTimeout(() => loader?.classList.add('hide'), 1000);

  // Token
  const remembered = loadToken();
  if (remembered) magicToken = remembered;
  else openTokenModal(false);

  // Events
  setupTabs();
  setupSettings();

  $('#saveTokenBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const t = $('#tokenInput').value.trim();
    if (!t) return;
    saveToken(t); // Always persist to localStorage
    closeTokenModal();
    refreshInbox();
  });

  $('#sendBtn').addEventListener('click', onSend);
  $('#clearBtn').addEventListener('click', onClear);
  $('#refreshBtn').addEventListener('click', refreshInbox);
  $('#closeReader').addEventListener('click', closeReader);
  $('#shareBtn').addEventListener('click', shareCurrent);
  $('#deleteBtn').addEventListener('click', deleteCurrent);

  // Footer credit — flip to reveal note
  const credit = $('#creditLink');
  if (credit) {
    const flipOnce = () => {
      credit.classList.add('flipped');
      credit.setAttribute('aria-pressed', 'true');
      setTimeout(() => {
        credit.classList.remove('flipped');
        credit.setAttribute('aria-pressed', 'false');
      }, 2400);
    };
    credit.addEventListener('click', flipOnce);
    credit.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flipOnce(); }
    });
  }

  // Register service worker with "update available" flow
  setupUpdateFlow();
});