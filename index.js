/* iGlass Status — SillyTavern extension
 * ความสัมพันธ์ 100 ระดับ · ความทรงจำสำคัญ · ปฏิทินเนื้อเรื่อง
 * ออกแบบตาม iOS / iGlassOS · รองรับมือถือเต็มรูปแบบ
 *
 * กฎที่ยึดทั้งไฟล์
 *  - ไม่มี export ไม่มี hooks ในแมนิเฟสต์ เพราะ ST ที่เช่าโหลดแบบ classic script
 *    ถ้ามี export คำเดียวไฟล์ตายทั้งไฟล์โดยไม่มี error
 *  - ไม่เรียก getContext() ที่ระดับบนสุด เรียกแบบหน่วงใน try/catch เสมอ
 *  - ไม่พึ่ง lifecycle event อย่างเดียว เพราะมันอาจยิงไปแล้วก่อนเราโหลด ใช้วนเช็ค DOM
 *  - เติมค่าเริ่มต้นทีละคีย์ทุกครั้งที่อ่าน ผู้ใช้เก่าจะได้ไม่เจอ undefined หลังอัปเดต
 *  - เก็บข้อมูลด้วยชื่อไฟล์อวาตาร์ ไม่ใช่ชื่อที่แสดง เปลี่ยนชื่อการ์ดแล้วประวัติไม่ขาด
 */

const IG_NAME = 'iglass-status';
const IG_VER = '1.0.0';
const IG_LS = 'iglass_status_mirror';
window.IGLASS_LOADED = 'parsed';

/* ══════════════════════════════════════════════════════════
 * 100 ระดับความสัมพันธ์ · 0 = ร้ายที่สุด · 99 = ผูกพันที่สุด
 * ส่งเข้า prompt แค่ชื่อระดับปัจจุบันชื่อเดียว ไม่ส่งทั้งตาราง
 * ══════════════════════════════════════════════════════════ */
const IG_TIERS = [
 'ศัตรูตลอดกาล', 'คู่แค้น', 'เกลียดเข้ากระดูก', 'จองเวร', 'ปองร้าย',
 'ชิงชัง', 'รังเกียจ', 'ขยะแขยง', 'เหม็นหน้า', 'หมั่นไส้',
 'บาดหมาง', 'ผิดใจกัน', 'งอนใส่', 'ระแวง', 'ไม่ไว้ใจ',
 'กินแหนงแคลงใจ', 'เย็นชา', 'เมินเฉย', 'ไม่อยากยุ่ง', 'ตีตัวออกห่าง',
 'คนแปลกหน้า', 'เพิ่งรู้จัก', 'พอรู้จักหน้า', 'คนผ่านทาง', 'คุยแต่เรื่องงาน',
 'เพื่อนร่วมงาน', 'คนคุ้นหน้า', 'ทักทายกันได้', 'พอคุยกันได้', 'เริ่มคุ้นเคย',
 'เพื่อนใหม่', 'เพื่อนกินข้าว', 'เพื่อนเล่น', 'เพื่อนคุย', 'เริ่มสนิท',
 'ไว้ใจได้บ้าง', 'เริ่มเปิดใจ', 'สบายใจที่จะอยู่ด้วย', 'นึกถึงบ้าง', 'คิดถึงเป็นบางครั้ง',
 'เพื่อนสนิท', 'เพื่อนซี้', 'คู่หู', 'คนรู้ใจ', 'ที่ปรึกษา',
 'พึ่งพาได้เสมอ', 'ห่วงใย', 'คอยดูแล', 'เป็นห่วงตลอด', 'อยากเจอบ่อย ๆ',
 'สนใจเป็นพิเศษ', 'แอบมอง', 'ใจเต้นเวลาเจอ', 'เขินเวลาอยู่ใกล้', 'คิดถึงทุกวัน',
 'อยากรู้เรื่องของเขา', 'หึงเบา ๆ', 'อยากเป็นคนพิเศษ', 'ส่งสัญญาณ', 'รอคำตอบ',
 'แอบชอบ', 'ชอบแล้วแหละ', 'ตกหลุมรัก', 'หลงรัก', 'รักข้างเดียว',
 'กำลังจีบ', 'คนคุย', 'มากกว่าเพื่อน', 'เกือบเป็นแฟน', 'ใกล้จะได้เป็น',
 'แฟนใหม่', 'คนรัก', 'คู่รัก', 'รักหวานชื่น', 'ติดกันหนึบ',
 'ขาดกันไม่ได้', 'รักลึกซึ้ง', 'ไว้ใจสุดหัวใจ', 'คู่ชีวิต', 'ให้สัญญาต่อกัน',
 'หมั้นหมาย', 'คู่หมั้น', 'แต่งงาน', 'สามีภรรยา', 'ครอบครัวเดียวกัน',
 'มีลูกด้วยกัน', 'จะแก่เฒ่าด้วยกัน', 'รักมั่นคง', 'รักไม่เสื่อมคลาย', 'รักชั่วชีวิต',
 'เนื้อคู่', 'คู่แท้', 'ครึ่งหนึ่งของกันและกัน', 'ขาดไม่ได้', 'ยอมตายแทนได้',
 'รักเหนือทุกสิ่ง', 'ผูกพันข้ามภพ', 'ดวงใจเดียวกัน', 'นิรันดร์', 'หนึ่งเดียวตลอดกาล',
];
const IG_TIER_ICON = ['💔', '🖤', '❄️', '🤝', '🙂', '😊', '💗', '💞', '💖', '💍'];

