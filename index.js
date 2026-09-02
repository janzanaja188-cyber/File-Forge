/* File Forge — SillyTavern extension
 * ให้โมเดลใน ST อ่านและแก้ไฟล์ แล้วส่งกลับมาให้โหลด หรือเขียนทับไฟล์เดิม
 *
 * หลักคิดที่ทำให้ประหยัดโทเคนและไม่พัง
 *  1 ไม่ส่งไฟล์ทั้งไฟล์เข้าโมเดล ส่วนขยายค้นหาเองในเครื่อง แล้วส่งเฉพาะท่อนที่เกี่ยว
 *  2 โมเดลไม่พิมพ์ไฟล์ใหม่ แต่ส่งคำสั่งค้นหา-แทนที่กลับมา ส่วนขยายเป็นคนลงมือแก้
 *  3 ข้อความค้นหาต้องเจอ "ที่เดียวเท่านั้น" ถ้าไม่เจอหรือเจอหลายที่ ปฏิเสธทันที
 *  4 สำรองต้นฉบับไว้เสมอ ย้อนกลับได้ตลอด
 *
 * ไม่ต้องลง server plugin เพราะทำงานในเบราว์เซอร์ล้วน
 */

const FF_NAME = 'file-forge';
const FF_VER = '1.0.0';
window.FILEFORGE_LOADED = 'parsed';

const FF_DEFAULTS = {
 enabled: true,
 injectGuide: true,      // ส่งคู่มือรูปแบบคำสั่งเข้า prompt
 autoDetect: true,       // สแกนคำตอบของบอทหาคำสั่งแก้ไขอัตโนมัติ
 sliceLines: 80,         // ส่งเข้าโมเดลกี่บรรทัดต่อท่อน
 maxSlices: 3,           // ส่งได้กี่ท่อนต่อครั้ง
 confirmApply: true,     // โชว์ diff ให้ยืนยันก่อนแก้จริง
 backupOnSave: true,
};

let ffFiles = [];        // [{id,name,text,orig,handle}]
let ffActive = null;     // id ไฟล์ที่เลือกอยู่
let ffSlices = [];       // ท่อนที่จะส่งเข้า prompt รอบถัดไป
let ffPending = null;    // ชุดคำสั่งที่รอยืนยัน

/* ── พื้นฐาน ─────────────────────────────────────────── */
function ffCtx() { try { return SillyTavern.getContext(); } catch { return null; } }
function ffEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ffToast(t, m, k) { try { toastr[k || 'info'](m, t); } catch { console.log(`[${FF_NAME}] ${t} ${m}`); } }

function ffSettings() {
 const c = ffCtx();
 if (!c || !c.extensionSettings) return Object.assign({}, FF_DEFAULTS);
 if (!c.extensionSettings[FF_NAME]) c.extensionSettings[FF_NAME] = {};
 const s = c.extensionSettings[FF_NAME];
 for (const k of Object.keys(FF_DEFAULTS)) if (s[k] === undefined) s[k] = FF_DEFAULTS[k];
 return s;
}
function ffSave() { try { ffCtx()?.saveSettingsDebounced(); } catch {} }
function ffFile(id) { return ffFiles.find(f => f.id === (id || ffActive)) || null; }
function ffLines(t) { return String(t || '').split('\n'); }

/* ── รับไฟล์เข้ามา ───────────────────────────────────── */
async function ffPickPlain() {
 const inp = document.createElement('input');
 inp.type = 'file';
 inp.multiple = true;
 inp.accept = '.js,.jsx,.ts,.css,.html,.json,.md,.txt,.py,.yaml,.yml,.xml,.csv';
 inp.onchange = async e => {
  const list = Array.from(e.target.files || []);
  for (const f of list) {
   const text = await f.text();
   ffAdd(f.name, text, null);
  }
  ffRender();
  ffToast('File Forge', `รับไฟล์แล้ว ${list.length} ไฟล์`, 'success');
 };
 inp.click();
}

