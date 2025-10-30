// ===== 設定 =====
const GAS_API = 'https://script.google.com/macros/s/AKfycbyWf9oxetqrRGTBipHJmw29s2_bscP2W-gpcEaThKPYGLWyQosmB-7Eoj4vIksBv5-UMA/exec';

// ===== 既存GASのJSと同じ定義 =====
const WEEKDAYS = ["月","火","水","木","金","土","日"];
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

let state = {
  monthStr: null,   // ← これを使う
  clinicName: "",
  rooms: [],
  schedule: {},
  holidays: []
};

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
  const year  = yy;
  const month = mm - 1; // 0-11

  const firstUTCJST = new Date(Date.UTC(year, month, 1, 9));
  const sunday0 = firstUTCJST.getUTCDay();              // JSTでの 0(日)〜6(土)
  const firstWeekday = (sunday0 + 6) % 7;               // 月曜起点に変換

  const totalDays = new Date(year, month + 1, 0).getDate();
  const numWeeks  = Math.ceil((firstWeekday + totalDays) / 7);
  return { year, month, firstWeekday, totalDays, numWeeks };
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

// メイン描画（GAS版の renderCalendar と同じクラス名/HTML構造）
function renderCalendar(){
  // 1) まずは通常どおり JST で計算
  const { year, month, firstWeekday, totalDays, numWeeks } =
    calcMonthInfoFromYYYYMM_JST(state.monthStr);
  
  // 2) サーバーのキーで 1日の曜日を“上書き”
  //   rooms[0] の schedule を見て "<今月>/1(○)" の○から曜日を決定
  const monStartMap = { '月':0, '火':1, '水':2, '木':3, '金':4, '土':5, '日':6 };
  
  updateTitle(year, month);
  clearTable();
  renderHeader();

  const holidaySet = new Set((holidays || []).map(h => h.split('(')[0]));
  const tbody = document.querySelector('#calendar tbody');

  for (let w = 0; w < numWeeks; w++) {
    // (a) 日付行
    const trWeek = document.createElement('tr');
    trWeek.classList.add('week-row', 'date-row');

    const tdLabel = document.createElement('td');
    tdLabel.textContent = '';
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

        const nowJST = new Date(Date.now() + (9 * 60 * 60 * 1000));
        const todayY = nowJST.getUTCFullYear();
        const todayM = nowJST.getUTCMonth();
        const todayD = nowJST.getUTCDate();
        if (year === todayY && month === todayM && dayNum === todayD) {
          td.classList.add('today-cell');
        }
      }
      trWeek.appendChild(td);
    }
    tbody.appendChild(trWeek);

    // (b) 週内の “全科で医師がいない日” 判定
    const dayHasDoctor = {};
    for (let d = 0; d < 7; d++) {
      const dayNum = w * 7 + d - firstWeekday + 1;
      if (dayNum < 1 || dayNum > totalDays) continue;

      // ← 実日付から曜日を算出する“正”のキー生成（ズレ根治）
      const key = `${month + 1}/${dayNum}(${jpDowJST(year, month, dayNum)})`;

      dayHasDoctor[dayNum] = rooms.some(room => {
        const e = schedule[room]?.[key];
        const disp = e?.displayName || e?.name || '';
        return !!disp && disp !== '休診';
      });
    }

    // (c) 診療科行
    rooms.forEach((room, rIndex) => {
      const trRoom = document.createElement('tr');

      const tdRoom = document.createElement('td');
      tdRoom.textContent = room;
      trRoom.appendChild(tdRoom);

      for (let d = 0; d < 7; d++) {
        const td = document.createElement('td');
        const dayNum = w * 7 + d - firstWeekday + 1;
        if (dayNum < 1 || dayNum > totalDays) continue;

        const key = `${month + 1}/${dayNum}(${jpDowJST(year, month, dayNum)})`;
        
        const e = schedule[room]?.[key];

        if (!dayHasDoctor[dayNum]) {
          if (rIndex === 0) {
            td.textContent = "休診日";
            td.classList.add("kyushin-cell");
            td.setAttribute("aria-label", `${month + 1}/${dayNum} 休診日`);
            td.rowSpan = rooms.length;
            trRoom.appendChild(td);
          }
          continue;
        }

        if (e && (e.name || e.displayName)) {
          const t = `${e.timeFrom || ""}${e.timeTo ? '～' + e.timeTo : ''}`;
          td.innerHTML =
            `<div><span>${t}</span></div>
             <div><span${e.sex === "女" ? ' class="female"' : ''}>${e.displayName || e.name}</span>${e.tongueMark ? ` <span title="舌下">${e.tongueMark}</span>` : ''}</div>`;

          if (e.displayName === "休診") td.classList.add("kyushin-cell");
          if (e.displayName === "調整中") td.classList.add("cyousei-cell");

          if (e.displayName !== "休診") {
            td.style.cursor = "zoom-in";
            td.addEventListener('click', () => {
              showCellModal({
                date: `${month + 1}/${dayNum}`,
                dept: room,
                time: t,
                name: e.displayName || e.name,
                tongue: e.tongueMark
              });
            });
          }
        } else {
          td.textContent = dayHasDoctor[dayNum] ? "−" : "休診";
          if (!dayHasDoctor[dayNum]) td.classList.add("kyushin-cell");
          td.setAttribute("aria-label", `${month + 1}/${dayNum} ${room} ${td.textContent}`);
        }

        trRoom.appendChild(td);
      }
      tbody.appendChild(trRoom);
    });
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
  const url = new URL(GAS_API);
  url.searchParams.set('action', 'schedule');
  url.searchParams.set('clinic', clinicCode);
  url.searchParams.set('month', state.monthStr); // ★ここ重要
  url.searchParams.set('t', Date.now());
  console.log('API URL:', url.toString()); 

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

  // 並び順
  rooms.sort((a,b)=>{
    const ia = DEPT_ORDER.indexOf(a), ib = DEPT_ORDER.indexOf(b);
    if (ia===-1 && ib===-1) return a.localeCompare(b,'ja');
    if (ia===-1) return 1; if (ib===-1) return -1;
    return ia - ib;
  });

  // 前後ボタンの活性/非活性
  document.getElementById('prevMonth').disabled = !!minYearMonth && (state.monthStr <= minYearMonth);
  document.getElementById('nextMonth').disabled = !!maxYearMonth && (state.monthStr >= maxYearMonth);

  renderCalendar();
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

  // 初回
  fetchSchedule().catch(e => alert(e));
});