const IG_DEFAULTS = {
 enabled: true,
 showIcon: true,
 iconSize: 54,
 side: 'right',          // ไอคอนเกาะขอบไหน
 topPct: 62,             // ตำแหน่งแนวตั้ง เป็นเปอร์เซ็นต์
 // ความทรงจำ
 memEnabled: true,
 memEvery: 15,           // สร้างความทรงจำทุกกี่ข้อความ
 memMax: 40,             // เก็บได้กี่รายการ เกินแล้วตัดตัวเก่า
 memInject: 8,           // ส่งเข้า prompt กี่รายการ
 // ปฏิทิน
 calEnabled: true,
 calEveryDays: 3,        // ตรวจทุกกี่วันในเกม
 calInject: 4,           // ส่งเข้า prompt กี่รายการ
 calMax: 30,
 // ความสัมพันธ์
 relEnabled: true,
 relInject: true,
 relStart: 20,           // เริ่มที่ระดับไหน 20 = คนแปลกหน้า
 // อื่น ๆ
 injectEnabled: true,    // ปิดตัวเดียวจบ ไม่ส่งอะไรเข้า prompt เลย
 popupMs: 1800,
 reduceMotion: false,
 data: {},               // avatarKey -> { rel, mem, cal, day, count }
};

/* ── พื้นฐาน ────────────────────────────────────────────── */
function igCtx() { try { return SillyTavern.getContext(); } catch { return null; } }
function igEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function igClamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function igSettings() {
 const c = igCtx();
 if (!c || !c.extensionSettings) {
  try { return Object.assign({}, IG_DEFAULTS, JSON.parse(localStorage.getItem(IG_LS) || '{}')); }
  catch { return Object.assign({}, IG_DEFAULTS); }
 }
 if (!c.extensionSettings[IG_NAME]) c.extensionSettings[IG_NAME] = {};
 const s = c.extensionSettings[IG_NAME];
 // เติมทีละคีย์เสมอ ไม่ใช่เติมเฉพาะตอนว่าง
 for (const k of Object.keys(IG_DEFAULTS)) {
  if (s[k] === undefined) s[k] = (typeof IG_DEFAULTS[k] === 'object' && IG_DEFAULTS[k] !== null)
   ? JSON.parse(JSON.stringify(IG_DEFAULTS[k])) : IG_DEFAULTS[k];
 }
 return s;
}
function igSave() {
 const s = igSettings();
 try { igCtx()?.saveSettingsDebounced(); } catch {}
 try { localStorage.setItem(IG_LS, JSON.stringify(s)); } catch {}
}

/** คีย์ประจำตัวละคร ใช้ชื่อไฟล์อวาตาร์ เปลี่ยนชื่อการ์ดแล้วประวัติไม่ขาด */
function igCharKey() {
 const c = igCtx();
 if (!c) return '';
 try {
  if (c.groupId) return 'group:' + c.groupId;
  const ch = c.characters && c.characters[c.characterId];
  if (ch) return 'char:' + (ch.avatar || ch.name || 'unknown');
 } catch {}
 return '';
}
function igCharName() {
 const c = igCtx();
 try {
  const ch = c && c.characters && c.characters[c.characterId];
  if (ch && ch.name) return ch.name;
  if (c && c.groupId) return 'กลุ่ม';
 } catch {}
 return 'ตัวละคร';
}
function igCharAvatar() {
 const c = igCtx();
 try {
  const ch = c && c.characters && c.characters[c.characterId];
  if (ch && ch.avatar) return '/characters/' + encodeURIComponent(ch.avatar);
 } catch {}
 return '';
}
function igData(key) {
 const s = igSettings();
 const k = key || igCharKey();
 if (!k) return null;
 if (!s.data[k]) s.data[k] = { rel: s.relStart, mem: [], cal: [], day: '', count: 0, lastCalDay: '' };
 const d = s.data[k];
 if (typeof d.rel !== 'number') d.rel = s.relStart;
 if (!Array.isArray(d.mem)) d.mem = [];
 if (!Array.isArray(d.cal)) d.cal = [];
 if (typeof d.count !== 'number') d.count = 0;
 if (typeof d.day !== 'string') d.day = '';
 if (typeof d.lastCalDay !== 'string') d.lastCalDay = '';
 return d;
}
function igTierName(rel) { return IG_TIERS[igClamp(Math.round(rel), 0, 99)] || IG_TIERS[20]; }
function igTierIcon(rel) { return IG_TIER_ICON[igClamp(Math.floor(igClamp(rel, 0, 99) / 10), 0, 9)]; }

/* ── ไอคอนลอย ───────────────────────────────────────────── */
let igRoot = null, igPanelOpen = false, igDragging = false;