/** เลือกแบบที่เขียนทับไฟล์เดิมได้ ใช้ได้เฉพาะ Chrome Edge Kiwi และต้องเป็น https */
async function ffPickWritable() {
 if (typeof window.showOpenFilePicker !== 'function') {
  ffToast('เขียนทับไม่ได้บนเบราว์เซอร์นี้',
   'Safari กับ Firefox ยังไม่รองรับ ใช้ปุ่มเลือกไฟล์ธรรมดาแทน แล้วดาวน์โหลดผลลัพธ์', 'warning');
  return;
 }
 try {
  const handles = await window.showOpenFilePicker({ multiple: true });
  for (const h of handles) {
   const f = await h.getFile();
   ffAdd(f.name, await f.text(), h);
  }
  ffRender();
  ffToast('File Forge', 'รับไฟล์แล้ว เขียนทับได้เลย', 'success');
 } catch (e) {
  if (e && e.name === 'AbortError') return;
  console.error(`[${FF_NAME}] pick`, e);
  ffToast('เลือกไฟล์ไม่สำเร็จ', String(e.message || e), 'error');
 }
}

function ffAdd(name, text, handle) {
 const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
 ffFiles.push({ id, name, text, orig: text, handle: handle || null });
 ffActive = id;
}

/* ── ค้นหาในเครื่อง แล้วส่งเฉพาะท่อนที่เกี่ยว ────────── */
function ffSearch(needle, maxHits) {
 const f = ffFile();
 if (!f || !needle) return [];
 const lines = ffLines(f.text);
 const q = needle.toLowerCase();
 const hits = [];
 for (let i = 0; i < lines.length && hits.length < (maxHits || 20); i++) {
  if (lines[i].toLowerCase().includes(q)) hits.push({ line: i + 1, text: lines[i].trim().slice(0, 120) });
 }
 return hits;
}

function ffMakeSlice(centerLine) {
 const f = ffFile();
 if (!f) return null;
 const s = ffSettings();
 const lines = ffLines(f.text);
 const half = Math.floor((s.sliceLines || 80) / 2);
 const from = Math.max(1, centerLine - half);
 const to = Math.min(lines.length, centerLine + half);
 return { file: f.name, from, to, text: lines.slice(from - 1, to).join('\n') };
}

