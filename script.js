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
let dates = [];
let rooms = [];
let schedule = {};
let holidays = [];
let clinicCode = null;      // URL ?clinic= から決定
let clinicName = "";        // APIから取得
let minYearMonth = "";      // "YYYY-MM"
let maxYearMonth = "";      // "YYYY-MM"

// 内部状態：表示中のオフセット（0=今月）
let monthOffset = 0;

// ===== Util =====
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
function jpDow(dateObj) { return ["日","月","火","水","木","金","土"][dateObj.getDay()]; }

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

// 月曜始まりのカレンダー情報（※ズレ防止の根っこ）
function calcMonthInfo(offset) {
  const now = new Date();
  const baseDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year  = baseDate.getFullYear();
  const month = baseDate.getMonth();           // 0-11

  // 日曜(0)→6, 月曜(1)→0 …（＝月曜起点）
  const sunday0 = new Date(year, month, 1).getDay();
  const firstWeekday = (sunday0 + 6) % 7;

  const totalDays = new Date(year, month + 1, 0).getDate();
  const numWeeks  = Math.ceil((firstWeekday + totalDays) / 7);
  return { year, month, firstWeekday, totalDays, numWeeks };
}

// メイン描画（GAS版の renderCalendar と同じクラス名/HTML構造）
function renderCalendar(offset = 0) {
  const { year, month, firstWeekday, totalDays, numWeeks } = calcMonthInfo(offset);

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

        // 曜日色
        if (d === 5) td.classList.add('saturday');
        if (d === 6) td.classList.add('sunday');

        // 祝日ハイライト
        const label = `${month + 1}/${dayNum}`;
        if (holidaySet.has(label)) td.classList.add('holiday');

        // 今日
        const today = new Date();
        if (year === today.getFullYear() && month === today.getMonth() && dayNum === today.getDate()) {
          td.classList.add('today-cell');
        }
      }
      trWeek.appendChild(td);
    }
    tbody.appendChild(trWeek);

    // (b) その週の “全科で医師が入っていない日” を先に判定
    const dayHasDoctor = {};
    for (let d = 0; d < 7; d++) {
      const dayNum = w * 7 + d - firstWeekday + 1;
      if (dayNum < 1 || dayNum > totalDays) continue;

      // 👇 キー生成を “日付の実曜日” で統一（ズレの根治）
      const key = `${month + 1}/${dayNum}(${jpDow(new Date(year, month, dayNum))})`;
      dayHasDoctor[dayNum] = rooms.some(room => {
        const e = schedule[room]?.[key];
        const disp = e?.displayName || e?.name || '';
        return !!disp && disp !== '休診';
      });
    }

    // (c) 診療科ごと
    rooms.forEach((room, rIndex) => {
      const trRoom = document.createElement('tr');

      const tdRoom = document.createElement('td');
      tdRoom.textContent = room;
      trRoom.appendChild(tdRoom);

      for (let d = 0; d < 7; d++) {
        const td = document.createElement('td');
        const dayNum = w * 7 + d - firstWeekday + 1;

        if (dayNum >= 1 && dayNum <= totalDays) {
          const key = `${month + 1}/${dayNum}(${jpDow(new Date(year, month, dayNum))})`;
          const e = schedule[room]?.[key];

          // その日が “全科休診” の場合：最上段だけ 休診日 (rowSpan)
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
            // その日全体としては医師がいる → “–”
            td.textContent = dayHasDoctor[dayNum] ? "−" : "休診";
            if (!dayHasDoctor[dayNum]) td.classList.add("kyushin-cell");
            td.setAttribute("aria-label", `${month + 1}/${dayNum} ${room} ${td.textContent}`);
          }
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
async function fetchSchedule(offset = 0) {
  const url = new URL(GAS_API);
  url.searchParams.set('action', 'schedule');
  url.searchParams.set('clinic', clinicCode);

  // “GAS側で今月/offset解釈” に寄せるため、monthは渡さない運用
  // 必要なら以下を有効化：
  // const base = new Date();
  // const monthStr = yyyymm(new Date(base.getFullYear(), base.getMonth() + offset, 1));
  // url.searchParams.set('month', monthStr);

  url.searchParams.set('t', Date.now()); // キャッシュ回避

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) throw new Error('API error ' + res.status);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'API response not ok');

  // GASのJSONと同じ取り回し
  clinicName     = json.clinicName || '';
  const data     = json.data || {};
  dates          = Array.isArray(data.dates) ? data.dates : [];
  rooms          = Array.isArray(data.rooms) ? data.rooms.slice() : [];
  schedule       = data.schedule || {};
  holidays       = Array.isArray(data.holidays) ? data.holidays : [];
  minYearMonth   = data.minYearMonth || "";
  maxYearMonth   = data.maxYearMonth || "";

  // 表示順
  rooms.sort((a,b)=>{
    const ia = DEPT_ORDER.indexOf(a), ib = DEPT_ORDER.indexOf(b);
    if (ia===-1 && ib===-1) return a.localeCompare(b,'ja');
    if (ia===-1) return 1; if (ib===-1) return -1;
    return ia - ib;
  });

  // 前後ボタンの活性/非活性（min/maxはあれば使う）
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const thisYM = yyyymm(base);
  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');
  prevBtn.disabled = !!minYearMonth && (thisYM <= minYearMonth);
  nextBtn.disabled = !!maxYearMonth && (thisYM >= maxYearMonth);

  renderCalendar(offset);
}

// ===== 起動処理（GAS版の流儀に合わせた最小UI） =====
document.addEventListener('DOMContentLoaded', () => {
  clinicCode = getClinicFromURL();
  setClinicToURL(clinicCode); // URLを正規化

  // 月移動
  document.getElementById('prevMonth').addEventListener('click', () => {
    monthOffset -= 1;
    fetchSchedule(monthOffset).catch(e => alert(e));
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    monthOffset += 1;
    fetchSchedule(monthOffset).catch(e => alert(e));
  });

  // 初回
  fetchSchedule(monthOffset).catch(e => alert(e));
});
