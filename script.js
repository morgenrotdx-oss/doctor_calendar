// ===== 設定 =====
const GAS_API = 'https://script.google.com/macros/s/AKfycbyqBDlrQTiiKPT86BuirJV6W__7z9_vsNOIA0iPmmbtxkQRCu6EU3HQWyN54ach_5PaGw/exec';

// ===== 既存GASのJSと同じ定義 =====
const WEEKDAYS = ["月","火","水","木","金","土","日"];
// 曜日1文字 -> 月曜起点の列番号
const WK_INDEX = { '月':0,'火':1,'水':2,'木':3,'金':4,'土':5,'日':6,
                   'Mon':0,'Tue':1,'Wed':2,'Thu':3,'Fri':4,'Sat':5,'Sun':6 };
const JP2EN = { '月':'Mon','火':'Tue','水':'Wed','木':'Thu','金':'Fri','土':'Sat','日':'Sun' };
const EN2JP = { 'Mon':'月','Tue':'火','Wed':'水','Thu':'木','Fri':'金','Sat':'土','Sun':'日' };

const DEPT_ORDER = [
  "小児科１診","小児科２診","小児科３診",
  "耳鼻科１診","耳鼻科２診","耳鼻科３診",
  "皮膚科","形成外科","小児科夜診","耳鼻科夜診"
];

// GAS版グローバルに相当
let rooms = [];
let schedule = {};
let holidays = [];
let clinicCode = null;      // URL ?clinic= から決定
let clinicName = "";        // APIから取得
let minYearMonth = "";      // "YYYY-MM"
let maxYearMonth = "";      // "YYYY-MM"
let dates = [];
let isLoading = false;

let state = {
  monthStr: null,   // ← これを使う
  clinicName: "",
  rooms: [],
  schedule: {},
  holidays: []
};

// ===== Debug Flag =====
const DEBUG = false;  // ←本番は false、調査時だけ true に
function dlog(...args){ if (DEBUG) console.log(...args); }

// ===== Util =====
// === 追加：JST(UTC+9) の曜日を返す ===
function jpDowJST(y, m0, d) {
  // m0は0始まりの月
  const wd = new Date(Date.UTC(y, m0, d, 9)).getUTCDay(); // JSTでの曜日
  return ["日","月","火","水","木","金","土"][wd];
}

// === 追加：JSTで「月曜始まりの月情報」を返す（YYYY-MM版） ===
function calcMonthInfoFromYYYYMM_JST(monthStr){
  const [yy, mm] = monthStr.split('-').map(Number);
  const year  = yy, month = mm - 1;
  const firstUTCJST = new Date(Date.UTC(year, month, 1, 9));
  const sunday0 = firstUTCJST.getUTCDay();      // 0(日)〜6(土)
  let firstWeekday = (sunday0 + 6) % 7;         // 月曜起点
  const totalDays = new Date(year, month + 1, 0).getDate();
  const numWeeks  = Math.ceil((firstWeekday + totalDays) / 7);
  return { year, month, firstWeekday, totalDays, numWeeks };
}

// ★新規：サーバの schedule を走査して “その月の日→曜日1文字” を作る
function inferWeekcharMapForMonth(year, month) {
  const m1 = month + 1;
  const map = new Map(); // day(1-31) -> '月'..'日'
  for (const r of (rooms || [])) {
    const obj = schedule[r];
    if (!obj) continue;
    for (const k of Object.keys(obj)) {
      // "10/2(木)" も "10/2(Wed)" も拾う
      const m = k.match(/^(\d{1,2})\/(\d{1,2})\(([^)]+)\)$/);
      if (!m) continue;
      const mm = Number(m[1]), dd = Number(m[2]), raw = m[3];
      if (mm !== m1 || map.has(dd)) continue;
      const youbi = normalizeWeekChar(raw);
      if (youbi) map.set(dd, youbi);
    }
  }
  return map;
}