function igBuild() {
 if (document.getElementById('iglass-root')) return;
 const root = document.createElement('div');
 root.id = 'iglass-root';
 root.innerHTML = `
  <div class="ig-icon" id="ig-icon" role="button" tabindex="0" aria-label="สถานะตัวละคร">
   <img class="ig-av" id="ig-av" alt="">
   <span class="ig-ring" id="ig-ring"></span>
   <span class="ig-badge" id="ig-badge" hidden></span>
  </div>
  <div class="ig-panel" id="ig-panel" hidden>
   <div class="ig-panel-head">
    <img class="ig-panel-av" id="ig-panel-av" alt="">
    <div class="ig-panel-id">
     <div class="ig-panel-name" id="ig-panel-name"></div>
     <div class="ig-panel-tier" id="ig-panel-tier"></div>
    </div>
    <button class="ig-x" id="ig-close" aria-label="ปิด">✕</button>
   </div>
   <div class="ig-bar"><div class="ig-bar-fill" id="ig-bar-fill"></div></div>
   <div class="ig-bar-meta"><span id="ig-bar-lv"></span><span id="ig-bar-day"></span></div>
   <div class="ig-tabs">
    <button class="ig-tab on" data-igtab="mem">ความทรงจำ</button>
    <button class="ig-tab" data-igtab="cal">ปฏิทิน</button>
   </div>
   <div class="ig-body" id="ig-body"></div>
   <div class="ig-acts">
    <button class="ig-btn" id="ig-gen-mem">สรุปความทรงจำ</button>
    <button class="ig-btn primary" id="ig-gen-cal">สร้างปฏิทิน</button>
   </div>
   <div class="ig-foot" id="ig-foot"></div>
  </div>`;
 document.body.appendChild(root);
 igRoot = root;
 igBindIcon();
 igApplyPos();
 igRefreshIcon();
}

function igApplyPos() {
 const s = igSettings();
 if (!igRoot) return;
 igRoot.classList.toggle('ig-left', s.side === 'left');
 igRoot.style.top = igClamp(s.topPct, 5, 92) + '%';
 igRoot.style.setProperty('--ig-size', (s.iconSize || 54) + 'px');
 igRoot.style.display = (s.enabled && s.showIcon) ? '' : 'none';
}

function igBindIcon() {
 const icon = document.getElementById('ig-icon');
 if (!icon) return;
 let sx = 0, sy = 0, moved = false, startTop = 0;
 const down = e => {
  const p = e.touches ? e.touches[0] : e;
  sx = p.clientX; sy = p.clientY; moved = false; igDragging = false;
  startTop = igSettings().topPct;
  window.addEventListener('mousemove', move, { passive: false });
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
 };
 const move = e => {
  const p = e.touches ? e.touches[0] : e;
  const dx = p.clientX - sx, dy = p.clientY - sy;
  if (Math.abs(dx) + Math.abs(dy) > 8) { moved = true; igDragging = true; e.preventDefault(); }
  if (!moved) return;
  const s = igSettings();
  s.topPct = igClamp(startTop + (dy / window.innerHeight) * 100, 5, 92);
  s.side = p.clientX > window.innerWidth / 2 ? 'right' : 'left';
  igApplyPos();
 };
 const up = () => {
  window.removeEventListener('mousemove', move);
  window.removeEventListener('touchmove', move);
  window.removeEventListener('mouseup', up);
  window.removeEventListener('touchend', up);
  if (moved) { igSave(); setTimeout(() => { igDragging = false; }, 50); }
  else igTogglePanel();
 };
 icon.addEventListener('mousedown', down);
 icon.addEventListener('touchstart', down, { passive: true });
 icon.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); igTogglePanel(); } });
 document.getElementById('ig-close')?.addEventListener('click', () => igTogglePanel(false));
 document.getElementById('ig-gen-mem')?.addEventListener('click', () => igRunMemory(true));
 document.getElementById('ig-gen-cal')?.addEventListener('click', () => igRunCalendar(true));
 igRoot.querySelectorAll('[data-igtab]').forEach(b => b.addEventListener('click', () => {
  igRoot.querySelectorAll('[data-igtab]').forEach(x => x.classList.toggle('on', x === b));
  igRenderBody(b.dataset.igtab);
 }));
 document.addEventListener('click', e => {
  if (!igPanelOpen || igDragging) return;
  if (igRoot && !igRoot.contains(e.target)) igTogglePanel(false);
 });
}

function igTogglePanel(force) {
 const p = document.getElementById('ig-panel');
 if (!p) return;
 igPanelOpen = force === undefined ? !igPanelOpen : !!force;
 p.hidden = !igPanelOpen;
 if (igPanelOpen) { igRefreshPanel(); igRenderBody('mem'); }
}

function igRefreshIcon() {
 const d = igData();
 const av = igCharAvatar();
 const img = document.getElementById('ig-av');
 const ring = document.getElementById('ig-ring');
 if (img) { if (av) { img.src = av; img.style.display = ''; } else img.style.display = 'none'; }
 if (ring && d) {
  const pct = igClamp(d.rel, 0, 99) / 99;
  ring.style.background = `conic-gradient(var(--ig-accent) ${pct * 360}deg, rgba(128,128,128,.22) 0deg)`;
 }
 const icon = document.getElementById('ig-icon');
 if (icon && !av) icon.dataset.letter = (igCharName()[0] || '?');
}