/** โครงสร้างไฟล์แบบย่อ ใช้โทเคนน้อยมาก ให้โมเดลรู้ว่ามีอะไรอยู่ตรงไหน */
function ffOutline(limit) {
 const f = ffFile();
 if (!f) return [];
 const lines = ffLines(f.text);
 const rx = /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(|class\s+([A-Za-z_$][\w$]*)|#{1,4}\s+(.+)|\.([a-z][\w-]*)\s*\{)/;
 const out = [];
 for (let i = 0; i < lines.length && out.length < (limit || 80); i++) {
  const m = lines[i].match(rx);
  if (m) out.push({ line: i + 1, name: (m[1] || m[2] || m[3] || m[4] || m[5] || '').trim().slice(0, 60) });
 }
 return out;
}

/* ── ส่งเข้า prompt ──────────────────────────────────── */
const FF_GUIDE = [
 '[โหมดแก้ไฟล์] ผู้ใช้เปิดไฟล์ไว้ให้คุณดูข้างล่าง คุณแก้ไฟล์ได้โดยตอบเป็นบล็อกคำสั่ง',
 'กติกาที่ห้ามผิด',
 '  1 ห้ามพิมพ์ไฟล์ใหม่ทั้งไฟล์ ให้ส่งเฉพาะส่วนที่แก้',
 '  2 ข้อความใน FIND ต้องคัดลอกจากไฟล์แบบตรงตัวทุกตัวอักษร รวมช่องว่างและการขึ้นบรรทัด',
 '  3 ข้อความใน FIND ต้องยาวพอที่จะมีอยู่ที่เดียวในไฟล์ ถ้าสั้นไปจะถูกปฏิเสธ',
 '  4 ถ้าไม่แน่ใจว่าข้อความตรงไหม ให้ถามผู้ใช้ก่อน อย่าเดา',
 'รูปแบบ ใช้ได้หลายบล็อกในคำตอบเดียว',
 '```ff-patch',
 'FIND',
 '<ข้อความเดิมแบบตรงตัว>',
 'REPLACE',
 '<ข้อความใหม่>',
 '```',
 'ถ้าจะสร้างไฟล์ใหม่ทั้งไฟล์ให้ใช้',
 '```ff-new ชื่อไฟล์.txt',
 '<เนื้อไฟล์>',
 '```',
].join('\n');

function ffBuildBlock() {
 const s = ffSettings();
 if (!s.enabled) return '';
 const f = ffFile();
 if (!f) return '';
 const parts = [];
 if (s.injectGuide) parts.push(FF_GUIDE);
 parts.push(`ไฟล์ที่เปิดอยู่: ${f.name} · ${ffLines(f.text).length} บรรทัด · ${f.text.length} ตัวอักษร`);
 if (!ffSlices.length) {
  const out = ffOutline(40);
  if (out.length) parts.push('โครงไฟล์ (บรรทัด: ชื่อ)\n' + out.map(o => `${o.line}: ${o.name}`).join('\n'));
  parts.push('ยังไม่ได้เปิดเนื้อไฟล์ส่วนไหนให้ดู บอกผู้ใช้ว่าอยากดูตรงไหน แล้วให้เขากดค้นหาส่งเข้ามา');
 } else {
  ffSlices.slice(0, s.maxSlices || 3).forEach(sl => {
   parts.push(`--- ${sl.file} บรรทัด ${sl.from} ถึง ${sl.to} ---\n${sl.text}`);
  });
 }
 return parts.join('\n\n');
}

window.fileForgeInterceptor = function (chat) {
 try {
  const s = ffSettings();
  if (!s.enabled || !ffFile() || !Array.isArray(chat)) return;
  const block = ffBuildBlock();
  if (block) chat.push({ is_user: false, is_system: true, mes: block });
 } catch (e) { console.error(`[${FF_NAME}] interceptor`, e); }
};

/* ── แกะคำสั่งจากคำตอบของบอท ─────────────────────────── */
function ffParsePatches(raw) {
 const text = String(raw || '');
 const out = { patches: [], news: [] };
 const rxP = /```ff-patch\s*\n([\s\S]*?)```/gi;
 let m;
 while ((m = rxP.exec(text))) {
  const body = m[1];
  const i = body.search(/^\s*FIND\s*$/im);
  const j = body.search(/^\s*REPLACE\s*$/im);
  if (i < 0 || j < 0 || j < i) continue;
  const findPart = body.slice(body.indexOf('\n', i) + 1, j).replace(/\n$/, '');
  const repPart = body.slice(body.indexOf('\n', j) + 1).replace(/\n$/, '');
  if (!findPart.trim()) continue;
  out.patches.push({ find: findPart, replace: repPart });
 }
 const rxN = /```ff-new\s+([^\n]+)\n([\s\S]*?)```/gi;
 while ((m = rxN.exec(text))) out.news.push({ name: m[1].trim(), text: m[2].replace(/\n$/, '') });
 return out;
}

/** ตรวจก่อนแก้จริง คืนผลรายอันพร้อมเหตุผลเมื่อไม่ผ่าน */
function ffCheck(patches) {
 const f = ffFile();
 if (!f) return [];
 return patches.map((p, i) => {
  const n = f.text.split(p.find).length - 1;
  if (n === 0) return { i, ok: false, why: 'หาข้อความเดิมไม่เจอ อาจคัดลอกมาไม่ตรงตัว', p };
  if (n > 1) return { i, ok: false, why: `เจอ ${n} ที่ ต้องระบุให้ยาวขึ้นจนเหลือที่เดียว`, p };
  const at = f.text.slice(0, f.text.indexOf(p.find)).split('\n').length;
  return { i, ok: true, at, p };
 });
}

function ffApply(results) {
 const f = ffFile();
 if (!f) return 0;
 let n = 0;
 results.filter(r => r.ok).forEach(r => {
  // ตรวจซ้ำก่อนแก้จริง เพราะการแก้อันก่อนหน้าอาจทำให้ข้อความเปลี่ยน
  if (f.text.split(r.p.find).length - 1 !== 1) { r.ok = false; r.why = 'ข้อความเปลี่ยนไปหลังแก้อันก่อนหน้า'; return; }
  f.text = f.text.replace(r.p.find, r.p.replace);
  n++;
 });
 return n;
}

function ffHandleReply(raw) {
 const s = ffSettings();
 if (!s.enabled || !s.autoDetect || !ffFile()) return;
 const got = ffParsePatches(raw);
 if (got.news.length) {
  got.news.forEach(nf => ffDownload(nf.name, nf.text));
  ffToast('File Forge', `บอทสร้างไฟล์ใหม่ ${got.news.length} ไฟล์ ดาวน์โหลดแล้ว`, 'success');
 }
 if (!got.patches.length) return;
 const results = ffCheck(got.patches);
 ffPending = results;
 if (s.confirmApply) ffShowDiff(results);
 else {
  const n = ffApply(results);
  ffRender();
  ffToast('File Forge', `แก้แล้ว ${n} จุด จากทั้งหมด ${results.length}`, n ? 'success' : 'warning');
 }
}

/* ── หน้าต่าง diff ───────────────────────────────────── */
function ffShowDiff(results) {
 const old = document.getElementById('ff-diag');
 if (old) old.remove();
 const dlg = document.createElement('dialog');
 dlg.id = 'ff-diag';
 dlg.className = 'ff-dlg';
 const okN = results.filter(r => r.ok).length;
 const head = document.createElement('div');
 head.className = 'ff-dlg-head';
 head.textContent = `บอทเสนอแก้ ${results.length} จุด · ผ่านการตรวจ ${okN}`;
 const body = document.createElement('div');
 body.className = 'ff-dlg-body';
 results.forEach((r, i) => {
  const box = document.createElement('div');
  box.className = 'ff-diff' + (r.ok ? '' : ' bad');
  const t = document.createElement('div');
  t.className = 'ff-diff-t';
  t.textContent = r.ok ? `จุดที่ ${i + 1} · บรรทัด ~${r.at}` : `จุดที่ ${i + 1} · ใช้ไม่ได้ — ${r.why}`;
  const del = document.createElement('pre');
  del.className = 'ff-del';
  del.textContent = r.p.find.slice(0, 700);
  const add = document.createElement('pre');
  add.className = 'ff-add';
  add.textContent = r.p.replace.slice(0, 700);
  box.append(t, del, add);
  body.appendChild(box);
 });
 const acts = document.createElement('div');
 acts.className = 'ff-dlg-acts';
 const no = document.createElement('button');
 no.className = 'ff-btn';
 no.textContent = 'ไม่แก้';
 no.onclick = () => { dlg.close(); dlg.remove(); };
 const yes = document.createElement('button');
 yes.className = 'ff-btn primary';
 yes.textContent = `แก้ ${okN} จุดนี้`;
 yes.disabled = !okN;
 yes.onclick = () => {
  const n = ffApply(results);
  dlg.close(); dlg.remove();
  ffRender();
  ffToast('File Forge', `แก้แล้ว ${n} จุด`, n ? 'success' : 'warning');
 };
 acts.append(no, yes);
 dlg.append(head, body, acts);
 document.body.appendChild(dlg);
 dlg.showModal();
}

/* ── บันทึกผล ────────────────────────────────────────── */
function ffDownload(name, text) {
 const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
 const a = document.createElement('a');
 a.href = URL.createObjectURL(blob);
 a.download = name;
 document.body.appendChild(a);
 a.click();
 setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

async function ffSaveInPlace() {
 const f = ffFile();
 if (!f) return;
 if (!f.handle) { ffToast('เขียนทับไม่ได้', 'ไฟล์นี้เปิดมาแบบอ่านอย่างเดียว ใช้ปุ่มดาวน์โหลดแทน', 'warning'); return; }
 try {
  const s = ffSettings();
  if (s.backupOnSave) ffDownload(f.name.replace(/(\.[^.]+)?$/, '.bak$1'), f.orig);
  const perm = await f.handle.queryPermission?.({ mode: 'readwrite' });
  if (perm !== 'granted') {
   const req = await f.handle.requestPermission?.({ mode: 'readwrite' });
   if (req !== 'granted') { ffToast('ไม่ได้รับสิทธิ์เขียนไฟล์', 'กดอนุญาตเมื่อเบราว์เซอร์ถาม', 'warning'); return; }
  }
  const w = await f.handle.createWritable();
  await w.write(f.text);
  await w.close();
  f.orig = f.text;
  ffRender();
  ffToast('File Forge', 'เขียนทับไฟล์เดิมแล้ว', 'success');
 } catch (e) {
  console.error(`[${FF_NAME}] save`, e);
  ffToast('เขียนไฟล์ไม่สำเร็จ', String(e.message || e), 'error');
 }
}

/* ── หน้าตั้งค่า ─────────────────────────────────────── */
function ffPanelHTML() {
 const s = ffSettings();
 const sw = (id, l, h, v) => `<label class="ff-row"><span><b>${ffEsc(l)}</b><i>${ffEsc(h)}</i></span><input type="checkbox" id="${id}" ${v ? 'checked' : ''}></label>`;
 return `
 <div class="fileforge-settings">
  <div class="inline-drawer">
   <div class="inline-drawer-toggle inline-drawer-header">
    <b>File Forge</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
   </div>
   <div class="inline-drawer-content">
    <div class="ff-ver">เวอร์ชัน ${FF_VER} · ถ้าเลขไม่ตรงกับที่เพิ่งอัปเดต แปลว่ายังโหลดไฟล์เก่า</div>
    <div class="ff-btn-row">
     <input class="menu_button" type="button" id="ff-pick" value="เลือกไฟล์">
     <input class="menu_button" type="button" id="ff-pickw" value="เลือกแบบเขียนทับได้">
    </div>
    <div class="ff-hint">ปุ่มขวาใช้ได้บน Chrome Edge Kiwi เท่านั้น เลือกแล้วเขียนทับไฟล์เดิมได้เลย · Safari ให้ใช้ปุ่มซ้ายแล้วดาวน์โหลดผลลัพธ์</div>
    <div id="ff-list" class="ff-list"></div>
    <div id="ff-tools" class="ff-tools" hidden>
     <div class="ff-btn-row">
      <input class="text_pole ff-q" id="ff-q" placeholder="ค้นหาในไฟล์ เช่น ชื่อฟังก์ชัน">
      <input class="menu_button" type="button" id="ff-find" value="ค้นหา">
     </div>
     <div id="ff-hits" class="ff-hits"></div>
     <div id="ff-slices" class="ff-slices"></div>
     <div class="ff-btn-row">
      <input class="menu_button" type="button" id="ff-dl" value="ดาวน์โหลดผลลัพธ์">
      <input class="menu_button" type="button" id="ff-save" value="เขียนทับไฟล์เดิม">
      <input class="menu_button" type="button" id="ff-revert" value="ย้อนกลับต้นฉบับ">
     </div>
    </div>
    <hr>
    ${sw('ff-s-enabled', 'เปิดใช้งาน', 'ปิดแล้วไม่ส่งอะไรเข้า prompt เลย', s.enabled)}
    ${sw('ff-s-guide', 'ส่งคู่มือรูปแบบให้โมเดล', 'ปิดได้ถ้าโมเดลจำรูปแบบได้แล้ว ประหยัดโทเคน', s.injectGuide)}
    ${sw('ff-s-auto', 'สแกนคำตอบหาคำสั่งแก้อัตโนมัติ', '', s.autoDetect)}
    ${sw('ff-s-confirm', 'ให้ดูก่อนแก้ทุกครั้ง', 'แนะนำให้เปิดไว้', s.confirmApply)}
    ${sw('ff-s-backup', 'ดาวน์โหลดสำรองก่อนเขียนทับ', '', s.backupOnSave)}
   </div>
  </div>
 </div>`;
}

function ffRender() {
 const list = document.getElementById('ff-list');
 if (!list) return;
 list.innerHTML = '';
 if (!ffFiles.length) {
  const e = document.createElement('div');
  e.className = 'ff-hint';
  e.textContent = 'ยังไม่ได้เลือกไฟล์';
  list.appendChild(e);
 }
 ffFiles.forEach(f => {
  const row = document.createElement('div');
  row.className = 'ff-file' + (f.id === ffActive ? ' on' : '');
  const nm = document.createElement('span');
  nm.className = 'ff-file-n';
  const dirty = f.text !== f.orig;
  nm.textContent = `${f.name}${dirty ? ' ●' : ''}`;
  const meta = document.createElement('span');
  meta.className = 'ff-file-m';
  meta.textContent = `${ffLines(f.text).length} บรรทัด${f.handle ? ' · เขียนทับได้' : ''}`;
  row.append(nm, meta);
  row.onclick = () => { ffActive = f.id; ffSlices = []; ffRender(); };
  list.appendChild(row);
 });
 const tools = document.getElementById('ff-tools');
 if (tools) tools.hidden = !ffFile();
 const sl = document.getElementById('ff-slices');
 if (sl) {
  sl.innerHTML = '';
  if (ffSlices.length) {
   const t = document.createElement('div');
   t.className = 'ff-hint';
   t.textContent = 'ท่อนที่จะส่งให้โมเดลรอบถัดไป: ' + ffSlices.map(x => `${x.from}-${x.to}`).join(' · ');
   sl.appendChild(t);
   const clr = document.createElement('button');
   clr.className = 'ff-mini';
   clr.textContent = 'ล้างท่อนที่เลือก';
   clr.onclick = () => { ffSlices = []; ffRender(); };
   sl.appendChild(clr);
  }
 }
}

function ffBind() {
 const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
 const chk = (id, key) => { const el = document.getElementById(id); if (el) el.addEventListener('input', e => { ffSettings()[key] = !!e.target.checked; ffSave(); }); };
 on('ff-pick', ffPickPlain);
 on('ff-pickw', ffPickWritable);
 on('ff-find', () => {
  const q = document.getElementById('ff-q')?.value.trim();
  const box = document.getElementById('ff-hits');
  if (!box) return;
  box.innerHTML = '';
  if (!q) return;
  const hits = ffSearch(q, 15);
  if (!hits.length) { const e = document.createElement('div'); e.className = 'ff-hint'; e.textContent = 'ไม่เจอ'; box.appendChild(e); return; }
  hits.forEach(h => {
   const r = document.createElement('button');
   r.className = 'ff-hit';
   r.textContent = `${h.line}: ${h.text}`;
   r.onclick = () => {
    const sl = ffMakeSlice(h.line);
    if (!sl) return;
    if (ffSlices.length >= (ffSettings().maxSlices || 3)) ffSlices.shift();
    ffSlices.push(sl);
    ffRender();
    ffToast('File Forge', `เลือกท่อนบรรทัด ${sl.from}-${sl.to} แล้ว พิมพ์บอกบอทได้เลยว่าจะแก้อะไร`, 'success');
   };
   box.appendChild(r);
  });
 });
 on('ff-dl', () => { const f = ffFile(); if (f) ffDownload(f.name, f.text); });
 on('ff-save', ffSaveInPlace);
 on('ff-revert', () => {
  const f = ffFile();
  if (!f) return;
  if (!confirm('ย้อนกลับเป็นต้นฉบับ ทิ้งการแก้ทั้งหมด?')) return;
  f.text = f.orig; ffRender(); ffToast('File Forge', 'ย้อนกลับแล้ว', 'success');
 });
 chk('ff-s-enabled', 'enabled');
 chk('ff-s-guide', 'injectGuide');
 chk('ff-s-auto', 'autoDetect');
 chk('ff-s-confirm', 'confirmApply');
 chk('ff-s-backup', 'backupOnSave');
}

/* ── เริ่มทำงาน ──────────────────────────────────────── */
function ffWaitFor(sel, done) {
 let n = 0;
 const t = setInterval(() => {
  if (document.querySelector(sel)) { clearInterval(t); done(); }
  else if (++n > 60) { clearInterval(t); window.FILEFORGE_LOADED = 'no-host'; console.error(`[${FF_NAME}] ไม่เจอจุดติดตั้ง`); }
 }, 500);
}

ffWaitFor('#extensions_settings2', () => {
 try {
  const wrap = document.createElement('div');
  wrap.innerHTML = ffPanelHTML();
  document.getElementById('extensions_settings2').appendChild(wrap.firstElementChild);
  ffBind();
  ffRender();
  const c = ffCtx();
  if (c && c.eventSource && c.event_types && c.event_types.MESSAGE_RECEIVED) {
   c.eventSource.on(c.event_types.MESSAGE_RECEIVED, () => {
    try {
     const chat = c.chat || [];
     const last = chat[chat.length - 1];
     if (last && !last.is_user && last.mes) ffHandleReply(last.mes);
    } catch (e) { console.error(`[${FF_NAME}] reply`, e); }
   });
  }
  window.FILEFORGE_LOADED = 'ok';
  console.log(`[${FF_NAME}] ✅ ${FF_VER} พร้อมใช้งาน`);
 } catch (e) {
  window.FILEFORGE_LOADED = 'error';
  console.error(`[${FF_NAME}] ❌`, e);
  ffToast(FF_NAME, String(e.message || e), 'error');
 }
});

window.FILEFORGE_DIAG = () => {
 const f = ffFile();
 const r = {
  โหลด: window.FILEFORGE_LOADED, เวอร์ชัน: FF_VER,
  ไฟล์ทั้งหมด: ffFiles.length,
  ไฟล์ที่เลือก: f ? f.name : '-',
  บรรทัด: f ? ffLines(f.text).length : 0,
  แก้ไปแล้ว: f ? (f.text !== f.orig ? 'ใช่' : 'ยัง') : '-',
  เขียนทับได้: f ? !!f.handle : false,
  ท่อนที่จะส่ง: ffSlices.length,
  ขนาดก้อนที่ส่ง: ffBuildBlock().length + ' ตัวอักษร',
 };
 console.table(r); return r;
};
