// Aurora Mailbox – PWA using GitHub Contents API as a cozy store ✨

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
  Accept: 'application/vnd.github+json',
  Authorization: `token ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

let magicToken = null; // lives in memory
let emails = []; // local cache (UI only)
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
const datePretty = (iso) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// Ensure path is URL-safe but preserves slashes
function encodedPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

// Token storage
function loadToken() {
  const remembered = localStorage.getItem('magicToken');
  if (remembered) return remembered;
  return null;
}
function saveToken(token, remember) {
  magicToken = token;
  if (remember) localStorage.setItem('magicToken', token);
}
function forgetToken() {
  magicToken = null;
  localStorage.removeItem('magicToken');
}

// GitHub Contents API: get file (always live, no-cache)
async function getEmailsFile() {
  const path = encodedPath(FILE_PATH);
  const baseUrl = `${GH_API}/repos/${OWNER}/${REPO}/contents/${path}`;
  const metaUrl = `${baseUrl}?ref=${encodeURIComponent(BRANCH)}&ts=${Date.now()}`;

  // Request the metadata/content blob first (provides file sha)
  const res = await fetch(metaUrl, {
    headers: API_HEADERS(magicToken),
    cache: 'no-store', // bypass HTTP cache entirely
  });

  if (res.status === 404) {
    currentSha = null;
    return { exists: false, emails: [] };
  }
  if (!res.ok) {
    const t = await res.text();
    throw buildHttpError(res.status, `Could not reach your constellation: ${res.status} ${t}`);
  }

  const json = await res.json();
  currentSha = json.sha || null;

  // Try to decode the base64 content
  let content = decode64(json.content || '');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Fallback: explicitly ask for raw with no-store + another cache buster
    const rawUrl = `${baseUrl}?ref=${encodeURIComponent(BRANCH)}&raw_ts=${Date.now()}`;
    const rawRes = await fetch(rawUrl, {
      headers: {
        ...API_HEADERS(magicToken),
        Accept: 'application/vnd.github.v3.raw',
      },
      cache: 'no-store',
    });
    if (rawRes.ok) {
      content = await rawRes.text();
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = null;
      }
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

// Helper to make Error with status
function buildHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// GitHub Contents API: put file
async function putEmailsFile(nextEmails, message = 'chore: add a magical letter 💌') {
  const path = encodedPath(FILE_PATH);
  const url = `${GH_API}/repos/${OWNER}/${REPO}/contents/${path}`;
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
    cache: 'no-store',
  });

  if (!res.ok) {
    const t = await res.text();
    throw buildHttpError(res.status, `The stars hesitated: ${res.status} ${t}`);
  }
  const json = await res.json();
  currentSha = json.content?.sha || currentSha;
  return json;
}

// Retry wrapper to handle race conditions (sha mismatch / 409)
async function tryPutEmails(computeNextFromLatest, message) {
  try {
    const latest = await getEmailsFile(); // always fresh
    const next = computeNextFromLatest(latest.emails || []);
    return await putEmailsFile(next, message);
  } catch (e) {
    // If failure may be due to SHA mismatch or fast updates, retry once
    if (e && (e.status === 409 || e.status === 422 || ('' + e.message).includes('sha'))) {
      const latest = await getEmailsFile();
      const next = computeNextFromLatest(latest.emails || []);
      return await putEmailsFile(next, `${message} (retry)`);
    }
    throw e;
  }
}

// UI wiring
function setupTabs() {
  const tabs = $$('.tab');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      $$('.panel').forEach((p) => p.classList.remove('active'));
      if (tab === 'compose') {
        $('#composePanel').classList.add('active');
      } else {
        $('#inboxPanel').classList.add('active');
        // Always re-fetch fresh when opening Inbox
        refreshInbox(true);
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
  } else {
    const list = [...emails].sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    const tpl = $('#cardTemplate');

    list.forEach((e, idx) => {
      const node = tpl.content.cloneNode(true);
      const card = $('.note-card', node);
      $('.note-title', node).textContent = e.title || '(Untitled)';
      $('.note-preview', node).textContent = (e.body || '').slice(0, 200);
      $('.date', node).textContent = datePretty(e.createdAt || new Date().toISOString());
      $('.read-btn', node).addEventListener('click', () => openReader(e));
      grid.appendChild(node);
      const hues = ['#ffd9f2', '#e3d5ff', '#caffff', '#ffe7c2'];
      const pick = hues[idx % hues.length];
      card.style.border = '1px solid rgba(255,255,255,0.35)';
      card.style.backgroundImage = `radial-gradient(220px 90px at 90% -10%, ${pick}55, transparent 60%)`;
    });
  }
}

async function refreshInbox(showLoading = false) {
  const status = $('#inboxStatus');
  if (showLoading) sparkleStatus(status, 'Calling friendly fireflies...');
  try {
    // Always live fetch
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
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

function closeReader() {
  const dlg = $('#readerModal');
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
  openedId = null;
}

function shareCurrent() {
  if (!openedId) return;
  const e = emails.find((x) => x.id === openedId);
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
    await tryPutEmails(
      (latest) => latest.filter((x) => x.id !== openedId),
      'chore: release a letter into the night 🌙'
    );
    await refreshInbox(true); // force live re-fetch
    closeReader();
    sparkleTrail();
    sparkleStatus(composeStatus, 'Letter released with grace 🌙');
  } catch (e) {
    alert('The stars murmured: ' + e.message);
  }
}

function sparkleTrail() {
  const btn = $('#sendBtn');
  if (!btn) return;
  const burst = document.createElement('span');
  burst.className = 'burst';
  burst.innerHTML = '✨';
  const rect = btn.getBoundingClientRect();
  burst.style.position = 'fixed';
  burst.style.left = `${rect.left + rect.width / 2}px`;
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
    id:
      crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2),
    title,
    body,
    createdAt: new Date().toISOString(),
  };

  try {
    await tryPutEmails(
      (latest) => {
        // Avoid duplicate id if we retried
        const exists = latest.some((x) => x.id === newEmail.id);
        return exists ? latest : [...latest, newEmail];
      },
      'chore: add a magical letter 💌'
    );
    await refreshInbox(true); // force live refresh so UI is always current
    sparkleStatus(status, 'Your letter is shining in the night sky ✨');
    sparkleTrail();
    $('#mailTitle').value = '';
    $('#mailBody').value = '';
    // switch to inbox
    $$('[data-tab]').forEach((b) => b.classList.remove('active'));
    $$('[data-tab="inbox"]')[0].classList.add('active');
    $$('.panel').forEach((p) => p.classList.remove('active'));
    $('#inboxPanel').classList.add('active');
  } catch (e) {
    if (String(e.message).includes('403')) {
      sparkleStatus(
        status,
        'Your Magic Key can read the stars but not write. Grant “Contents: Read and write” to your token and try again 💫',
        'error'
      );
    } else if (String(e.message).includes('404')) {
      sparkleStatus(
        status,
        'Could not find your constellation (repo or branch). Make sure it exists ✨',
        'error'
      );
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
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
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

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      // If there's an update already waiting when the page loads
      if (reg.waiting) {
        showUpdateModal(reg);
      }

      // Listen for new updates
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New update installed, waiting to activate
            showUpdateModal(reg);
          }
        });
      });

      // After we tell the waiting SW to activate, reload once controlled by it
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    })
    .catch(() => {});
}

function showUpdateModal(reg) {
  const dlg = $('#updateModal');
  if (!dlg) return;

  const close = () =>
    typeof dlg.close === 'function' ? dlg.close() : dlg.removeAttribute('open');
  const updateNow = () => {
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    close();
  };

  $('#updateNowBtn')?.addEventListener('click', updateNow, { once: true });
  $('#updateLaterBtn')?.addEventListener('click', close, { once: true });
  $('#closeUpdate')?.addEventListener('click', close, { once: true });

  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

// Init
window.addEventListener('DOMContentLoaded', () => {
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
    const remember = $('#rememberToggle').checked;
    if (!t) return;
    saveToken(t, remember);
    closeTokenModal();
    refreshInbox(true);
  });

  $('#sendBtn').addEventListener('click', onSend);
  $('#clearBtn').addEventListener('click', onClear);
  $('#refreshBtn').addEventListener('click', () => refreshInbox(true));
  $('#closeReader').addEventListener('click', closeReader);
  $('#shareBtn').addEventListener('click', shareCurrent);
  $('#deleteBtn').addEventListener('click', deleteCurrent);

  // Footer credit — shows a sweet note
  const credit = $('#creditLink');
  if (credit) {
    const showNote = () => alert('An S² Labs Product');
    credit.addEventListener('click', showNote);
    credit.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        showNote();
      }
    });
    credit.style.cursor = 'pointer';
  }

  // Live refresh when the app regains focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshInbox();
    }
  });

  // Preload inbox if token present (live)
  if (magicToken) refreshInbox(true);

  // Register service worker with "update available" flow
  setupUpdateFlow();
});