function igRefreshPanel() {
 const d = igData();
 if (!d) return;
 const s = igSettings();
 const av = igCharAvatar();
 const pav = document.getElementById('ig-panel-av');
 if (pav) { if (av) { pav.src = av; pav.style.display = ''; } else pav.style.display = 'none'; }
 const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
 set('ig-panel-name', igCharName());
 set('ig-panel-tier', igTierIcon(d.rel) + ' ' + igTierName(d.rel));
 set('ig-bar-lv', `ระดับ ${igClamp(Math.round(d.rel), 0, 99)} / 99`);
 set('ig-bar-day', d.day ? `วันในเรื่อง ${d.day}` : 'ยังไม่รู้วันในเรื่อง');
 const fill = document.getElementById('ig-bar-fill');
 if (fill) fill.style.width = (igClamp(d.rel, 0, 99) / 99 * 100) + '%';
 const foot = document.getElementById('ig-foot');
 if (foot) {
  const next = s.memEnabled ? Math.max(0, (s.memEvery || 15) - (d.count || 0)) : '-';
  foot.textContent = s.memEnabled
   ? `อีก ${next} ข้อความจะสรุปความทรงจำรอบถัดไป · เก็บไว้ ${d.mem.length} · ปฏิทิน ${d.cal.length}`
   : `ปิดการสรุปอัตโนมัติอยู่ · เก็บไว้ ${d.mem.length} · ปฏิทิน ${d.cal.length}`;
 }
}

function igRenderBody(tab) {
 const body = document.getElementById('ig-body');
 const d = igData();
 if (!body || !d) return;
 body.innerHTML = '';
 const rows = tab === 'cal' ? d.cal.slice().reverse() : d.mem.slice().reverse();
 if (!rows.length) {
  const e = document.createElement('div');
  e.className = 'ig-empty';
  e.textContent = tab === 'cal' ? 'ยังไม่มีกำหนดการ กดสร้างปฏิทินได้เลย' : 'ยังไม่มีความทรงจำ เล่นไปสักพักแล้วระบบจะสรุปให้เอง';
  body.appendChild(e);
  return;
 }
 rows.forEach((r, i) => {
  const idx = rows.length - 1 - i;
  const row = document.createElement('div');
  row.className = 'ig-row' + (tab === 'cal' && r.s === 'failed' ? ' failed' : '');
  const dot = document.createElement('span');
  dot.className = 'ig-dot ' + (tab === 'cal' ? (r.s || 'plan') : 'mem');
  const txt = document.createElement('span');
  txt.className = 'ig-row-txt';
  // สร้างด้วย textContent ล้วน ไม่ต้องกรอง HTML เลย
  txt.textContent = tab === 'cal'
   ? `${r.d || '?'} · ${r.t || ''}${r.s === 'failed' ? ` (ล่ม → ${r.alt || 'ไม่ระบุ'})` : r.s === 'done' ? ' (เสร็จแล้ว)' : ''}`
   : r.t || '';
  const del = document.createElement('button');
  del.className = 'ig-del';
  del.textContent = '✕';
  del.title = 'ลบ';
  del.addEventListener('click', ev => {
   ev.stopPropagation();
   (tab === 'cal' ? d.cal : d.mem).splice(idx, 1);
   igSave(); igRenderBody(tab); igRefreshPanel();
  });
  row.append(dot, txt, del);
  if (tab === 'cal') {
   row.addEventListener('click', () => {
    r.s = r.s === 'plan' ? 'done' : r.s === 'done' ? 'failed' : 'plan';
    igSave(); igRenderBody('cal');
   });
   row.title = 'แตะเพื่อสลับสถานะ วางแผน → เสร็จแล้ว → ล่ม';
  }
  body.appendChild(row);
 });
}

/** ป้ายบวกลบเด้งข้างรูป */
function igPopDelta(delta) {
 const s = igSettings();
 const b = document.getElementById('ig-badge');
 if (!b || !delta) return;
 b.textContent = (delta > 0 ? '+' : '') + delta;
 b.className = 'ig-badge ' + (delta > 0 ? 'up' : 'down');
 b.hidden = false;
 if (s.reduceMotion) { setTimeout(() => { b.hidden = true; }, s.popupMs || 1800); return; }
 b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
 const done = () => { b.hidden = true; b.removeEventListener('animationend', done); };
 b.addEventListener('animationend', done);
}

function igApplyRel(delta, why) {
 const d = igData();
 if (!d || !delta) return;
 const before = d.rel;
 d.rel = igClamp(d.rel + delta, 0, 99);
 const real = Math.round(d.rel - before);
 igSave();
 if (real) {
  igPopDelta(real);
  igRefreshIcon();
  if (igPanelOpen) igRefreshPanel();
  const oldT = igTierName(before), newT = igTierName(d.rel);
  if (oldT !== newT) { try { toastr.info(`${igCharName()} · ${oldT} → ${newT}`, 'ความสัมพันธ์เปลี่ยน'); } catch {} }
 }
}

