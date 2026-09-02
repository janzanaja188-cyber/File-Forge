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
 botSearch: true,        // ให้บอทสั่งค้นหาและเปิดดูโค้ดเองได้
 autoFeed: true,         // พอโหลดท่อนเสร็จ ส่งให้บอทดูต่อทันทีโดยไม่ต้องกด
 autoFeedMax: 4,         // กันวนไม่รู้จบ ขอได้ติดกันกี่ครั้ง
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

/* ══ บันทึกการทำงาน — โชว์ว่าทำอะไรไปบ้าง เหมือนที่คนแก้โค้ดควรรายงาน ══ */
let ffLog = [];
function ffPush(kind, msg, detail) {
 ffLog.push({ kind, msg, detail: detail || '', ts: Date.now() });
 if (ffLog.length > 300) ffLog = ffLog.slice(-300);
}

/** ★ ตรวจโครงสร้างไฟล์ก่อนเซฟ
 * ไม่ใช่ตัวแปลภาษาเต็มรูปแบบ แต่จับบั๊กที่เกิดจากการแพตช์ผิดได้เกือบทั้งหมด
 * คือวงเล็บหรือปีกกาไม่ครบ ซึ่งเกิดตอนแพตช์กลืนหัวฟังก์ชันไป
 * ข้ามเนื้อในสตริงและคอมเมนต์ ไม่งั้นจะเตือนผิดตลอด */
function ffBalance(text) {
 const src = String(text || '');
 const pairs = { '(': ')', '[': ']', '{': '}' };
 const close = { ')': '(', ']': '[', '}': '{' };
 const st = [];
 let i = 0, line = 1;
 let mode = null;   // null | ' | " | ` | // | /*
 while (i < src.length) {
  const c = src[i], n = src[i + 1];
  if (c === '\n') line++;
  if (mode === '//') { if (c === '\n') mode = null; i++; continue; }
  if (mode === '/*') { if (c === '*' && n === '/') { mode = null; i += 2; continue; } i++; continue; }
  if (mode === "'" || mode === '"' || mode === '`') {
   if (c === '\\') { i += 2; continue; }
   if (c === mode) mode = null;
   i++; continue;
  }
  if (c === '/' && n === '/') { mode = '//'; i += 2; continue; }
  if (c === '/' && n === '*') { mode = '/*'; i += 2; continue; }
  if (c === "'" || c === '"' || c === '`') { mode = c; i++; continue; }
  if (pairs[c]) { st.push({ c, line }); i++; continue; }
  if (close[c]) {
   const top = st.pop();
   if (!top || top.c !== close[c]) {
    return { ok: false, why: `เจอ ${c} เกินมาที่บรรทัด ${line}` + (top ? ` ไม่เข้าคู่กับ ${top.c} บรรทัด ${top.line}` : '') };
   }
   i++; continue;
  }
  i++;
 }
 if (mode === "'" || mode === '"' || mode === '`') return { ok: false, why: `เครื่องหมายคำพูด ${mode} เปิดค้างไว้ไม่ได้ปิด` };
 if (st.length) { const t = st[st.length - 1]; return { ok: false, why: `${t.c} ที่บรรทัด ${t.line} ไม่ได้ปิด` }; }
 return { ok: true, why: '' };
}
function ffIsCode(name) { return /\.(js|jsx|ts|tsx|json|css)$/i.test(String(name || '')); }
function ffFileByName(name) {
 const n = String(name || '').trim().toLowerCase();
 if (!n) return null;
 return ffFiles.find(f => f.name.toLowerCase() === n)
  || ffFiles.find(f => f.name.toLowerCase().endsWith(n))
  || null;
}
function ffChanged() { return ffFiles.filter(f => f.text !== f.orig); }

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
 ffFiles.push({ id, name, text, orig: text, handle: handle || null, edits: [] });
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
 '  5 ใส่ชื่อไฟล์ต่อท้าย ff-patch เสมอ ถ้าไม่ใส่จะใช้ไฟล์ที่เปิดอยู่',
 '  6 แก้เสร็จแล้วสรุปสั้น ๆ ว่าแก้อะไร ที่ไหน เพราะอะไร',
 'รูปแบบ ใช้ได้หลายบล็อกในคำตอบเดียว',
 '```ff-patch ชื่อไฟล์.js',
 'FIND',
 '<ข้อความเดิมแบบตรงตัว>',
 'REPLACE',
 '<ข้อความใหม่>',
 '```',
 'ถ้ายังไม่เห็นโค้ดที่ต้องการ สั่งเปิดดูเองได้ ไม่ต้องขอให้ผู้ใช้หา',
 '```ff-find',
 '<คำค้น เช่นชื่อฟังก์ชัน หนึ่งบรรทัดต่อหนึ่งคำ ใส่ได้หลายคำ>',
 '```',
 'หรือระบุเลขบรรทัดตรง ๆ',
 '```ff-show',
 '148-260',
 '```',
 'สั่งแล้วระบบจะเปิดโค้ดให้ดูในรอบถัดไปทันที แล้วค่อยส่ง ff-patch',
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
 // บอกให้ครบว่ามีไฟล์อะไรให้แก้บ้าง จะได้ระบุชื่อไฟล์ในคำสั่งได้ถูก
 parts.push('ไฟล์ที่เปิดไว้ทั้งหมด (ใส่ชื่อต่อท้าย ff-patch เพื่อระบุว่าจะแก้ไฟล์ไหน)\n' +
  ffFiles.map(x => `- ${x.name} · ${ffLines(x.text).length} บรรทัด${x.text !== x.orig ? ' · แก้ไปแล้ว' : ''}${x.id === ffActive ? ' · กำลังดูอยู่' : ''}`).join('\n'));
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
 const rxP = /```ff-patch[ \t]*([^\n]*)\n([\s\S]*?)```/gi;
 let m;
 while ((m = rxP.exec(text))) {
  const target = (m[1] || '').trim();
  const body = m[2];
  const i = body.search(/^\s*FIND\s*$/im);
  const j = body.search(/^\s*REPLACE\s*$/im);
  if (i < 0 || j < 0 || j < i) continue;
  const findPart = body.slice(body.indexOf('\n', i) + 1, j).replace(/\n$/, '');
  const repPart = body.slice(body.indexOf('\n', j) + 1).replace(/\n$/, '');
  if (!findPart.trim()) continue;
  out.patches.push({ find: findPart, replace: repPart, target });
 }
 const rxN = /```ff-new\s+([^\n]+)\n([\s\S]*?)```/gi;
 while ((m = rxN.exec(text))) out.news.push({ name: m[1].trim(), text: m[2].replace(/\n$/, '') });
 return out;
}

