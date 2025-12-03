// ===== 設定 =====
const GAS_API = 'https://script.google.com/macros/s/AKfycbyqBDlrQTiiKPT86BuirJV6W__7z9_vsNOIA0iPmmbtxkQRCu6EU3HQWyN54ach_5PaGw/exec';

// ===== 定数定義 =====
const WEEKDAYS = ["月","火","水","木","金","土","日"];
const DEPT_ORDER = [
  "小児科１診","小児科２診","小児科３診",
  "耳鼻科１診","耳鼻科２診","耳鼻科３診",
  "皮膚科","形成外科","小児科夜診","耳鼻科夜診"
];
const WK_INDEX = { '月':0,'火':1,'水':2,'木':3,'金':4,'土':5,'日':6,
                   'Mon':0,'Tue':1,'Wed':2,'Thu':3,'Fri':4,'Sat':5,'Sun':6 };
const JP2EN = { '月':'Mon','火':'Tue','水':'Wed','木':'Thu','金':'Fri','土':'Sat','日':'Sun' };
const EN2JP = { 'Mon':'月','Tue':'火','Wed':'水','Thu':'木','Fri':'金','Sat':'土','Sun':'日' };

// ===== グローバル変数 =====
let rooms = [];
let schedule = {};
let holidays = [];
let clinicCode = '001';
let clinicName = "";
let minYearMonth = "";
let maxYearMonth = "";
let isLoading = false;

let state = {
  monthStr: null // "YYYY-MM"
};

// ===== ユーティリティ =====
function yyyymm(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

function calcMonthInfoFromYYYYMM_JST(monthStr){
  const parts = monthStr.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  
  const firstUTCJST = new Date(Date.UTC(year, month, 1, 9));
  const sunday0 = firstUTCJST.getUTCDay();
  const firstWeekday = (sunday0 + 6) % 7; 
  const totalDays = new Date(year, month + 1, 0).getDate();
  const numWeeks  = Math.ceil((firstWeekday + totalDays) / 7);
  return { year, month, firstWeekday, totalDays, numWeeks };
}

function inferWeekcharMapForMonth(year, month) {
  const m1 = month + 1;
  const map = new Map();
  if (rooms) {
    for (const r of rooms) {
      const obj = schedule[r];
      if (!obj) continue;
      for (const k of Object.keys(obj)) {
        const m = k.match(/^(\d{1,2})\/(\d{1,2})\(([^)]+)\)$/);
        if (!m) continue;
        const mm = Number(m[1]);
        const dd = Number(m[2]);
        const raw = m[3];
        if (mm !== m1 || map.has(dd)) continue;
        const t = String(raw).trim();
        const youbi = EN2JP[t] || t[0];
        if (youbi) map.set(dd, youbi);
      }
    }
  }
  return map;
}

function normalizeWeekChar(x) {
  if (!x) return null;
  const t = String(x).trim();
  return EN2JP[t] || t[0];
}

// ===== UI操作系 =====
function showLoader(){ 
  isLoading = true;
  const loader = document.getElementById('loader');
  if (loader) loader.classList.add('show');
  updateNavDisabled();
}

function hideLoader(){ 
  isLoading = false;
  const loader = document.getElementById('loader');
  if (loader) loader.classList.remove('show');
  updateNavDisabled();
}

function updateNavDisabled(){
  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');
  
  let isMin = false;
  if (minYearMonth && state.monthStr <= minYearMonth) isMin = true;
  
  let isMax = false;
  if (maxYearMonth && state.monthStr >= maxYearMonth) isMax = true;
  
  if (prevBtn) prevBtn.disabled = (isLoading || isMin);
  if (nextBtn) nextBtn.disabled = (isLoading || isMax);
}

function updateTitle(year, month) {
  const el = document.getElementById('tableTitle');
  if (el) el.textContent = `(スタッフ向け)${clinicName || ""} ${year}年${month + 1}月 - 医師勤務表`;
}

function clearTable() {
  document.querySelector('#calendar thead').innerHTML = '';
  document.querySelector('#calendar tbody').innerHTML = '';
}

function renderHeader() {
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  WEEKDAYS.forEach((wd, i) => {
    const th = document.createElement('th');
    th.textContent = wd;
    if (i === 5) th.classList.add('saturday');
    if (i === 6) th.classList.add('sunday');
    headRow.appendChild(th);
  });
  document.querySelector('#calendar thead').appendChild(headRow);
}