function getClinicFromURL() {
  const p = new URLSearchParams(location.search);
  const v = (p.get('clinic') || '').trim();
  return /^\d{3}$/.test(v) ? v : '001';
}
function setClinicToURL(v) {
  const u = new URL(location.href);
  u.searchParams.set('clinic', v);
  history.replaceState(null, '', u);
}
function yyyymm(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

function showLoader(){ 
  isLoading = true;
  document.getElementById('loader')?.classList.add('show');
  updateNavDisabled();
}
function hideLoader(){ 
  isLoading = false;
  document.getElementById('loader')?.classList.remove('show');
  updateNavDisabled();
}
function updateNavDisabled(){
  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');
  const atMin = !!minYearMonth && (state.monthStr <= minYearMonth);
  const atMax = !!maxYearMonth && (state.monthStr >= maxYearMonth);
  if (prevBtn) prevBtn.disabled = isLoading || atMin;
  if (nextBtn) nextBtn.disabled = isLoading || atMax;
}

// ===== 表示系（GAS版と同じ関数名/構造） =====
function updateTitle(year, month) {
  document.getElementById('tableTitle').textContent =
    `(院内向け)${clinicName || ""} ${year}年${month + 1}月 医師勤務表`;
}
function clearTable() {
  document.querySelector('#calendar thead').innerHTML = '';
  document.querySelector('#calendar tbody').innerHTML = '';
}
function renderHeader() {
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th')); // 左端セル

  WEEKDAYS.forEach((wd, i) => {
    const th = document.createElement('th');
    th.textContent = wd;
    if (i === 5) th.classList.add('saturday');
    if (i === 6) th.classList.add('sunday');
    headRow.appendChild(th);
  });
  document.querySelector('#calendar thead').appendChild(headRow);
}

// サーバ(schedule)のキーから曜日文字を抽出するヘルパー
function getWeekCharFromServer(month0, day) {
  if (!rooms || rooms.length === 0) return null;
  const m = month0 + 1; // 表示上の月(1-12)
  // 代表で rooms[0] を見る（見つからなければ他の科も走査）
  const tryRooms = [rooms[0], ...rooms.slice(1)];
  for (const r of tryRooms) {
    const obj = schedule[r];
    if (!obj) continue;
    // "10/2(" のような prefix で一致するキーを探す
    const prefix = `${m}/${day}(`;
    for (const k of Object.keys(obj)) {
      if (k.startsWith(prefix)) {
        const idx = k.indexOf('(');
        const wk  = k[idx + 1];         // '月' など 1 文字
        return wk || null;
      }
    }
  }
  return null;
}

// サーバ(schedule)のキーから「今月1日の開始列(0=月…6=日)」を推定
function getFirstWeekdayFromServer(month0) {
  const wkMap = { '月':0,'火':1,'水':2,'木':3,'金':4,'土':5,'日':6 };
  const wchar = getWeekCharFromServer(month0, 1); // 1日分だけ見る
  return (wchar && wkMap[wchar] !== undefined) ? wkMap[wchar] : null;
}

// 週文字を日本語1文字に正規化（"Wed"→"水", "水"→"水"）
function normalizeWeekChar(x) {
  if (!x) return null;
  const t = String(x).trim();
  return EN2JP[t] || t[0];  // "Wed"→"水" / "水"→"水"
}

// メイン描画（GAS版の renderCalendar と同じクラス名/HTML構造）
function renderCalendar(){
  // 0) monthStr の保証
  if (!state.monthStr || !/^\d{4}-\d{2}$/.test(state.monthStr)) {
    state.monthStr = yyyymm(new Date());
  }

  // 1) JSTで基礎情報
  let { year, month, firstWeekday, totalDays, numWeeks } =
    calcMonthInfoFromYYYYMM_JST(state.monthStr);

  // 2) サーバ基準の曜日マップ（JP1文字）＋ フォールバック（JST）
  const youbiMap = inferWeekcharMapForMonth(year, month);
  const youbiOf = (d) => normalizeWeekChar(youbiMap.get(d) || jpDowJST(year, month, d));

  // 3) 1日の列開始をサーバ側で上書き
  const y1 = youbiMap.get(1);
  if (y1 != null && WK_INDEX[y1] != null) firstWeekday = WK_INDEX[y1];

  // 4) タイトル・ヘッダ
  updateTitle(year, month);
  document.querySelector('#calendar thead').innerHTML = '';
  renderHeader();

  // 5) holiday set / nowJST は一度だけ
  const holidaySet = new Set((holidays || []).map(h => h.split('(')[0]));
  const nowJST = new Date(Date.now() + 9*60*60*1000);

  // 6) 新tbodyを組み立て → 最後に置換
  const tbodyNew = document.createElement('tbody');

  for (let w = 0; w < numWeeks; w++) {
    // (a) 日付行
    const trWeek = document.createElement('tr');
    trWeek.classList.add('week-row','date-row');
    const tdLabel = document.createElement('td'); tdLabel.textContent = '';
    trWeek.appendChild(tdLabel);

    for (let d = 0; d < 7; d++) {
      const td = document.createElement('td');
      const dayNum = w * 7 + d - firstWeekday + 1;
      if (dayNum >= 1 && dayNum <= totalDays) {
        td.textContent = dayNum;
        if (d === 5) td.classList.add('saturday');
        if (d === 6) td.classList.add('sunday');
        const label = `${month + 1}/${dayNum}`;
        if (holidaySet.has(label)) td.classList.add('holiday');

        if (year === nowJST.getUTCFullYear() &&
            month === nowJST.getUTCMonth() &&
            dayNum === nowJST.getUTCDate()) {
          td.classList.add('today-cell');
        }
      }
      trWeek.appendChild(td);
    }
    tbodyNew.appendChild(trWeek);

    // (b) 週内 “全科で医師0” 判定
    const dayHasDoctor = {};
    for (let d = 0; d < 7; d++) {
      const dayNum = w * 7 + d - firstWeekday + 1;
      if (dayNum < 1 || dayNum > totalDays) continue;

      const tok   = youbiOf(dayNum); // '水'
      const keyJP = `${month + 1}/${dayNum}(${tok})`;
      const keyEN = `${month + 1}/${dayNum}(${JP2EN[tok] || tok})`;

      dayHasDoctor[dayNum] = rooms.some(room => {
        const obj = schedule[room] || {};
        const entry = obj[keyJP] || obj[keyEN];
        const disp  = entry?.displayName || entry?.name || '';
        return !!disp && disp !== '休診';
      });
    }

    // (c) 診療科行
    rooms.forEach((room, rIndex) => {
      const trRoom = document.createElement('tr');
      const tdRoom = document.createElement('td');
      tdRoom.textContent = room; trRoom.appendChild(tdRoom);

      for (let d = 0; d < 7; d++) {
        const td = document.createElement('td');
        const dayNum = w * 7 + d - firstWeekday + 1;

        // 月の外は空セル
        if (dayNum < 1 || dayNum > totalDays) {
          trRoom.appendChild(td);
          continue;
        }

        const tok   = youbiOf(dayNum);
        const keyJP = `${month + 1}/${dayNum}(${tok})`;
        const keyEN = `${month + 1}/${dayNum}(${JP2EN[tok] || tok})`;
        const entry = (schedule[room]?.[keyJP]) || (schedule[room]?.[keyEN]);

        if (!dayHasDoctor[dayNum]) {
          // 週内ゼロ → 先頭科だけ rowSpan セル
          if (rIndex === 0) {
            td.textContent = '休診日';
            td.classList.add('kyushin-cell');
            td.setAttribute('aria-label', `${month+1}/${dayNum} 休診日`);
            td.rowSpan = rooms.length;
            trRoom.appendChild(td);
          }
          continue;
        }

        if (entry && (entry.name || entry.displayName)) {
          const t = `${entry.timeFrom || ''}${entry.timeTo ? '～' + entry.timeTo : ''}`;
          td.innerHTML =
            `<div><span>${t}</span></div>
             <div><span${entry.sex==='女' ? ' class="female"':''}>${entry.displayName || entry.name}</span>${entry.tongueMark ? ` <span title="舌下">${entry.tongueMark}</span>`:''}</div>`;

          // ★修正：表示名または医師名が「休診」ならフラグを立てる
          const isKyushin = (entry.displayName === '休診' || entry.name === '休診');

          if (isKyushin) td.classList.add('kyushin-cell');
          if (entry.displayName === '調整中') td.classList.add('cyousei-cell');

          if (!isKyushin) { // ★修正：「休診」でなければクリック可能に
            td.style.cursor = 'zoom-in';

            // ★ 委譲用に data-entry を付与（個別の addEventListener はしない）
            td.dataset.entry = JSON.stringify({
              date: `${month+1}/${dayNum}`,
              dept: room,
              time: t,
              name: entry.displayName || entry.name,
              tongue: entry.tongueMark
            });
          }
        } else {
          td.textContent = dayHasDoctor[dayNum] ? '−' : '休診';
          if (!dayHasDoctor[dayNum]) td.classList.add('kyushin-cell');
          td.setAttribute('aria-label', `${month+1}/${dayNum} ${room} ${td.textContent}`);
        }

        trRoom.appendChild(td);
      }
      tbodyNew.appendChild(trRoom);
    });
  }

  // 7) tbody 一括置換（最後にドン）
  const table = document.getElementById('calendar');
  const oldTbody = table.tBodies[0];
  if (oldTbody) {
    table.replaceChild(tbodyNew, oldTbody);
  } else {
    table.appendChild(tbodyNew);
  }
}

// モーダル（GAS版と同DOM/クラス）
function showCellModal({ date, dept, time, name, tongue }) {
  const prevModal = document.querySelector('.cell-modal');
  if (prevModal) {
    prevModal.classList.add('fade-out');
    setTimeout(() => { prevModal.remove(); createModal(); }, 200);
  } else {
    createModal();
  }

  function createModal() {
    const modal = document.createElement('div');
    modal.className = 'cell-modal';
    modal.innerHTML = `
      <span class="close-btn" onclick="this.parentElement.remove()">×</span>
      <div class="modal-label">日付</div>
      <div class="modal-value">${date}</div>
      <div class="modal-label">診療科</div>
      <div class="modal-value">${dept}</div>
      <div class="modal-label">医師名</div>
      <div class="modal-value">${name}${tongue ? ` <span title="舌下">${tongue}</span>` : ""}</div>
      <div class="modal-label">勤務時間</div>
      <div class="modal-value">${time}</div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }
}

// ===== データ取得（google.script.run → fetch に置換） =====
async function fetchSchedule(){
  // 二重実行ガード（連打対策：進行中は無視）
  if (isLoading) return;

  const url = new URL(GAS_API);
  url.searchParams.set('action', 'schedule');
  url.searchParams.set('clinic', clinicCode);
  url.searchParams.set('month', state.monthStr); // ★ここ重要
  url.searchParams.set('t', Date.now());

  dlog('API request', { action: 'schedule', clinic: clinicCode, month: state.monthStr });

  showLoader();                     // ← 追加
  try {
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'API error');
  
    clinicName   = json.clinicName || '';
    const data   = json.data || {};
    rooms        = (data.rooms || []).slice();
    schedule     = data.schedule || {};
    holidays     = data.holidays || [];
    minYearMonth = data.minYearMonth || "";
    maxYearMonth = data.maxYearMonth || "";
    dates        = data.dates || [];
  
    // 並び順
    rooms.sort((a,b)=>{
      const ia = DEPT_ORDER.indexOf(a), ib = DEPT_ORDER.indexOf(b);
      if (ia===-1 && ib===-1) return a.localeCompare(b,'ja');
      if (ia===-1) return 1; if (ib===-1) return -1;
      return ia - ib;
    });

    renderCalendar();
  } finally {
    hideLoader();
    window.__dumpKeyMatch && window.__dumpKeyMatch();
    if (DEBUG && window.__dumpKeyMatch) window.__dumpKeyMatch();
    if (!DEBUG) {
      // デバッグUIの残存防止
      const dbg = document.getElementById('__cal_dbg2');
      if (dbg) dbg.remove();
    }
  }
}

// ===== 起動処理（GAS版の流儀に合わせた最小UI） =====
document.addEventListener('DOMContentLoaded', () => {
  clinicCode     = getClinicFromURL();
  setClinicToURL(clinicCode);
  state.monthStr = yyyymm(new Date());             // ★初期は今月

  // 月移動：state.monthStr を直接変更
  document.getElementById('prevMonth').onclick = ()=>{
    const [y,m] = state.monthStr.split('-').map(Number);
    state.monthStr = yyyymm(new Date(y, m-2, 1));  // 前月
    fetchSchedule().catch(e => alert(e));
  };
  document.getElementById('nextMonth').onclick = ()=>{
    const [y,m] = state.monthStr.split('-').map(Number);
    state.monthStr = yyyymm(new Date(y, m, 1));    // 翌月
    fetchSchedule().catch(e => alert(e));
  };

  // クリック委譲（医師セルのモーダル起動）
  document.getElementById('calendar').addEventListener('click', (e) => {
    const td = e.target.closest('td[data-entry]');
    if (!td) return;
    try {
      const payload = JSON.parse(td.dataset.entry);
      showCellModal(payload);
    } catch (_) { /* noop */ }
  });

  // 初回
  fetchSchedule().catch(e => alert(e));
});

// === デバッグ: 先頭1週間の横並び・キー一致を画面に出す ===
window.__dumpKeyMatch = function(){
  if (!DEBUG) return;
  const box = document.getElementById('__cal_dbg2') || document.createElement('div');
  box.id='__cal_dbg2';
  Object.assign(box.style,{position:'fixed',left:'10px',bottom:'10px',zIndex:9999,
    background:'#111',color:'#0f0',padding:'8px 10px',font:'12px/1.3 monospace',
    whiteSpace:'pre',maxHeight:'40vh',overflow:'auto',borderRadius:'6px',opacity:.9});
  const {year,month,firstWeekday,totalDays} = calcMonthInfoFromYYYYMM_JST(state.monthStr);
  const ym = `${year}-${String(month+1).padStart(2,'0')}`;
  const youbiMap = inferWeekcharMapForMonth(year, month);
  const youbiOf = (d) => youbiMap.get(d) ?? JP2EN[jpDowJST(year, month, d)] ?? jpDowJST(year, month, d);

  const lines = [];
  lines.push(`[client] ym=${ym} firstWeekday=${firstWeekday} totalDays=${totalDays}`);
  lines.push(`[server] youbiMap(first 10 days):`);
  for (let d=1; d<=Math.min(10,totalDays); d++){
    lines.push(`  ${month+1}/${d} -> ${youbiMap.get(d) || '(none)'} / key="${month+1}/${d}(${youbiOf(d)})"`);
  }
  const r0 = rooms[0];
  lines.push(`rooms[0]=${r0}`);
  if (r0 && schedule[r0]){
    const keys = Object.keys(schedule[r0]).filter(k=>k.startsWith(`${month+1}/`)).sort().slice(0,10);
    lines.push(`schedule[${r0}] sample keys:`);
    keys.forEach(k=>lines.push(`  ${k}`));
  } else {
    lines.push(`schedule[${r0}] not found or empty`);
  }
  box.textContent = lines.join('\n');
  document.body.appendChild(box);
};