/** ตรวจก่อนแก้จริง คืนผลรายอันพร้อมเหตุผลเมื่อไม่ผ่าน */
/** ★ แกะคำสั่งที่บอทขอเปิดดูโค้ดเอง */
function ffParseAsks(raw) {
 const text = String(raw || '');
 const out = { finds: [], ranges: [], outline: false };
 let m;
 const rxF = /```ff-find\s*\n([\s\S]*?)```/gi;
 while ((m = rxF.exec(text))) {
  m[1].split(/\r?\n/).map(x => x.trim()).filter(Boolean).forEach(w => out.finds.push(w.slice(0, 80)));
 }
 const rxR = /```ff-show\s*\n([\s\S]*?)```/gi;
 while ((m = rxR.exec(text))) {
  m[1].split(/\r?\n/).forEach(ln => {
   const r = ln.match(/(\d+)\s*[-–ถึง]+\s*(\d+)/);
   if (r) out.ranges.push([+r[1], +r[2]]);
   else { const one = ln.match(/^\s*(\d+)\s*$/); if (one) out.ranges.push([+one[1], +one[1]]); }
  });
 }
 if (/```ff-outline/i.test(text)) out.outline = true;
 return out;
}

/** เปิดท่อนตามที่บอทขอ คืนจำนวนท่อนที่เปิดได้ */
function ffServeAsks(ask) {
 const f = ffFile();
 if (!f) return 0;
 const s = ffSettings();
 const cap = Math.max(1, s.maxSlices || 3);
 const lines = ffLines(f.text);
 const want = [];
 ask.finds.forEach(w => {
  const hits = ffSearch(w, 3);
  if (hits.length) want.push(ffMakeSlice(hits[0].line));
 });
 ask.ranges.forEach(([a, b]) => {
  const from = Math.max(1, Math.min(a, lines.length));
  const to = Math.max(from, Math.min(b, lines.length));
  want.push({ file: f.name, from, to, text: lines.slice(from - 1, to).join('\n') });
 });
 if (!want.length) return 0;
 // อันใหม่มาก่อน ตัดของเก่าทิ้งถ้าเกิน
 ffSlices = want.slice(0, cap);
 ffRender();
 return ffSlices.length;
}

/** ส่งให้บอทดูต่อทันที ใช้ช่องพิมพ์ของ ST เพราะเชื่อถือได้ข้ามเวอร์ชันกว่าการเรียก API ภายใน */
let ffAutoCount = 0;
function ffFeedBack(n) {
 const s = ffSettings();
 if (!s.autoFeed) {
  ffToast('File Forge', `บอทขอดูโค้ด เปิดให้แล้ว ${n} ท่อน · พิมพ์อะไรก็ได้ส่งไปให้มันดู`, 'info');
  return;
 }
 if (ffAutoCount >= (s.autoFeedMax || 4)) {
  ffToast('หยุดส่งอัตโนมัติ', 'บอทขอดูโค้ดติดกันหลายรอบเกินไป ลองบอกให้มันแก้เลย', 'warning');
  return;
 }
 ffAutoCount++;
 try {
  const ta = document.getElementById('send_textarea');
  const btn = document.getElementById('send_but');
  if (!ta || !btn) { ffToast('File Forge', `เปิดโค้ดให้แล้ว ${n} ท่อน ส่งข้อความต่อได้เลย`, 'info'); return; }
  if (ta.value.trim()) { ffToast('File Forge', `เปิดโค้ดให้แล้ว ${n} ท่อน กดส่งได้เลย`, 'info'); return; }
  ta.value = 'เปิดโค้ดที่ขอให้แล้ว ดูแล้วส่ง ff-patch มาได้เลย';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  setTimeout(() => btn.click(), 120);
 } catch (e) { console.error(`[${FF_NAME}] feed`, e); }
}

function ffCheck(patches) {
 return patches.map((p, i) => {
  const f = p.target ? ffFileByName(p.target) : ffFile();
  if (!f) return { i, ok: false, why: `ไม่พบไฟล์ ${p.target || '(ไม่ได้ระบุ)'} ในรายการที่เปิดไว้`, p, f: null };
  const n = f.text.split(p.find).length - 1;
  if (n === 0) return { i, ok: false, why: 'หาข้อความเดิมไม่เจอ อาจคัดลอกมาไม่ตรงตัว', p, f };
  if (n > 1) return { i, ok: false, why: `เจอ ${n} ที่ ต้องระบุให้ยาวขึ้นจนเหลือที่เดียว`, p, f };
  const at = f.text.slice(0, f.text.indexOf(p.find)).split('\n').length;
  return { i, ok: true, at, p, f };
 });
}

/** แก้จริง ตรวจโครงสร้างหลังแก้ทุกไฟล์ ถ้าพังให้ย้อนคืนทันที */
function ffApply(results) {
 const touched = new Map();
 let n = 0;
 results.filter(r => r.ok).forEach(r => {
  const f = r.f;
  if (!f) return;
  if (!touched.has(f.id)) touched.set(f.id, f.text);   // เก็บสภาพก่อนแก้ไว้ย้อน
  if (f.text.split(r.p.find).length - 1 !== 1) {
   r.ok = false; r.why = 'ข้อความเปลี่ยนไปหลังแก้อันก่อนหน้า';
   ffPush('warn', `ข้ามจุดที่ ${r.i + 1} ใน ${f.name}`, r.why);
   return;
  }
  f.text = f.text.replace(r.p.find, r.p.replace);
  if (!Array.isArray(f.edits)) f.edits = [];
  f.edits.push({ before: r.p.find, after: r.p.replace, ts: Date.now() });
  n++;
  ffPush('ok', `แก้ ${f.name} บรรทัด ~${r.at}`, r.p.replace.split('\n')[0].trim().slice(0, 80));
 });
 // ตรวจโครงสร้างทุกไฟล์ที่แตะ ถ้าพังย้อนคืนทั้งไฟล์
 touched.forEach((before, id) => {
  const f = ffFiles.find(x => x.id === id);
  if (!f || !ffIsCode(f.name)) return;
  const bal = ffBalance(f.text);
  if (!bal.ok) {
   f.text = before;
   f.edits = (f.edits || []).filter(e => before.includes(e.after));
   n = 0;
   ffPush('bad', `ย้อนคืน ${f.name} เพราะโครงสร้างพัง`, bal.why);
   ffToast('ย้อนคืนแล้ว', `${f.name}: ${bal.why} — ไม่แก้ดีกว่าแก้แล้วพัง`, 'error');
  } else {
   ffPush('ok', `ตรวจโครงสร้าง ${f.name} ผ่าน`, '');
  }
 });
 return n;
}

function ffHandleReply(raw) {
 const s = ffSettings();
 if (!s.enabled || !s.autoDetect || !ffFile()) return;
 // บอทขอเปิดดูโค้ดก่อน จัดให้แล้วส่งกลับไปให้ดูต่อ
 if (s.botSearch) {
  const ask = ffParseAsks(raw);
  if (ask.finds.length || ask.ranges.length) {
   const n = ffServeAsks(ask);
   if (n) { ffFeedBack(n); return; }
   ffToast('หาไม่เจอ', 'บอทขอดูโค้ดที่ไม่มีในไฟล์นี้ ลองบอกชื่อฟังก์ชันที่ถูกต้อง', 'warning');
  }
 }
 const got = ffParsePatches(raw);
 if (got.patches.length || got.news.length) ffAutoCount = 0;  // ได้ผลลัพธ์แล้ว รีเซ็ตตัวนับ
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

/** ★ หน้าต่างค้นหาแบบเต็ม แก้ปัญหารายการในแถบตั้งค่าบีบแคบจนมองไม่เห็น
 *  ใช้ dialog + showModal เพราะอยู่ใน top layer ไม่โดนธีมดันตำแหน่งเพี้ยน */
function ffOpenBrowser() {
 const f = ffFile();
 if (!f) { ffToast('File Forge', 'เลือกไฟล์ก่อน', 'warning'); return; }
 document.getElementById('ff-browser')?.remove();
 const dlg = document.createElement('dialog');
 dlg.id = 'ff-browser';
 dlg.className = 'ff-dlg ff-browser';

 const head = document.createElement('div');
 head.className = 'ff-dlg-head';
 head.textContent = `${f.name} · ${ffLines(f.text).length} บรรทัด`;

 const bar = document.createElement('div');
 bar.className = 'ff-brow-bar';
 const q = document.createElement('input');
 q.className = 'text_pole';
 q.placeholder = 'พิมพ์ชื่อฟังก์ชันหรือข้อความในไฟล์';
 const go = document.createElement('button');
 go.className = 'ff-btn';
 go.textContent = 'ค้นหา';
 const outBtn = document.createElement('button');
 outBtn.className = 'ff-btn';
 outBtn.textContent = 'ดูโครงไฟล์';
 bar.append(q, go, outBtn);

 const body = document.createElement('div');
 body.className = 'ff-dlg-body';

 const foot = document.createElement('div');
 foot.className = 'ff-dlg-acts';
 const info = document.createElement('span');
 info.className = 'ff-brow-info';
 const close = document.createElement('button');
 close.className = 'ff-btn primary';
 close.textContent = 'เสร็จแล้ว';
 close.onclick = () => { dlg.close(); dlg.remove(); ffRender(); };
 foot.append(info, close);

 const syncInfo = () => {
  info.textContent = ffSlices.length
   ? `เลือกไว้ ${ffSlices.length} ท่อน · ${ffSlices.map(x => `${x.from}-${x.to}`).join(' · ')}`
   : 'ยังไม่ได้เลือกท่อนไหน';
 };

 const paint = rows => {
  body.innerHTML = '';
  if (!rows.length) {
   const e = document.createElement('div');
   e.className = 'ff-hint';
   e.textContent = 'ไม่เจอ ลองคำอื่น';
   body.appendChild(e);
   return;
  }
  rows.forEach(h => {
   const card = document.createElement('button');
   card.className = 'ff-brow-hit';
   const ln = document.createElement('span');
   ln.className = 'ff-brow-ln';
   ln.textContent = 'บรรทัด ' + h.line;
   const tx = document.createElement('pre');
   tx.className = 'ff-brow-tx';
   // แสดงบริบทรอบ ๆ ให้เห็นชัด ไม่ใช่บรรทัดเดียวตัดท้าย
   const all = ffLines(f.text);
   tx.textContent = all.slice(Math.max(0, h.line - 2), h.line + 3).join('\n');
   card.append(ln, tx);
   card.onclick = () => {
    const sl = ffMakeSlice(h.line);
    if (!sl) return;
    if (ffSlices.some(x => x.from === sl.from && x.to === sl.to)) {
     ffSlices = ffSlices.filter(x => !(x.from === sl.from && x.to === sl.to));
     card.classList.remove('on');
    } else {
     if (ffSlices.length >= (ffSettings().maxSlices || 3)) ffSlices.shift();
     ffSlices.push(sl);
     card.classList.add('on');
    }
    syncInfo();
   };
   body.appendChild(card);
  });
 };

 go.onclick = () => paint(ffSearch(q.value.trim(), 40));
 q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
 outBtn.onclick = () => paint(ffOutline(120).map(o => ({ line: o.line, text: o.name })));

 dlg.append(head, bar, body, foot);
 document.body.appendChild(dlg);
 dlg.showModal();
 syncInfo();
 paint(ffOutline(120).map(o => ({ line: o.line, text: o.name })));
 setTimeout(() => q.focus(), 80);
}

/** ★ ดาวน์โหลดเฉพาะไฟล์ที่แก้จริง ไฟล์ที่ไม่ได้แตะจะไม่ส่งซ้ำ */
function ffDownloadChanged() {
 const list = ffChanged();
 if (!list.length) { ffToast('File Forge', 'ยังไม่มีไฟล์ไหนถูกแก้ ไม่มีอะไรให้โหลด', 'info'); return; }
 list.forEach((f, i) => setTimeout(() => ffDownload(f.name, f.text), i * 350));
 ffPush('ok', `ดาวน์โหลด ${list.length} ไฟล์ที่แก้แล้ว`, list.map(f => f.name).join(', '));
 ffToast('File Forge', `โหลดครบทั้งไฟล์ ${list.length} ไฟล์ · ข้ามไฟล์ที่ไม่ได้แตะ ${ffFiles.length - list.length} ไฟล์`, 'success');
}

async function ffSaveAllChanged() {
 const list = ffChanged().filter(f => f.handle);
 if (!list.length) { ffToast('File Forge', 'ไม่มีไฟล์ที่แก้แล้วและเขียนทับได้', 'info'); return; }
 const keep = ffActive;
 for (const f of list) { ffActive = f.id; await ffSaveInPlace(); }
 ffActive = keep;
 ffRender();
}

/** ★ หาว่าแต่ละการแก้ตอนนี้อยู่บรรทัดไหนในไฟล์ปัจจุบัน
 * คิดสด ๆ ตอนเปิดดู เพราะการแก้อันหลังทำให้เลขบรรทัดของอันก่อนเลื่อน
 * ถ้าหาไม่เจอแปลว่าถูกแก้ทับไปแล้ว บอกตรง ๆ ดีกว่าไฮไลท์ผิดที่ */
function ffEditSpans(f) {
 const out = [];
 (f.edits || []).forEach((e, i) => {
  const at = f.text.indexOf(e.after);
  if (at < 0) { out.push({ i, e, gone: true }); return; }
  const from = f.text.slice(0, at).split('\n').length;
  const to = from + e.after.split('\n').length - 1;
  out.push({ i, e, from, to, gone: false });
 });
 return out.sort((a, b) => (a.from || 0) - (b.from || 0));
}

/** ★ ตัวดูไฟล์ ไฮไลท์บรรทัดที่เพิ่งแก้ แตะเพื่อเทียบของเก่ากับของใหม่ */
function ffOpenViewer(fileId) {
 const f = ffFile(fileId);
 if (!f) { ffToast('File Forge', 'เลือกไฟล์ก่อน', 'warning'); return; }
 document.getElementById('ff-viewer')?.remove();
 const dlg = document.createElement('dialog');
 dlg.id = 'ff-viewer';
 dlg.className = 'ff-dlg ff-viewer';

 const spans = ffEditSpans(f);
 const live = spans.filter(x => !x.gone);
 const lines = ffLines(f.text);

 const head = document.createElement('div');
 head.className = 'ff-dlg-head';
 head.textContent = `${f.name} · ${lines.length} บรรทัด · แก้ไป ${live.length} จุด`;

 const bar = document.createElement('div');
 bar.className = 'ff-brow-bar';
 let mode = live.length ? 'changed' : 'all';
 const bChanged = document.createElement('button');
 bChanged.className = 'ff-btn';
 bChanged.textContent = `เฉพาะที่แก้ (${live.length})`;
 const bAll = document.createElement('button');
 bAll.className = 'ff-btn';
 bAll.textContent = 'ทั้งไฟล์';
 bar.append(bChanged, bAll);

 const body = document.createElement('div');
 body.className = 'ff-dlg-body ff-code';

 const isChanged = n => live.some(x => n >= x.from && n <= x.to);
 const spanAt = n => live.find(x => n >= x.from && n <= x.to);

 const showDiff = sp => {
  document.getElementById('ff-cmp')?.remove();
  const d2 = document.createElement('dialog');
  d2.id = 'ff-cmp';
  d2.className = 'ff-dlg';
  const h = document.createElement('div');
  h.className = 'ff-dlg-head';
  h.textContent = `เทียบของเก่ากับของใหม่ · บรรทัด ${sp.from}`;
  const b = document.createElement('div');
  b.className = 'ff-dlg-body';
  const l1 = document.createElement('div'); l1.className = 'ff-diff-t'; l1.textContent = 'ของเดิม ที่ถูกแทนที่';
  const p1 = document.createElement('pre'); p1.className = 'ff-del'; p1.textContent = sp.e.before;
  const l2 = document.createElement('div'); l2.className = 'ff-diff-t'; l2.textContent = 'ของใหม่ ที่บอทใส่แทน';
  const p2 = document.createElement('pre'); p2.className = 'ff-add'; p2.textContent = sp.e.after;
  b.append(l1, p1, l2, p2);
  const a = document.createElement('div');
  a.className = 'ff-dlg-acts';
  const undo = document.createElement('button');
  undo.className = 'ff-btn';
  undo.textContent = 'ย้อนเฉพาะจุดนี้';
  undo.onclick = () => {
   if (f.text.split(sp.e.after).length - 1 !== 1) { ffToast('ย้อนไม่ได้', 'ข้อความนี้ซ้ำหรือถูกแก้ทับไปแล้ว', 'warning'); return; }
   f.text = f.text.replace(sp.e.after, sp.e.before);
   f.edits.splice(f.edits.indexOf(sp.e), 1);
   ffPush('warn', `ย้อนจุดที่แก้ใน ${f.name}`, 'ผู้ใช้กดย้อนเอง');
   d2.close(); d2.remove(); dlg.close(); dlg.remove();
   ffRender(); ffOpenViewer(f.id);
   ffToast('File Forge', 'ย้อนจุดนี้แล้ว', 'success');
  };
  const ok = document.createElement('button');
  ok.className = 'ff-btn primary';
  ok.textContent = 'ปิด';
  ok.onclick = () => { d2.close(); d2.remove(); };
  a.append(undo, ok);
  d2.append(h, b, a);
  document.body.appendChild(d2);
  d2.showModal();
 };

 const paintRow = n => {
  const row = document.createElement('div');
  row.className = 'ff-cl' + (isChanged(n) ? ' hit' : '');
  const ln = document.createElement('span');
  ln.className = 'ff-cl-n';
  ln.textContent = n;
  const tx = document.createElement('span');
  tx.className = 'ff-cl-t';
  tx.textContent = lines[n - 1] === '' ? ' ' : lines[n - 1];
  row.append(ln, tx);
  const sp = spanAt(n);
  if (sp) {
   row.title = 'แตะเพื่อเทียบของเก่ากับของใหม่';
   row.onclick = () => showDiff(sp);
  }
  return row;
 };

 const paint = () => {
  body.innerHTML = '';
  bChanged.classList.toggle('primary', mode === 'changed');
  bAll.classList.toggle('primary', mode === 'all');
  if (mode === 'changed') {
   if (!live.length) {
    const e = document.createElement('div');
    e.className = 'ff-hint';
    e.textContent = 'ยังไม่มีการแก้ในไฟล์นี้ กดทั้งไฟล์เพื่อดูเนื้อหา';
    body.appendChild(e);
   }
   live.forEach(sp => {
    const tag = document.createElement('div');
    tag.className = 'ff-cl-tag';
    tag.textContent = `แก้จุดที่ ${sp.i + 1} · บรรทัด ${sp.from}${sp.to > sp.from ? ' ถึง ' + sp.to : ''}`;
    body.appendChild(tag);
    const a = Math.max(1, sp.from - 6), b = Math.min(lines.length, sp.to + 6);
    for (let n = a; n <= b; n++) body.appendChild(paintRow(n));
   });
   spans.filter(x => x.gone).forEach(x => {
    const g = document.createElement('div');
    g.className = 'ff-hint';
    g.textContent = `จุดที่ ${x.i + 1} ถูกแก้ทับไปแล้วด้วยการแก้อันหลัง จึงไฮไลท์ให้ไม่ได้`;
    body.appendChild(g);
   });
  } else {
   const cap = 4000;
   const total = Math.min(lines.length, cap);
   for (let n = 1; n <= total; n++) body.appendChild(paintRow(n));
   if (lines.length > cap) {
    const w = document.createElement('div');
    w.className = 'ff-hint';
    w.textContent = `ไฟล์ยาว ${lines.length} บรรทัด แสดงแค่ ${cap} บรรทัดแรกเพื่อไม่ให้เครื่องหน่วง ใช้โหมดเฉพาะที่แก้เพื่อดูจุดที่แก้ทั้งหมด`;
    body.appendChild(w);
   }
  }
 };
 bChanged.onclick = () => { mode = 'changed'; paint(); };
 bAll.onclick = () => { mode = 'all'; paint(); };

 const acts = document.createElement('div');
 acts.className = 'ff-dlg-acts';
 const dl = document.createElement('button');
 dl.className = 'ff-btn';
 dl.textContent = 'โหลดไฟล์นี้ทั้งไฟล์';
 dl.onclick = () => ffDownload(f.name, f.text);
 const ok = document.createElement('button');
 ok.className = 'ff-btn primary';
 ok.textContent = 'ปิด';
 ok.onclick = () => { dlg.close(); dlg.remove(); };
 acts.append(dl, ok);

 dlg.append(head, bar, body, acts);
 document.body.appendChild(dlg);
 dlg.showModal();
 paint();
}

/** ★ หน้าประวัติ โชว์ว่าทำอะไรไปบ้าง ก๊อปไปวางรายงานได้ */
function ffOpenLog() {
 document.getElementById('ff-logdlg')?.remove();
 const dlg = document.createElement('dialog');
 dlg.id = 'ff-logdlg';
 dlg.className = 'ff-dlg';
 const head = document.createElement('div');
 head.className = 'ff-dlg-head';
 head.textContent = `ประวัติการแก้ · ${ffLog.length} รายการ`;
 const body = document.createElement('div');
 body.className = 'ff-dlg-body';
 if (!ffLog.length) {
  const e = document.createElement('div');
  e.className = 'ff-hint';
  e.textContent = 'ยังไม่มีอะไรเกิดขึ้น';
  body.appendChild(e);
 }
 const pad = n => String(n).padStart(2, '0');
 ffLog.slice().reverse().forEach(l => {
  const r = document.createElement('div');
  r.className = 'ff-logrow ' + l.kind;
  const d = new Date(l.ts);
  const t = document.createElement('span');
  t.className = 'ff-log-t';
  t.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const m = document.createElement('span');
  m.className = 'ff-log-m';
  m.textContent = l.msg + (l.detail ? ' — ' + l.detail : '');
  r.append(t, m);
  body.appendChild(r);
 });
 const acts = document.createElement('div');
 acts.className = 'ff-dlg-acts';
 const cp = document.createElement('button');
 cp.className = 'ff-btn';
 cp.textContent = 'คัดลอกประวัติ';
 cp.onclick = () => {
  const txt = ffLog.map(l => `[${l.kind}] ${l.msg}${l.detail ? ' — ' + l.detail : ''}`).join('\n');
  try { navigator.clipboard.writeText(txt); ffToast('File Forge', 'คัดลอกแล้ว', 'success'); }
  catch { ffToast('คัดลอกไม่ได้', 'ลากเลือกเอาเองจากหน้าจอ', 'warning'); }
 };
 const clr = document.createElement('button');
 clr.className = 'ff-btn';
 clr.textContent = 'ล้าง';
 clr.onclick = () => { ffLog = []; dlg.close(); dlg.remove(); };
 const ok = document.createElement('button');
 ok.className = 'ff-btn primary';
 ok.textContent = 'ปิด';
 ok.onclick = () => { dlg.close(); dlg.remove(); };
 acts.append(cp, clr, ok);
 dlg.append(head, body, acts);
 document.body.appendChild(dlg);
 dlg.showModal();
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
      <input class="menu_button" type="button" id="ff-browse" value="เปิดหน้าต่างเต็ม">
     </div>
     <div id="ff-hits" class="ff-hits"></div>
     <div id="ff-slices" class="ff-slices"></div>
     <div class="ff-btn-row">
      <input class="menu_button" type="button" id="ff-dlchanged" value="โหลดไฟล์ที่แก้แล้ว (ทั้งไฟล์)">
      <input class="menu_button" type="button" id="ff-saveall" value="เขียนทับทุกไฟล์ที่แก้">
      <input class="menu_button" type="button" id="ff-log" value="ประวัติการแก้">
     </div>
     <div class="ff-btn-row">
      <input class="menu_button" type="button" id="ff-dl" value="โหลดไฟล์นี้ (ทั้งไฟล์)">
      <input class="menu_button" type="button" id="ff-save" value="เขียนทับไฟล์นี้">
      <input class="menu_button" type="button" id="ff-view" value="ดูไฟล์ + ที่แก้">
      <input class="menu_button" type="button" id="ff-check" value="ตรวจโครงสร้าง">
      <input class="menu_button" type="button" id="ff-revert" value="ย้อนต้นฉบับ">
     </div>
    </div>
    <hr>
    <label class="ff-row"><span><b>ส่งได้ทีละกี่ท่อน</b><i>บอทขอดูหลายฟังก์ชันพร้อมกันได้ ยิ่งมากยิ่งกินโทเคน</i></span>
    <input type="number" id="ff-s-max" min="1" max="8" value="${s.maxSlices}"></label>
    <label class="ff-row"><span><b>ท่อนละกี่บรรทัด</b><i>นับรอบจุดที่เลือก ค่าเริ่มต้น 80</i></span>
    <input type="number" id="ff-s-lines" min="20" max="400" value="${s.sliceLines}"></label>
    ${sw('ff-s-enabled', 'เปิดใช้งาน', 'ปิดแล้วไม่ส่งอะไรเข้า prompt เลย', s.enabled)}
    ${sw('ff-s-guide', 'ส่งคู่มือรูปแบบให้โมเดล', 'ปิดได้ถ้าโมเดลจำรูปแบบได้แล้ว ประหยัดโทเคน', s.injectGuide)}
    ${sw('ff-s-auto', 'สแกนคำตอบหาคำสั่งแก้อัตโนมัติ', '', s.autoDetect)}
    ${sw('ff-s-botsearch', 'ให้บอทค้นหาและเปิดดูโค้ดเอง', 'คุณแค่บอกว่าอยากได้อะไร ที่เหลือมันจัดการเอง', s.botSearch)}
    ${sw('ff-s-autofeed', 'ส่งโค้ดให้บอทดูต่อทันที', 'ปิดแล้วต้องพิมพ์เองหนึ่งครั้งหลังมันขอ', s.autoFeed)}
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
  if ((f.edits || []).length) {
   const eye = document.createElement('button');
   eye.className = 'ff-mini ff-file-eye';
   eye.textContent = `ดูที่แก้ ${f.edits.length}`;
   eye.onclick = ev => { ev.stopPropagation(); ffActive = f.id; ffRender(); ffOpenViewer(f.id); };
   row.appendChild(eye);
  }
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
 on('ff-dlchanged', ffDownloadChanged);
 on('ff-saveall', ffSaveAllChanged);
 on('ff-log', ffOpenLog);
 on('ff-view', () => ffOpenViewer());
 on('ff-check', () => {
  const f = ffFile();
  if (!f) return;
  const b = ffBalance(f.text);
  ffPush(b.ok ? 'ok' : 'bad', `ตรวจ ${f.name} ด้วยมือ`, b.why || 'ผ่าน');
  ffToast(b.ok ? 'โครงสร้างผ่าน' : 'โครงสร้างพัง', b.ok ? `${f.name} วงเล็บและปีกกาครบ` : b.why, b.ok ? 'success' : 'error');
 });
 on('ff-save', ffSaveInPlace);
 on('ff-revert', () => {
  const f = ffFile();
  if (!f) return;
  if (!confirm('ย้อนกลับเป็นต้นฉบับ ทิ้งการแก้ทั้งหมด?')) return;
  f.text = f.orig; f.edits = []; ffRender(); ffToast('File Forge', 'ย้อนกลับแล้ว', 'success');
 });
 const num = (id, key, min, max) => { const el = document.getElementById(id); if (el) el.addEventListener('input', e => {
  ffSettings()[key] = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || FF_DEFAULTS[key])); ffSave();
 }); };
 num('ff-s-max', 'maxSlices', 1, 8);
 num('ff-s-lines', 'sliceLines', 20, 400);
 chk('ff-s-enabled', 'enabled');
 chk('ff-s-guide', 'injectGuide');
 chk('ff-s-auto', 'autoDetect');
 chk('ff-s-botsearch', 'botSearch');
 chk('ff-s-autofeed', 'autoFeed');
 on('ff-browse', ffOpenBrowser);
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
