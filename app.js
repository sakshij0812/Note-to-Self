const OWNER = 'sakshij0812';
const REPO = 'Note-to-Self-Data';
const BRANCH = 'main';
const FILE_PATH = 'data/emails.json';
const IMAGES_DIR = 'data/images';

const GH_API = 'https://api.github.com';
const API_HEADERS = (token) => ({
  'Accept': 'application/vnd.github+json',
  'Authorization': `token ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

let magicToken = null;
let displayName = null;
let emails = [];
let currentSha = null;
let openedId = null;
let selectedImages = [];

// Calendar constraints: start Sep 2025, do not go back before it
const MIN_CAL_YEAR = 2025;
const MIN_CAL_MONTH = 8; // 0-based (September)
const MIN_CAL_DATE = new Date(MIN_CAL_YEAR, MIN_CAL_MONTH, 1);

// Calendar state
let calYear = MIN_CAL_YEAR;
let calMonth = MIN_CAL_MONTH;
let activeFilterDateKey = null; // 'YYYY-MM-DD'
let calendarOpen = false;

// Helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const encode64 = (str) => btoa(unescape(encodeURIComponent(str)));
const decode64 = (b64) => {
  try {
    const clean = String(b64 || '').replace(/\r?\n/g, '');
    return decodeURIComponent(escape(atob(clean)));
  } catch { return ''; }
};
const datePretty = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const rawUrl = (path) => `https://raw.githubusercontent.com/${OWNER}/${REPO}/${encodeURIComponent(BRANCH)}/${path.split('/').map(encodeURIComponent).join('/')}`;

function pad2(n){ return String(n).padStart(2, '0'); }
function dateKeyFromDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function dateKeyFromISO(iso){ return dateKeyFromDate(new Date(iso)); }
function addDays(d, n){ const nd = new Date(d); nd.setDate(nd.getDate()+n); return nd; }
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isBeforeMinMonth(y,m){ return y < MIN_CAL_YEAR || (y===MIN_CAL_YEAR && m < MIN_CAL_MONTH); }
function clampToMinMonth(date){
  if (isBeforeMinMonth(date.getFullYear(), date.getMonth())) return new Date(MIN_CAL_YEAR, MIN_CAL_MONTH, 1);
  return date;
}

// Token + name storage
function loadToken(){ return localStorage.getItem('magicToken') || null; }
function saveToken(token){ magicToken = token; try{ localStorage.setItem('magicToken', token);}catch{} }
function forgetToken(){ magicToken = null; localStorage.removeItem('magicToken'); }
function loadName(){ return localStorage.getItem('displayName') || null; }
function saveName(name){ displayName = name; try{ localStorage.setItem('displayName', name);}catch{} }
function forgetName(){ displayName = null; localStorage.removeItem('displayName'); }

// Greetings
function getRandomGreeting(name){
  const n = (name && name.trim()) ? name.trim() : 'Friend';
  const list = [
    `Hi, ${n}! Ready to write a love note?`,
    `Hey ${n}, shall we bottle a thought?`,
    `Welcome back, ${n} — let’s sprinkle stardust on your words.`,
    `${n}, your sky is listening.`,
    `Hello ${n}! A tiny sparkle of honesty today?`,
    `Dear ${n}, write gently. You matter.`,
    `✨ ${n}, what’s shimmering in your heart?`,
    `Hey ${n} — one breath, one line.`,
    `${n}, your story glows brighter than auroras.`,
    `Warm hello, ${n}. Let’s keep it soft.`,
    `${n}, a little love note to self?`,
    `Shine on, ${n}. Put it in words.`,
    `Psst, ${n} — your inner voice wants the mic.`,
    `Welcome, ${n}. What would kindness say?`,
    `${n}, leave a trail of gentle truth.`,
    `Time to exhale onto the page, ${n}.`,
    `Sweet ${n}, write what you needed to hear.`,
    `${n}, every word is a firefly.`,
    `Hello again, ${n}. Your feelings are valid.`,
    `${n}, small steps, soft light, true words.`
  ];
  return list[Math.floor(Math.random()*list.length)];
}
function updateGreeting(){ $('#greetingTitle').textContent = getRandomGreeting(displayName); }

// GitHub: get/put
async function getEmailsFile(){
  const url = `${GH_API}/repos/${OWNER}/${REPO}/contents/${encodeURI(FILE_PATH)}?ref=${encodeURIComponent(BRANCH)}`;
  const res = await fetch(url, { headers: API_HEADERS(magicToken) });
  if (res.status === 404){ currentSha = null; return { exists:false, emails:[] }; }
  if (!res.ok){ const t = await res.text(); throw new Error(`Could not reach your constellation: ${res.status} ${t}`); }
  const json = await res.json();
  currentSha = json.sha || null;
  let content = decode64(json.content || '');

  let parsed;
  try { parsed = JSON.parse(content); }
  catch {
    const rawRes = await fetch(url, { headers:{ ...API_HEADERS(magicToken), Accept:'application/vnd.github.v3.raw' }});
    if (rawRes.ok){
      content = await rawRes.text();
      try { parsed = JSON.parse(content); } catch { parsed = null; }
    }
  }
  if (Array.isArray(parsed)) return { exists:true, emails:parsed };
  if (parsed && typeof parsed==='object'){
    if (Array.isArray(parsed.emails)) return { exists:true, emails:parsed.emails };
    return { exists:true, emails:Object.values(parsed) };
  }
  return { exists:true, emails:[] };
}

async function putFile(path, contentB64, message='chore: add file 📄'){
  const url = `${GH_API}/repos/${OWNER}/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const body = { message, content: contentB64, branch: BRANCH };
  const res = await fetch(url, {
    method:'PUT',
    headers:{ ...API_HEADERS(magicToken), 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok){ const t = await res.text(); throw new Error(`Upload failed: ${res.status} ${t}`); }
  return res.json();
}

async function putEmailsFile(nextEmails, message='chore: add a magical letter 💌'){
  const url = `${GH_API}/repos/${OWNER}/${REPO}/contents/${encodeURI(FILE_PATH)}`;
  const body = { message, content: encode64(JSON.stringify(nextEmails,null,2)), branch: BRANCH };
  if (currentSha) body.sha = currentSha;
  const res = await fetch(url, {
    method:'PUT',
    headers:{ ...API_HEADERS(magicToken), 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok){ const t = await res.text(); throw new Error(`The stars hesitated: ${res.status} ${t}`); }
  const json = await res.json();
  currentSha = json.content?.sha || currentSha;
  return json;
}

/* ---------- Image helpers ---------- */
function arrayBufferToBase64(buffer){
  const bytes = new Uint8Array(buffer);
  let binary = ''; const chunk = 0x8000;
  for (let i=0;i<bytes.length;i+=chunk){ binary += String.fromCharCode.apply(null, bytes.subarray(i,i+chunk)); }
  return btoa(binary);
}
function fileToImage(file){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    const fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
async function compressImage(file, maxDim=1600, quality=0.85, type='image/jpeg'){
  try{
    const img = await fileToImage(file);
    const { width, height } = img;
    let targetW=width, targetH=height;
    if (width>height && width>maxDim){ targetW=maxDim; targetH=Math.round((maxDim/width)*height); }
    else if (height>=width && height>maxDim){ targetH=maxDim; targetW=Math.round((maxDim/height)*width); }
    const canvas = document.createElement('canvas'); canvas.width=targetW; canvas.height=targetH;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0,targetW,targetH);
    const blob = await new Promise(res => canvas.toBlob(res, type, quality));
    return blob || file;
  }catch{ return file; }
}
async function blobToBase64(blob){ const buf = await blob.arrayBuffer(); return arrayBufferToBase64(buf); }

/* ---------- Image display/fetch ---------- */
const imageObjectUrlCache = new Map();
function pathFromRawUrl(u){
  try{ const m = u.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/); if (m && m[1]) return decodeURIComponent(m[1]); }catch{}
  return null;
}
async function getObjectUrlForPath(path){
  if (imageObjectUrlCache.has(path)) return imageObjectUrlCache.get(path);
  const url = `${GH_API}/repos/${OWNER}/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(BRANCH)}`;
  const res = await fetch(url, { headers:{ ...API_HEADERS(magicToken), Accept:'application/vnd.github.v3.raw' }});
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const blob = await res.blob(); const objUrl = URL.createObjectURL(blob);
  imageObjectUrlCache.set(path, objUrl); return objUrl;
}
function loadImageIntoElement(imgEl, stored){
  imgEl.onerror = null;
  if (typeof stored === 'string' && /^https?:\/\//.test(stored)){
    imgEl.src = stored;
    imgEl.onerror = async ()=>{
      const path = pathFromRawUrl(stored); if (!path) return;
      try{ imgEl.src = await getObjectUrlForPath(path);}catch{}
    };
    return;
  }
  const path = String(stored||'').replace(/^\/+/,''); if (!path) return;
  imgEl.src = rawUrl(path);
  imgEl.onerror = async ()=>{ try{ imgEl.src = await getObjectUrlForPath(path);}catch{} };
}

/* ---------- UI wiring ---------- */
function setupTabs(){
  const tabs = $$('.tab');
  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabs.forEach(b=>b.classList.remove('active')); btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      $$('.panel').forEach(p=>p.classList.remove('active'));
      if (tab === 'compose'){ $('#composePanel').classList.add('active'); updateGreeting(); closeCalendarDropdown(); }
      else { $('#inboxPanel').classList.add('active'); refreshInbox(); }
    });
  });
}

function sparkleStatus(el, msg, kind='info'){ el.textContent = msg; el.style.color = kind === 'error' ? '#ffb8c8' : '#7f5cff'; }

function getDisplayEmails(){
  if (!activeFilterDateKey) return emails;
  return emails.filter(e => dateKeyFromISO(e.createdAt || new Date().toISOString()) === activeFilterDateKey);
}

function renderInbox(){
  const grid = $('#inboxGrid'); grid.innerHTML = '';
  const listToRender = getDisplayEmails();
  const chip = $('#activeFilterChip');
  if (activeFilterDateKey){
    const dt = new Date(activeFilterDateKey);
    chip.querySelector('.chip-text').textContent = dt.toLocaleDateString([], { dateStyle:'full' });
    chip.hidden = false;
    $('#clearFilterBtn').hidden = false;
  } else {
    chip.hidden = true;
    $('#clearFilterBtn').hidden = true;
  }

  if (!listToRender.length){
    grid.innerHTML = `<div class="card paper" style="padding:16px; text-align:center;"><p>No letters ${activeFilterDateKey ? 'on this day' : 'yet'}. Your sky awaits its first sparkle 💖</p></div>`;
    return;
  }

  const list = [...listToRender].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  const tpl = $('#cardTemplate');

  list.forEach((e, idx)=>{
    const node = tpl.content.cloneNode(true);
    const card = $('.note-card', node);
    const thumb = $('.note-thumb', node);
    if (Array.isArray(e.images) && e.images.length){ loadImageIntoElement(thumb, e.images[0]); thumb.hidden = false; }
    $('.note-title', node).textContent = e.title || '(Untitled)';
    $('.note-preview', node).textContent = (e.body || '').slice(0, 200);
    $('.date', node).textContent = datePretty(e.createdAt || new Date().toISOString());
    $('.read-btn', node).addEventListener('click', ()=>openReader(e));
    grid.appendChild(node);
    const hues = ['#ffd9f2', '#e3d5ff', '#caffff', '#ffe7c2']; const pick = hues[idx % hues.length];
    card.style.border = '1px solid rgba(255,255,255,0.35)';
    card.style.backgroundImage = `radial-gradient(220px 90px at 90% -10%, ${pick}55, transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.5), transparent)`;
  });
}

async function refreshInbox(){
  const status = $('#inboxStatus');
  if (!navigator.onLine){
    sparkleStatus(status, 'You are offline. Showing cached letters (if any).');
    renderInbox(); renderCalendar(); updateStreakChip(); return;
  }
  sparkleStatus(status, 'Calling friendly fireflies...');
  try{
    const res = await getEmailsFile();
    emails = res.emails || [];
    sparkleStatus(status, `Fetched ${emails.length} letters ✨`);
    renderInbox(); renderCalendar(); updateStreakChip();
  }catch(e){ sparkleStatus(status, e.message, 'error'); }
}

function openReader(email){
  openedId = email.id || null;
  $('#readerTitle').textContent = email.title || '(Untitled)';
  $('#readerBody').textContent = email.body || '';
  const gallery = $('#readerGallery'); gallery.innerHTML = '';
  if (Array.isArray(email.images) && email.images.length){
    email.images.forEach(stored=>{ const img = new Image(); img.alt=''; loadImageIntoElement(img, stored); gallery.appendChild(img); });
  }
  const dlg = $('#readerModal');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open','');
}
function closeReader(){
  const dlg = $('#readerModal');
  if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  openedId = null;
}
function shareCurrent(){
  if (!openedId) return; const e = emails.find(x=>x.id===openedId); if (!e) return;
  const text = `💌 ${e.title}\n\n${e.body}`;
  if (navigator.share){ navigator.share({ title: e.title || 'Reflections', text }); }
  else { navigator.clipboard.writeText(text); alert('Copied to clipboard ✨'); }
}
async function deleteCurrent(){
  if (!openedId) return;
  if (!confirm('Gently release this letter into the night?')) return;
  const composeStatus = $('#composeStatus');
  try{
    const res = await getEmailsFile();
    const after = (res.emails || []).filter(x=>x.id!==openedId);
    await putEmailsFile(after, 'chore: release a letter into the night 🌙');
    emails = after; renderInbox(); renderCalendar(); updateStreakChip(); closeReader(); sparkleTrail();
    sparkleStatus(composeStatus, 'Letter released with grace 🌙');
  }catch(e){ alert('The stars murmured: ' + e.message); }
}

function sparkleTrail(){
  const btn = $('#sendBtn'); if (!btn) return;
  const burst = document.createElement('span'); burst.className='burst'; burst.innerHTML='✨';
  const rect = btn.getBoundingClientRect();
  Object.assign(burst.style,{ position:'fixed', left:`${rect.left+rect.width/2}px`, top:`${rect.top}px`, pointerEvents:'none', animation:'burst 800ms ease forwards', zIndex: 1000 });
  document.body.appendChild(burst); setTimeout(()=>burst.remove(), 900);
}
const style = document.createElement('style');
style.textContent = `@keyframes burst { from { transform: translate(-50%, -10px) scale(0.8); opacity: 0 } 30% { opacity:1 } to { transform: translate(-50%, -60px) scale(1.2); opacity: 0 } }`;
document.head.appendChild(style);

/* ---------- Offline handling ---------- */
function ensureOfflineModal(){
  let dlg = $('#offlineModal'); if (dlg) return dlg;
  dlg = document.createElement('dialog'); dlg.id='offlineModal'; dlg.className='modal glass sm';
  dlg.innerHTML = `
    <div class="modal-header">
      <h3>You're offline</h3>
      <button id="closeOffline" class="icon-btn modal-close" aria-label="Close" title="Close">×</button>
    </div>
    <article class="reader-body modal-body">
      <p>No internet connection detected.</p>
      <p>Sending letters and adding photos are disabled until you're back online.</p>
    </article>
    <div class="modal-footer">
      <button id="retryOnlineBtn" class="btn primary">Try again</button>
    </div>
  `;
  document.body.appendChild(dlg);
  $('#closeOffline')?.addEventListener('click', ()=>{ if (typeof dlg.close==='function') dlg.close(); else dlg.removeAttribute('open'); });
  $('#retryOnlineBtn')?.addEventListener('click', ()=>{ if (navigator.onLine){ closeOfflineModal(); refreshInbox(); } });
  return dlg;
}
function openOfflineModal(){ const dlg = ensureOfflineModal(); if (!dlg) return; if (typeof dlg.showModal==='function'){ if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open',''); }
function closeOfflineModal(){ const dlg = $('#offlineModal'); if (!dlg) return; if (typeof dlg.close==='function') dlg.close(); else dlg.removeAttribute('open'); }
function updateOnlineUI(isOnline){
  $('#sendBtn')?.toggleAttribute('disabled', !isOnline);
  $('#addPhotosBtn')?.toggleAttribute('disabled', !isOnline);
  $('#imageInput')?.toggleAttribute('disabled', !isOnline);
}
function handleConnectivityChange(){
  const isOnline = navigator.onLine; updateOnlineUI(isOnline);
  const status = $('#composeStatus');
  if (isOnline){ closeOfflineModal(); if (status) sparkleStatus(status, 'Back online ✨'); }
  else { openOfflineModal(); if (status) sparkleStatus(status, 'Offline. Sending and photo uploads are disabled.', 'error'); }
}

/* ---------- Compose ---------- */
async function onSend(){
  const title = $('#mailTitle').value.trim();
  const body = $('#mailBody').value.trim();
  const status = $('#composeStatus');

  if (!navigator.onLine){ openOfflineModal(); sparkleStatus(status,'You are offline. Connect to the internet to send this note ✨','error'); return; }
  if (!title && !body && selectedImages.length===0){ sparkleStatus(status,'Write a little something lovely or add a photo first ✨','error'); return; }
  if (!magicToken){ openTokenModal(true); sparkleStatus(status,'We need your Magic Key to send this note ✨','error'); return; }

  $('#sendBtn').disabled = true; sparkleStatus(status,'Preparing your letter…');

  const newEmail = { id: (crypto&&crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())+Math.random().toString(16).slice(2), title, body, createdAt: new Date().toISOString(), images: [] };

  if (selectedImages.length){
    try{
      sparkleStatus(status, `Uploading ${selectedImages.length} photo(s)…`);
      const uploaded = []; let idx = 0;
      for (const file of selectedImages){
        idx += 1; sparkleStatus(status, `Compressing photo ${idx}/${selectedImages.length}…`);
        const blob = await compressImage(file, 1600, 0.85, 'image/jpeg');
        const b64 = await blobToBase64(blob);
        const namePart = `${Date.now()}-${idx}.jpg`;
        const path = `${IMAGES_DIR}/${newEmail.id}/${namePart}`;
        await putFile(path, b64, `feat: add photo for entry ${newEmail.id} 📷`);
        uploaded.push(path);
      }
      newEmail.images = uploaded; sparkleStatus(status,'Photos uploaded. Finalizing letter…');
    }catch(err){ sparkleStatus(status, `Photo upload failed: ${err.message}`,'error'); $('#sendBtn').disabled=false; return; }
  }

  try{
    const res = await getEmailsFile();
    const next = [...res.emails, newEmail];
    await putEmailsFile(next, 'chore: add a magical letter 💌');
    emails = next; renderInbox(); renderCalendar(); updateStreakChip();
    sparkleStatus(status, 'Your letter is shining in the night sky ✨'); sparkleTrail();
    $('#mailTitle').value=''; $('#mailBody').value=''; clearSelectedImages();

    $$('[data-tab]').forEach(b=>b.classList.remove('active'));
    $$('[data-tab="inbox"]')[0].classList.add('active');
    $$('.panel').forEach(p=>p.classList.remove('active'));
    $('#inboxPanel').classList.add('active');
  }catch(e){
    if (String(e.message).includes('403')) sparkleStatus(status, 'Your Magic Key can read the stars but not write. Grant “Contents: Read and write” to your token and try again 💫','error');
    else if (String(e.message).includes('404')) sparkleStatus(status,'Could not find your constellation (repo or branch). Make sure it exists ✨','error');
    else sparkleStatus(status, e.message, 'error');
  }finally{ $('#sendBtn').disabled=false; }
}
function onClear(){ $('#mailTitle').value=''; $('#mailBody').value=''; $('#composeStatus').textContent=''; clearSelectedImages(); }

/* ---------- Images: picker ---------- */
function updateImagePreviews(){
  const wrap = $('#imagePreview'); wrap.innerHTML='';
  selectedImages.forEach((file,i)=>{
    const div=document.createElement('div'); div.className='thumb';
    const img=document.createElement('img'); img.alt=''; img.src=URL.createObjectURL(file); img.onload = ()=>URL.revokeObjectURL(img.src);
    const btn=document.createElement('button'); btn.className='remove'; btn.type='button'; btn.textContent='×'; btn.title='Remove';
    btn.addEventListener('click',()=>{ selectedImages.splice(i,1); updateImagePreviews(); });
    div.appendChild(img); div.appendChild(btn); wrap.appendChild(div);
  });
}
function clearSelectedImages(){ selectedImages=[]; updateImagePreviews(); }

/* ---------- Token modal ---------- */
function openTokenModal(force=false){
  const dlg = $('#tokenModal');
  if (force || !magicToken || !displayName){
    const nameEl = $('#nameInput'); if (nameEl && displayName) nameEl.value = displayName;
    if (typeof dlg.showModal==='function') dlg.showModal(); else dlg.setAttribute('open','');
  }
}
function closeTokenModal(){ const dlg = $('#tokenModal'); if (typeof dlg.close==='function') dlg.close(); else dlg.removeAttribute('open'); }
function setupSettings(){
  $('#settingsBtn').addEventListener('click', ()=>{ $('#settingsModal').showModal(); });
  $('#closeSettings').addEventListener('click', ()=>{ $('#settingsModal').close(); });
  $('#reenterTokenBtn').addEventListener('click', ()=>{ $('#settingsModal').close(); openTokenModal(true); });
  $('#forgetTokenBtn').addEventListener('click', ()=>{ if (confirm('Forget your Magic Key on this device?')){ forgetToken(); alert('Magic Key forgotten. You’ll be asked again next time ✨'); } });
}

/* ---------- SW update flow ---------- */
function setupUpdateFlow(){
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg)=>{
    if (reg.waiting) showUpdateModal(reg);
    reg.addEventListener('updatefound', ()=>{
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', ()=>{ if (nw.state==='installed' && navigator.serviceWorker.controller){ showUpdateModal(reg); } });
    });
    let refreshing=false;
    navigator.serviceWorker.addEventListener('controllerchange', ()=>{ if (refreshing) return; refreshing=true; window.location.reload(); });
  }).catch(()=>{});
}
function showUpdateModal(reg){
  const dlg = $('#updateModal'); if (!dlg) return;
  const close = ()=> (typeof dlg.close==='function' ? dlg.close() : dlg.removeAttribute('open'));
  const updateNow = ()=>{ if (reg.waiting) reg.waiting.postMessage({ type:'SKIP_WAITING' }); close(); };
  $('#updateNowBtn').onclick = updateNow; $('#updateLaterBtn').onclick = close; $('#closeUpdate').onclick = close;
  if (typeof dlg.showModal==='function') dlg.showModal(); else dlg.setAttribute('open','');
}

/* ---------- Calendar (dropdown) & streak ---------- */
function buildEntryDateSet(){
  const set = new Set();
  for (const e of emails){ if (!e || !e.createdAt) continue; set.add(dateKeyFromISO(e.createdAt)); }
  return set;
}
function setCalendarTo(date){ const clamped = clampToMinMonth(date); calYear = clamped.getFullYear(); calMonth = clamped.getMonth(); }

function populateMonthYearPickers(){
  const monthSel = $('#monthSelect'); const yearSel = $('#yearSelect');
  if (!monthSel || !yearSel) return;

  // Month options
  monthSel.innerHTML = '';
  MONTHS.forEach((name, idx)=>{
    const opt = document.createElement('option');
    opt.value = String(idx); opt.textContent = name;
    if (calYear === MIN_CAL_YEAR && idx < MIN_CAL_MONTH) opt.disabled = true;
    monthSel.appendChild(opt);
  });
  monthSel.value = String(calMonth);

  // Year options: from MIN to current year + 3
  const currentYear = new Date().getFullYear();
  const maxYear = Math.max(currentYear, MIN_CAL_YEAR) + 3;
  yearSel.innerHTML = '';
  for (let y = MIN_CAL_YEAR; y <= maxYear; y++){
    const opt = document.createElement('option');
    opt.value = String(y); opt.textContent = String(y);
    yearSel.appendChild(opt);
  }
  yearSel.value = String(calYear);
}

function renderCalendar(){
  const titleEl = $('#calTitle'); const grid = $('#calendarGrid'); const prevBtn = $('#calPrev'); const monthSel=$('#monthSelect'); const yearSel=$('#yearSelect');
  if (!titleEl || !grid) return;

  titleEl.textContent = `${MONTHS[calMonth]} ${calYear}`;
  populateMonthYearPickers();

  const atMinMonth = (calYear===MIN_CAL_YEAR && calMonth===MIN_CAL_MONTH);
  if (prevBtn){ prevBtn.disabled = atMinMonth; prevBtn.setAttribute('aria-disabled', atMinMonth ? 'true' : 'false'); }

  grid.innerHTML = '';

  const weekdayNames = Array.from({ length:7 }, (_,i)=> new Date(1970,0,4+i).toLocaleDateString([], { weekday:'short' }));
  for (const name of weekdayNames){
    const h = document.createElement('div'); h.className='cal-cell'; h.textContent=name; h.setAttribute('role','columnheader'); grid.appendChild(h);
  }

  const firstOfMonth = new Date(calYear, calMonth, 1);
  const startDow = firstOfMonth.getDay();
  const gridStart = addDays(firstOfMonth, -startDow);

  const todayKey = dateKeyFromDate(new Date());
  const entryDays = buildEntryDateSet();

  for (let i=0;i<42;i++){
    const d = addDays(gridStart, i);
    const isOtherMonth = d.getMonth() !== calMonth;
    const key = dateKeyFromDate(d);
    const hasEntry = entryDays.has(key);
    const isToday = key === todayKey;
    const isSelected = activeFilterDateKey === key;
    const beforeMin = isBeforeMinMonth(d.getFullYear(), d.getMonth());

    const cell = document.createElement('button');
    cell.type='button';
    cell.className = `cal-day${isOtherMonth?' other-month':''}${hasEntry?' has-entry':''}${isToday?' today':''}${isSelected?' selected':''}`;
    cell.setAttribute('role','gridcell');
    cell.setAttribute('aria-label', `${d.toLocaleDateString([], { dateStyle:'full' })}${hasEntry?' — has entry':''}${isToday?' — today':''}`);
    cell.textContent = String(d.getDate());
    cell.dataset.key = key;

    if (beforeMin){ cell.disabled = true; cell.setAttribute('aria-disabled','true'); }

    cell.addEventListener('click', ()=>{
      if (cell.disabled) return;
      if (isOtherMonth){
        if (!isBeforeMinMonth(d.getFullYear(), d.getMonth())){
          setCalendarTo(d); setDateFilter(key, /*closeDropdown*/ true);
        }
      }else{
        if (activeFilterDateKey === key){ setDateFilter(null, true); }
        else { setDateFilter(key, true); }
      }
    });

    grid.appendChild(cell);
  }

  // Month/year change handlers
  monthSel?.addEventListener('change', ()=>{
    const m = parseInt(monthSel.value,10);
    if (calYear===MIN_CAL_YEAR && m<MIN_CAL_MONTH){ setCalendarTo(new Date(MIN_CAL_YEAR, MIN_CAL_MONTH, 1)); }
    else { calMonth = m; }
    renderCalendar();
  }, { once:true });

  yearSel?.addEventListener('change', ()=>{
    const y = parseInt(yearSel.value,10);
    calYear = y;
    if (calYear===MIN_CAL_YEAR && calMonth<MIN_CAL_MONTH) calMonth = MIN_CAL_MONTH;
    renderCalendar();
  }, { once:true });
}

function setDateFilter(dateKeyOrNull, closeAfter=false){
  if (dateKeyOrNull){
    const dt = new Date(dateKeyOrNull);
    if (isBeforeMinMonth(dt.getFullYear(), dt.getMonth())) return;
  }
  activeFilterDateKey = dateKeyOrNull;
  renderInbox();
  const status = $('#inboxStatus');
  if (activeFilterDateKey){
    const dt = new Date(activeFilterDateKey);
    sparkleStatus(status, `Showing entries for ${dt.toLocaleDateString([], { dateStyle:'full' })}`);
  } else { sparkleStatus(status, `Showing ${emails.length} letters ✨`); }
  renderCalendar();
  if (closeAfter) closeCalendarDropdown();
}

function updateStreakChip(){
  const chip = $('#streakChip');
  const fab = $('#streakFab');
  const fabText = $('#streakFabText');

  if (!emails.length){
    if (chip) chip.hidden = true;
    if (fab) fab.hidden = true;
    return;
  }
  const entryDays = buildEntryDateSet();
  let streak = 0; let cursor = new Date();
  while (entryDays.has(dateKeyFromDate(cursor))){ streak += 1; cursor = addDays(cursor,-1); }

  if (streak === 0){
    if (chip) chip.hidden = true;
    if (fab) fab.hidden = true;
    return;
  }

  if (chip){
    chip.textContent = `🔥 ${streak}-day streak`;
    chip.hidden = false;
  }
  if (fab && fabText){
    fabText.textContent = `${streak}`;
    fab.setAttribute('aria-label', `${streak}-day streak`);
    fab.hidden = false;
  }
}

/* ---------- Calendar dropdown behavior ---------- */
function positionDropdown(){
  const panel = $('#calendarDropdown'); const btn = $('#toggleCalendarBtn'); if (!panel || !btn) return;
  const br = btn.getBoundingClientRect();
  const width = panel.offsetWidth || 360; const margin = 8;
  let left = Math.max(margin, Math.min(br.left, window.innerWidth - width - margin));
  let top = br.bottom + 6;
  panel.style.left = `${left}px`; panel.style.top = `${top}px`;
}
function openCalendarDropdown(){
  const panel = $('#calendarDropdown'); const btn = $('#toggleCalendarBtn'); if (!panel || !btn) return;
  panel.hidden = false; requestAnimationFrame(()=>{ panel.classList.add('open'); });
  btn.setAttribute('aria-expanded','true'); calendarOpen = true;
  positionDropdown(); renderCalendar();
  window.addEventListener('resize', positionDropdown);
  window.addEventListener('scroll', positionDropdown, { passive:true });
  document.addEventListener('click', outsideCloseHandler);
  document.addEventListener('keydown', escCloseHandler);
}
function closeCalendarDropdown(){
  const panel = $('#calendarDropdown'); const btn = $('#toggleCalendarBtn'); if (!panel || !btn) return;
  panel.classList.remove('open');
  btn.setAttribute('aria-expanded','false'); calendarOpen = false;
  window.removeEventListener('resize', positionDropdown);
  window.removeEventListener('scroll', positionDropdown);
  document.removeEventListener('click', outsideCloseHandler);
  document.removeEventListener('keydown', escCloseHandler);
  setTimeout(()=>{ panel.hidden = true; }, 120);
}
function toggleCalendarDropdown(){ calendarOpen ? closeCalendarDropdown() : openCalendarDropdown(); }
function outsideCloseHandler(e){
  const panel = $('#calendarDropdown'); const btn = $('#toggleCalendarBtn');
  if (!panel || !btn) return;
  if (!panel.contains(e.target) && !btn.contains(e.target)) closeCalendarDropdown();
}
function escCloseHandler(e){ if (e.key === 'Escape') closeCalendarDropdown(); }

/* ---------- Credit flip ---------- */
function setupCreditFlip(){
  const btn = $('#creditLink'); if (!btn) return;
  const inner = btn.querySelector('.flip-inner');
  const front = btn.querySelector('.front');
  const back = btn.querySelector('.back');

  // Fix width to the wider side to avoid jump
  requestAnimationFrame(()=>{
    const w = Math.max(front.offsetWidth, back.offsetWidth);
    inner.style.setProperty('--flip-width', `${Math.max(220, w)}px`);
  });

  const toggle = ()=>{
    const flipped = btn.classList.toggle('flipped');
    btn.setAttribute('aria-pressed', flipped ? 'true' : 'false');
    btn.setAttribute('aria-expanded', flipped ? 'true' : 'false');
  };

  btn.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  btn.addEventListener('keydown', (ev)=>{ if (ev.key==='Enter' || ev.key===' '){ ev.preventDefault(); toggle(); } });

  btn.addEventListener('transitionend', ()=>{
    if (btn.classList.contains('flipped')){
      setTimeout(()=>{ btn.classList.remove('flipped'); btn.setAttribute('aria-pressed','false'); btn.setAttribute('aria-expanded','false'); }, 2200);
    }
  });
}

/* ---------- Streak FAB behavior ---------- */
function onStreakFabClick(){
  // Ensure we're on the inbox so the calendar is available
  const inboxPanel = $('#inboxPanel');
  if (!inboxPanel.classList.contains('active')){
    const inboxTab = document.querySelector('.tab[data-tab="inbox"]');
    inboxTab?.click();
  }
  // Toggle the calendar dropdown for quick review of days
  toggleCalendarDropdown();
}

/* ---------- Init ---------- */
window.addEventListener('DOMContentLoaded', ()=>{
  // Loader fade
  const loader = $('#loadingScreen'); setTimeout(()=>loader?.classList.add('hide'), 1000);

  // Token + Name
  const rememberedToken = loadToken(); const rememberedName = loadName();
  if (rememberedToken) magicToken = rememberedToken;
  if (rememberedName) displayName = rememberedName;

  setupTabs(); setupCreditFlip(); setupSettings(); updateGreeting();

  if (!rememberedToken || !rememberedName) openTokenModal(false);

  // Token modal close via X
  $('#closeToken')?.addEventListener('click', (e)=>{ e.preventDefault(); closeTokenModal(); });

  // Image picker events
  $('#addPhotosBtn')?.addEventListener('click', ()=>{ if (!navigator.onLine){ openOfflineModal(); return; } $('#imageInput').click(); });
  $('#clearPhotosBtn')?.addEventListener('click', clearSelectedImages);
  $('#imageInput')?.addEventListener('change', (e)=>{
    const files = Array.from(e.target.files || []);
    const onlyImages = files.filter(f=>f.type.startsWith('image/'));
    selectedImages.push(...onlyImages); updateImagePreviews(); e.target.value='';
  });

  $('#saveTokenBtn')?.addEventListener('click', (e)=>{
    e.preventDefault();
    const nameVal = $('#nameInput').value.trim();
    const tokenVal = $('#tokenInput').value.trim();
    if (nameVal) saveName(nameVal);
    if (!magicToken && !tokenVal){ alert('Please enter your Magic Key to begin ✨'); return; }
    if (tokenVal) saveToken(tokenVal);
    updateGreeting(); closeTokenModal(); if (magicToken) refreshInbox(); else updateStreakChip();
  });

  // Compose actions
  $('#sendBtn').addEventListener('click', onSend);
  $('#clearBtn').addEventListener('click', onClear);

  // Inbox actions
  $('#refreshBtn').addEventListener('click', refreshInbox);
  $('#chipClearBtn').addEventListener('click', ()=> setDateFilter(null));
  $('#clearFilterBtn').addEventListener('click', ()=> setDateFilter(null));

  // Reader actions
  $('#closeReader').addEventListener('click', closeReader);
  $('#shareBtn').addEventListener('click', shareCurrent);
  $('#deleteBtn').addEventListener('click', deleteCurrent);

  // Calendar dropdown controls
  $('#toggleCalendarBtn').addEventListener('click', toggleCalendarDropdown);
  $('#calPrev')?.addEventListener('click', ()=>{
    const d = new Date(calYear, calMonth, 1); d.setMonth(d.getMonth()-1);
    if (isBeforeMinMonth(d.getFullYear(), d.getMonth())) return;
    setCalendarTo(d); renderCalendar(); positionDropdown();
  });
  $('#calNext')?.addEventListener('click', ()=>{
    const d = new Date(calYear, calMonth, 1); d.setMonth(d.getMonth()+1);
    setCalendarTo(d); renderCalendar(); positionDropdown();
  });
  $('#calToday')?.addEventListener('click', ()=>{
    let d = new Date();
    if (isBeforeMinMonth(d.getFullYear(), d.getMonth())) d = new Date(MIN_CAL_YEAR, MIN_CAL_MONTH, 1);
    setCalendarTo(d); renderCalendar(); positionDropdown();
  });

  // Service worker update flow
  setupUpdateFlow();

  // Offline handling
  ensureOfflineModal(); handleConnectivityChange();
  window.addEventListener('online', handleConnectivityChange);
  window.addEventListener('offline', handleConnectivityChange);

  // Streak FAB
  $('#streakFab')?.addEventListener('click', onStreakFabClick);

  // Initial calendar state & streak
  setCalendarTo(MIN_CAL_DATE);
  renderCalendar();
  updateStreakChip();

  if (magicToken) refreshInbox();
});