/* ══════════════════════════════════════════════════════════
 * เครื่องยนต์ความทรงจำและปฏิทิน
 * ทั้งคู่ยิงคำขอแยกเฉพาะตอนถึงรอบ ไม่ยิงทุกข้อความ
 * ══════════════════════════════════════════════════════════ */
let igBusy = false;

async function igGen(prompt) {
 const c = igCtx();
 if (!c) throw new Error('ยังไม่พร้อม');
 if (typeof c.generateQuietPrompt === 'function') {
  try { return await c.generateQuietPrompt({ quietPrompt: prompt, quietToLoud: false }); }
  catch { return await c.generateQuietPrompt(prompt, false, false); }
 }
 if (typeof c.generateRaw === 'function') return await c.generateRaw({ prompt });
 throw new Error('SillyTavern เวอร์ชันนี้ไม่มีช่องทางสร้างข้อความ');
}

function igRecentChat(n) {
 const c = igCtx();
 try {
  return (c.chat || []).slice(-Math.max(4, n || 20))
   .filter(m => m && !m.is_system && m.mes)
   .map(m => `${m.is_user ? 'ผู้ใช้' : (m.name || 'ตัวละคร')}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, 220)}`)
   .join('\n');
 } catch { return ''; }
}

async function igRunMemory(manual) {
 const s = igSettings();
 const d = igData();
 if (!d || igBusy) return;
 if (!s.memEnabled && !manual) return;
 igBusy = true;
 try {
  try { toastr.info('กำลังสรุปความทรงจำ…', 'iGlass Status'); } catch {}
  const nm = igCharName();
  const known = d.mem.slice(-10).map(x => x.t).join(' · ') || '(ยังไม่มี)';
  const prompt = [
   `[ระบบสรุปความทรงจำ ไม่ใช่บทสนทนา ตอบสั้นที่สุด]`,
   `บทล่าสุดของ ${nm}:`,
   igRecentChat(s.memEvery + 6),
   ``,
   `ความทรงจำที่บันทึกไว้แล้ว: ${known}`,
   ``,
   `สรุปเฉพาะสิ่งที่มีผลต่อเนื้อเรื่อง ความสัมพันธ์ หรือการเปลี่ยนแปลงของตัวละคร`,
   `ถ้าไม่มีอะไรสำคัญเลย ตอบ NONE คำเดียว ห้ามแต่งเพิ่ม`,
   `ห้ามซ้ำกับที่บันทึกไว้แล้ว`,
   ``,
   `รูปแบบคำตอบ อย่างละบรรทัด ไม่เกิน 3 บรรทัด แต่ละบรรทัดไม่เกิน 8 คำ`,
   `MEM: <คีย์เวิร์ดสั้น>`,
   `REL: <ตัวเลข -5 ถึง +5 ว่าความสัมพันธ์กับผู้ใช้ขยับเท่าไหร่>`,
   `DAY: <วันที่ในเรื่องตอนนี้ เช่น 2026-09-05 หรือ วันที่ 12>`,
   ``,
   `ตัวอย่างที่ถูก`,
   `MEM: ได้งานใหม่`,
   `MEM: ทะเลาะกับพี่ชาย`,
   `REL: +2`,
   `DAY: 2026-09-05`,
  ].filter(Boolean).join('\n');

  const raw = String(await igGen(prompt) || '');
  if (/^\s*NONE\s*$/im.test(raw) && !/MEM:/i.test(raw)) {
   d.count = 0; igSave();
   try { toastr.info('รอบนี้ไม่มีอะไรสำคัญพอจะบันทึก', 'iGlass Status'); } catch {}
   return;
  }
  let added = 0;
  raw.split(/\r?\n/).forEach(line => {
   const mm = line.match(/^\s*MEM\s*[:：]\s*(.+)$/i);
   if (mm) {
    const t = mm[1].trim().replace(/^["'“”]|["'“”]$/g, '').slice(0, 60);
    if (!t || /^none$/i.test(t)) return;
    if (d.mem.some(x => x.t === t)) return;      // กันซ้ำ
    d.mem.push({ t, ts: Date.now() });
    added++;
    return;
   }
   const rm = line.match(/^\s*REL\s*[:：]\s*([+-]?\d+)/i);
   if (rm && s.relEnabled) igApplyRel(igClamp(parseInt(rm[1], 10) || 0, -5, 5));
   const dm = line.match(/^\s*DAY\s*[:：]\s*(.+)$/i);
   if (dm) d.day = dm[1].trim().slice(0, 24);
  });
  if (d.mem.length > (s.memMax || 40)) d.mem = d.mem.slice(-(s.memMax || 40));
  d.count = 0;
  igSave();
  if (igPanelOpen) { igRenderBody('mem'); igRefreshPanel(); }
  try { toastr.success(added ? `บันทึก ${added} ความทรงจำ` : 'ไม่มีอะไรใหม่', 'iGlass Status'); } catch {}
  // ถึงรอบตรวจปฏิทินหรือยัง นับจากวันในเรื่อง
  if (s.calEnabled && igDayGap(d.lastCalDay, d.day) >= (s.calEveryDays || 3)) igRunCalendar(false);
 } catch (e) {
  console.error(`[${IG_NAME}] memory`, e);
  try { toastr.error(String(e.message || e), 'สรุปความทรงจำไม่สำเร็จ'); } catch {}
 } finally { igBusy = false; }
}

/** ห่างกันกี่วัน รองรับทั้ง 2026-09-05 และ วันที่ 12 */
function igDayGap(a, b) {
 if (!a) return 999;
 if (!b) return 0;
 const num = x => { const m = String(x).match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000; const n = String(x).match(/(\d+)/); return n ? +n[1] : null; };
 const x = num(a), y = num(b);
 if (x == null || y == null) return a === b ? 0 : 999;
 return Math.abs(y - x);
}

async function igRunCalendar(manual) {
 const s = igSettings();
 const d = igData();
 if (!d || igBusy) return;
 if (!s.calEnabled && !manual) return;
 igBusy = true;
 try {
  try { toastr.info('กำลังสร้างปฏิทิน…', 'iGlass Status'); } catch {}
  const nm = igCharName();
  const open = d.cal.filter(x => x.s === 'plan').map(x => `${x.d} ${x.t}`).join(' · ') || '(ไม่มี)';
  const prompt = [
   `[ระบบปฏิทินเนื้อเรื่อง ไม่ใช่บทสนทนา ตอบสั้นที่สุด]`,
   `บทล่าสุดของ ${nm}:`,
   igRecentChat(16),
   ``,
   `วันในเรื่องตอนนี้: ${d.day || 'ไม่ทราบ'}`,
   `แผนที่ยังค้างอยู่: ${open}`,
   ``,
   `งานของคุณสองอย่าง`,
   `1 ถ้าแผนที่ค้างอยู่อันไหนเกิดขึ้นไม่ได้แล้วตามบทล่าสุด ให้รายงานว่าล่ม พร้อมบอกว่าทำอะไรแทน`,
   `2 เพิ่มกำหนดการใหม่ของ ${nm} เฉพาะที่สำคัญจริง เช่น นัดพบ ทำงาน เดินทาง ภารกิจ`,
   `ถ้าเป็นแค่ชีวิตประจำวันหรือบทคุยทั่วไป ห้ามเพิ่ม ให้ตอบ NONE`,
   ``,
   `รูปแบบคำตอบ ไม่เกิน 4 บรรทัด แต่ละรายการไม่เกิน 10 คำ`,
   `CAL: <วันที่> | <สิ่งที่จะทำ>`,
   `CALX: <ข้อความแผนเดิม> | <ทำอะไรแทน>`,
   ``,
   `ตัวอย่างที่ถูก`,
   `CAL: 2026-09-08 | ไปสัมภาษณ์งานที่บริษัท`,
   `CALX: นัดเจอที่คาเฟ่ | ไปโรงพยาบาลแทน`,
  ].filter(Boolean).join('\n');

  const raw = String(await igGen(prompt) || '');
  let added = 0, killed = 0;
  raw.split(/\r?\n/).forEach(line => {
   const cx = line.match(/^\s*CALX\s*[:：]\s*(.+?)\s*\|\s*(.+)$/i);
   if (cx) {
    const want = cx[1].trim().toLowerCase();
    const hit = d.cal.find(x => x.s === 'plan' && String(x.t).toLowerCase().includes(want.slice(0, 12)));
    if (hit) { hit.s = 'failed'; hit.alt = cx[2].trim().slice(0, 60); killed++; }
    return;
   }
   const cm = line.match(/^\s*CAL\s*[:：]\s*(.+?)\s*\|\s*(.+)$/i);
   if (cm) {
    const day = cm[1].trim().slice(0, 24);
    const t = cm[2].trim().replace(/^["'“”]|["'“”]$/g, '').slice(0, 60);
    if (!t || /^none$/i.test(t)) return;
    if (d.cal.some(x => x.t === t && x.d === day)) return;
    d.cal.push({ d: day, t, s: 'plan', alt: '', ts: Date.now() });
    added++;
   }
  });
  if (d.cal.length > (s.calMax || 30)) d.cal = d.cal.slice(-(s.calMax || 30));
  d.lastCalDay = d.day || d.lastCalDay || String(Date.now());
  igSave();
  if (igPanelOpen) { igRenderBody('cal'); igRefreshPanel(); }
  try { toastr.success(`เพิ่ม ${added} · ล่ม ${killed}`, 'ปฏิทิน'); } catch {}
 } catch (e) {
  console.error(`[${IG_NAME}] calendar`, e);
  try { toastr.error(String(e.message || e), 'สร้างปฏิทินไม่สำเร็จ'); } catch {}
 } finally { igBusy = false; }
}

/* ══════════════════════════════════════════════════════════
 * ส่งเข้า prompt — ก้อนเล็กที่สุดเท่าที่ยังใช้อ้างอิงได้
 * ══════════════════════════════════════════════════════════ */
function igBuildBlock() {
 const s = igSettings();
 if (!s.enabled || !s.injectEnabled) return '';
 const d = igData();
 if (!d) return '';
 const nm = igCharName();
 const out = [];
 if (s.relEnabled && s.relInject) out.push(`ความสัมพันธ์กับผู้ใช้ตอนนี้: ${igTierName(d.rel)} (${igClamp(Math.round(d.rel), 0, 99)}/99)`);
 if (d.day) out.push(`วันในเรื่อง: ${d.day}`);
 if (s.memEnabled && d.mem.length) {
  out.push(`สิ่งที่ ${nm} จำได้: ` + d.mem.slice(-(s.memInject || 8)).map(x => x.t).join(' · '));
 }
 if (s.calEnabled && d.cal.length) {
  const plan = d.cal.filter(x => x.s === 'plan').slice(-(s.calInject || 4)).map(x => `${x.d} ${x.t}`);
  const fail = d.cal.filter(x => x.s === 'failed').slice(-2).map(x => `${x.t} (ล่ม ทำ ${x.alt || '-'} แทน)`);
  if (plan.length) out.push(`แผนของ ${nm}: ` + plan.join(' · '));
  if (fail.length) out.push(`แผนที่ล่มไปแล้ว: ` + fail.join(' · '));
 }
 if (!out.length) return '';
 return `[สถานะตัวละคร — ข้อมูลจริง ใช้อ้างอิงได้ ห้ามพิมพ์ก้อนนี้ออกมาในคำตอบ]\n` + out.join('\n');
}

window.iglassStatusInterceptor = function (chat) {
 try {
  const s = igSettings();
  if (!s.enabled || !s.injectEnabled) return;
  if (!Array.isArray(chat)) return;
  const block = igBuildBlock();
  if (block) chat.push({ is_user: false, is_system: true, mes: block });
 } catch (e) { console.error(`[${IG_NAME}] interceptor`, e); }
};

/* ── นับข้อความ ─────────────────────────────────────────── */
function igOnMessage() {
 try {
  const s = igSettings();
  if (!s.enabled) return;
  const d = igData();
  if (!d) return;
  d.count = (d.count || 0) + 1;
  igSave();
  if (igPanelOpen) igRefreshPanel();
  if (s.memEnabled && d.count >= Math.max(3, s.memEvery || 15)) igRunMemory(false);
 } catch (e) { console.error(`[${IG_NAME}] onMessage`, e); }
}
function igOnChatChanged() {
 try { igRefreshIcon(); if (igPanelOpen) { igRefreshPanel(); igRenderBody('mem'); } } catch {}
}

/* ── หน้าตั้งค่า ────────────────────────────────────────── */
function igSettingsHTML() {
 const s = igSettings();
 const row = (id, label, hint, checked) => `
  <label class="ig-set-row"><span><b>${igEsc(label)}</b>${hint ? `<i>${igEsc(hint)}</i>` : ''}</span>
  <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}></label>`;
 const num = (id, label, hint, val, min, max) => `
  <label class="ig-set-row"><span><b>${igEsc(label)}</b>${hint ? `<i>${igEsc(hint)}</i>` : ''}</span>
  <input type="number" id="${id}" value="${val}" min="${min}" max="${max}"></label>`;
 return `
 <div class="iglass-settings">
  <div class="inline-drawer">
   <div class="inline-drawer-toggle inline-drawer-header">
    <b>iGlass Status</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
   </div>
   <div class="inline-drawer-content">
    <div class="ig-ver">เวอร์ชัน ${IG_VER} · ถ้าเลขนี้ไม่ตรงกับที่เพิ่งอัปเดต แปลว่ายังโหลดไฟล์เก่าอยู่</div>
    ${row('ig-s-enabled', 'เปิดใช้งาน', 'ปิดแล้วไม่ทำอะไรเลย', s.enabled)}
    ${row('ig-s-icon', 'แสดงไอคอนลอย', 'ลากย้ายได้ แตะเพื่อเปิดแถบสถานะ', s.showIcon)}
    ${num('ig-s-size', 'ขนาดไอคอน', 'พิกเซล', s.iconSize, 36, 92)}
    <hr>
    ${row('ig-s-inject', 'ส่งสถานะเข้าบทโรล', 'ปิดแล้วไม่กินโทเคนเลย แต่ยังจดบันทึกให้', s.injectEnabled)}
    ${row('ig-s-rel', 'ระบบความสัมพันธ์', '100 ระดับ ส่งเข้า prompt แค่ชื่อระดับเดียว', s.relEnabled)}
    ${row('ig-s-mem', 'ความทรงจำสำคัญ', 'สรุปเป็นคีย์เวิร์ดสั้น ไม่ใช่ประโยคยาว', s.memEnabled)}
    ${num('ig-s-every', 'สรุปทุกกี่ข้อความ', 'ยิ่งมากยิ่งประหยัด แนะนำ 15', s.memEvery, 5, 100)}
    ${num('ig-s-meminj', 'ส่งความทรงจำเข้า prompt กี่รายการ', 'มากกว่านี้กินโทเคนเพิ่ม', s.memInject, 0, 20)}
    ${row('ig-s-cal', 'ปฏิทินเนื้อเรื่อง', 'ตรวจตามวันในเรื่อง ไม่ใช่ทุกข้อความ', s.calEnabled)}
    ${num('ig-s-caldays', 'ตรวจปฏิทินทุกกี่วันในเรื่อง', 'ค่าเริ่มต้น 3', s.calEveryDays, 1, 30)}
    ${num('ig-s-calinj', 'ส่งกำหนดการเข้า prompt กี่รายการ', '', s.calInject, 0, 10)}
    ${row('ig-s-motion', 'ลดการเคลื่อนไหว', 'ปิดอนิเมชันเด้ง', s.reduceMotion)}
    <div class="ig-set-acts">
     <input id="ig-s-open" class="menu_button" type="button" value="เปิดแถบสถานะ">
     <input id="ig-s-mem-now" class="menu_button" type="button" value="สรุปเดี๋ยวนี้">
     <input id="ig-s-cal-now" class="menu_button" type="button" value="สร้างปฏิทิน">
     <input id="ig-s-reset" class="menu_button" type="button" value="ล้างข้อมูลตัวนี้">
    </div>
    <div class="ig-ver">ตัวละครที่เปิดอยู่: <b id="ig-s-who">-</b></div>
   </div>
  </div>
 </div>`;
}

function igBindSettings() {
 const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
 const chk = (id, key, after) => on(id, 'input', e => { const s = igSettings(); s[key] = !!e.target.checked; igSave(); if (after) after(); });
 const nmb = (id, key, min, max, after) => on(id, 'input', e => {
  const s = igSettings(); s[key] = igClamp(parseInt(e.target.value, 10) || IG_DEFAULTS[key], min, max); igSave(); if (after) after();
 });
 chk('ig-s-enabled', 'enabled', igApplyPos);
 chk('ig-s-icon', 'showIcon', igApplyPos);
 nmb('ig-s-size', 'iconSize', 36, 92, igApplyPos);
 chk('ig-s-inject', 'injectEnabled');
 chk('ig-s-rel', 'relEnabled');
 chk('ig-s-mem', 'memEnabled');
 nmb('ig-s-every', 'memEvery', 5, 100);
 nmb('ig-s-meminj', 'memInject', 0, 20);
 chk('ig-s-cal', 'calEnabled');
 nmb('ig-s-caldays', 'calEveryDays', 1, 30);
 nmb('ig-s-calinj', 'calInject', 0, 10);
 chk('ig-s-motion', 'reduceMotion');
 on('ig-s-open', 'click', () => igTogglePanel(true));
 on('ig-s-mem-now', 'click', () => igRunMemory(true));
 on('ig-s-cal-now', 'click', () => igRunCalendar(true));
 on('ig-s-reset', 'click', () => {
  const k = igCharKey();
  if (!k) return;
  if (!confirm('ล้างความสัมพันธ์ ความทรงจำ และปฏิทินของตัวละครนี้?')) return;
  delete igSettings().data[k];
  igSave(); igRefreshIcon(); if (igPanelOpen) { igRefreshPanel(); igRenderBody('mem'); }
  try { toastr.success('ล้างแล้ว', 'iGlass Status'); } catch {}
 });
 const who = document.getElementById('ig-s-who');
 if (who) who.textContent = igCharName();
}

/* ── เริ่มทำงาน ─────────────────────────────────────────── */
function igWaitFor(sel, done) {
 let n = 0;
 const t = setInterval(() => {
  if (document.querySelector(sel)) { clearInterval(t); done(); }
  else if (++n > 60) { clearInterval(t); window.IGLASS_LOADED = 'no-host'; console.error(`[${IG_NAME}] ไม่เจอจุดติดตั้ง ${sel}`); }
 }, 500);
}

igWaitFor('#extensions_settings2', () => {
 try {
  const wrap = document.createElement('div');
  wrap.innerHTML = igSettingsHTML();
  document.getElementById('extensions_settings2').appendChild(wrap.firstElementChild);
  igBindSettings();
  igBuild();
  const c = igCtx();
  if (c && c.eventSource && c.event_types) {
   const et = c.event_types;
   if (et.MESSAGE_RECEIVED) c.eventSource.on(et.MESSAGE_RECEIVED, igOnMessage);
   if (et.CHAT_CHANGED) c.eventSource.on(et.CHAT_CHANGED, igOnChatChanged);
  }
  window.IGLASS_LOADED = 'ok';
  console.log(`[${IG_NAME}] ✅ ${IG_VER} พร้อมใช้งาน`);
 } catch (e) {
  window.IGLASS_LOADED = 'error';
  console.error(`[${IG_NAME}] ❌`, e);
  try { toastr.error(String(e.message || e), IG_NAME); } catch {}
 }
});

window.IGLASS_DIAG = () => {
 const s = igSettings();
 const d = igData();
 const r = {
  โหลด: window.IGLASS_LOADED, เวอร์ชัน: IG_VER,
  ตัวละคร: igCharName(), คีย์: igCharKey() || '(ไม่มี)',
  ความสัมพันธ์: d ? `${Math.round(d.rel)} ${igTierName(d.rel)}` : '-',
  ความทรงจำ: d ? d.mem.length : 0, ปฏิทิน: d ? d.cal.length : 0,
  นับข้อความ: d ? d.count : 0, วันในเรื่อง: d ? (d.day || '-') : '-',
  ส่งเข้าprompt: s.injectEnabled, ขนาดก้อน: igBuildBlock().length + ' ตัวอักษร',
 };
 console.table(r); return r;
};
window.IGLASS_OPEN = () => igTogglePanel(true);