// ===== メイン描画 (スタッフ用：配列対応版) =====
function renderCalendar(){
  if (!state.monthStr || !/^\d{4}-\d{2}$/.test(state.monthStr)) {
    state.monthStr = yyyymm(new Date());
  }

  const { year, month, firstWeekday, totalDays, numWeeks } = calcMonthInfoFromYYYYMM_JST(state.monthStr);
  const youbiMap = inferWeekcharMapForMonth(year, month);
  
  const jpDowJST = (y, m0, d) => ["日","月","火","水","木","金","土"][new Date(Date.UTC(y, m0, d, 9)).getUTCDay()];
  const youbiOf = (d) => normalizeWeekChar(youbiMap.get(d) || jpDowJST(year, month, d));

  const y1 = youbiMap.get(1);
  let startWd = firstWeekday;
  if (y1 != null && WK_INDEX[y1] != null) startWd = WK_INDEX[y1];

  updateTitle(year, month);
  clearTable();
  renderHeader();

  const holidaySet = new Set((holidays || []).map(h => h.split('(')[0]));
  const nowJST = new Date(Date.now() + 9*60*60*1000);
  const tbodyNew = document.createElement('tbody');

  for (let w = 0; w < numWeeks; w++) {
    // 日付行
    const trWeek = document.createElement('tr');
    trWeek.classList.add('week-row','date-row');
    trWeek.appendChild(document.createElement('td'));

    for (let d = 0; d < 7; d++) {
      const td = document.createElement('td');
      const dayNum = w * 7 + d - startWd + 1;
      
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

    // ドクター有無判定
    const dayHasDoctor = {};
    for (let d = 0; d < 7; d++) {
      const dayNum = w * 7 + d - startWd + 1;
      if (dayNum < 1 || dayNum > totalDays) continue;

      const tok = youbiOf(dayNum);
      const keyJP = `${month + 1}/${dayNum}(${tok})`;
      const keyEN = `${month + 1}/${dayNum}(${JP2EN[tok] || tok})`;

      // ★ここを配列対応に修正
      dayHasDoctor[dayNum] = rooms.some(room => {
        const obj = schedule[room] || {};
        let entries = obj[keyJP] || obj[keyEN] || [];
        if (!Array.isArray(entries)) entries = [entries];
        
        return entries.some(e => {
          const disp = e.displayName || e.name || '';
          return !!disp && disp !== '休診';
        });
      });
    }

    // 診療科行
    rooms.forEach((room, rIndex) => {
      const trRoom = document.createElement('tr');
      const tdRoom = document.createElement('td');
      tdRoom.textContent = room;
      trRoom.appendChild(tdRoom);

      for (let d = 0; d < 7; d++) {
        const td = document.createElement('td');
        const dayNum = w * 7 + d - startWd + 1;

        if (dayNum < 1 || dayNum > totalDays) {
          trRoom.appendChild(td);
          continue;
        }

        const tok = youbiOf(dayNum);
        const keyJP = `${month + 1}/${dayNum}(${tok})`;
        const keyEN = `${month + 1}/${dayNum}(${JP2EN[tok] || tok})`;
        
        // ★ここも配列として取得
        let entries = (schedule[room]?.[keyJP]) || (schedule[room]?.[keyEN]) || [];
        if (!Array.isArray(entries)) entries = [entries];

        if (!dayHasDoctor[dayNum]) {
          if (rIndex === 0) {
            td.textContent = '休診日';
            td.classList.add('kyushin-cell');
            td.setAttribute('aria-label', `${month+1}/${dayNum} 休診日`);
            td.rowSpan = rooms.length;
            trRoom.appendChild(td);
          }
          continue;
        }

        if (entries.length > 0) {
          // 時間順ソート
          entries.sort((a,b) => {
             const p = t => {
               const [hh,mm] = (t||"0:00").split(":").map(Number);
               return hh*60+(mm||0);
             };
             return p(a.timeFrom) - p(b.timeFrom);
          });

          // 表示生成
          let html = "";
          entries.forEach(entry => {
            const t = `${entry.timeFrom || ''}${entry.timeTo ? '～' + entry.timeTo : ''}`;
            html += `<div><span>${t}</span></div>
                     <div><span${entry.sex==='女' ? ' class="female"':''}>${entry.displayName || entry.name}</span>${entry.tongueMark ? ` <span title="舌下">${entry.tongueMark}</span>`:''}</div>`;
          });
          td.innerHTML = html;

          // 休診・調整中判定（全員休診ならグレー）
          const allKyushin = entries.every(e => (e.displayName||e.name) === '休診');
          if (allKyushin) td.classList.add('kyushin-cell');
          
          if (entries.some(e => e.displayName === '調整中')) td.classList.add('cyousei-cell');

          if (!allKyushin) {
            td.style.cursor = 'zoom-in';
            // モーダル用データ（配列ごと渡す）
            td.dataset.entry = JSON.stringify({
              date: `${month+1}/${dayNum}`,
              dept: room,
              entries: entries 
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

  const table = document.getElementById('calendar');
  const oldTbody = table.tBodies[0];
  if (oldTbody) table.replaceChild(tbodyNew, oldTbody);
  else table.appendChild(tbodyNew);
}

// ===== モーダル (スタッフ用) =====
function showCellModal(data) {
  const { date, dept, entries: rawEntries } = data;
  
  // 互換性確保
  let entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

  const prevModal = document.querySelector('.cell-modal');
  if (prevModal) {
    prevModal.classList.add('fade-out');
    setTimeout(() => { prevModal.remove(); create(); }, 200);
  } else {
    create();
  }

  function create() {
    const modal = document.createElement('div');
    modal.className = 'cell-modal';
    
    let contentHtml = `
      <span class="close-btn" onclick="this.parentElement.remove()">×</span>
      <div class="modal-label">日付</div>
      <div class="modal-value">${date}</div>
      <div class="modal-label">診療科</div>
      <div class="modal-value">${dept}</div>`;

    // 複数人表示
    entries.forEach(e => {
        const time = `${e.timeFrom || ''}${e.timeTo ? '～' + e.timeTo : ''}`;
        const name = e.displayName || e.name;
        const tongue = e.tongueMark ? ` <span title="舌下">${e.tongueMark}</span>` : "";
        
        contentHtml += `
          <div style="border-top:1px dashed #ccc; margin:10px 0; padding-top:10px;">
            <div class="modal-label">医師名</div>
            <div class="modal-value">${name}${tongue}</div>
            <div class="modal-label">勤務時間</div>
            <div class="modal-value">${time}</div>
          </div>`;
    });

    modal.innerHTML = contentHtml;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }
}

// ===== データ取得 =====
async function fetchSchedule(){
  if (isLoading) return;

  const url = new URL(GAS_API);
  url.searchParams.set('action', 'schedule');
  url.searchParams.set('clinic', clinicCode);
  url.searchParams.set('month', state.monthStr);

  showLoader();
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
    
    rooms.sort((a,b)=>{
      const ia = DEPT_ORDER.indexOf(a);
      const ib = DEPT_ORDER.indexOf(b);
      if (ia===-1 && ib===-1) return a.localeCompare(b,'ja');
      if (ia===-1) return 1; if (ib===-1) return -1;
      return ia - ib;
    });

    renderCalendar();
  } catch(e) {
    console.error(e);
  } finally {
    hideLoader();
  }
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  const p = new URLSearchParams(location.search);
  const c = (p.get('clinic') || '').trim();
  clinicCode = /^\d{3}$/.test(c) ? c : '001';
  
  const u = new URL(location.href);
  u.searchParams.set('clinic', clinicCode);
  history.replaceState(null, '', u);

  state.monthStr = yyyymm(new Date());

  const prevBtn = document.getElementById('prevMonth');
  if(prevBtn) prevBtn.onclick = ()=>{
    const [y,m] = state.monthStr.split('-').map(Number);
    state.monthStr = yyyymm(new Date(y, m-2, 1));
    fetchSchedule();
  };
  
  const nextBtn = document.getElementById('nextMonth');
  if(nextBtn) nextBtn.onclick = ()=>{
    const [y,m] = state.monthStr.split('-').map(Number);
    state.monthStr = yyyymm(new Date(y, m, 1));
    fetchSchedule();
  };

  const cal = document.getElementById('calendar');
  if(cal) cal.addEventListener('click', (e) => {
    const td = e.target.closest('td[data-entry]');
    if (!td) return;
    try {
      const payload = JSON.parse(td.dataset.entry);
      showCellModal(payload);
    } catch (_) { }
  });

  fetchSchedule();
});
