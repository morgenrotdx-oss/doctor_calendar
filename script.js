// ===== 設定 =====
const API = 'https://script.google.com/macros/s/AKfycbyWf9oxetqrRGTBipHJmw29s2_bscP2W-gpcEaThKPYGLWyQosmB-7Eoj4vIksBv5-UMA/exec';

// 診療科の表示順（未定義は後ろ・五十音）
const DEPT_ORDER = ["小児科１診","小児科２診","小児科３診","耳鼻科１診","耳鼻科２診","耳鼻科３診","皮膚科","形成外科","小児科夜診","耳鼻科夜診"];

// ===== 状態 =====
let state = {
  clinic: null,          // "001"
  monthStr: null,        // "YYYY-MM"（nullなら今月をサーバに任せる）
  clinicName: "",
  dates: [],
  rooms: [],
  schedule: {},
  holidays: [],
  minYM: null,
  maxYM: null
};

// ===== Util =====
function jpDow(dt) {
  return ["日","月","火","水","木","金","土"][ dt.getDay() ];
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
function jpDow(d)  { return ["日","月","火","水","木","金","土"][d.getDay()]; }

// ===== レンダ系 =====
function renderHeader() {
  const thead = document.querySelector('#calendar thead');
  thead.innerHTML = '';
  const tr = document.createElement('tr');
  tr.appendChild(document.createElement('th')); // 左端：診療科
  ["月","火","水","木","金","土","日"].forEach((wd,i)=>{
    const th = document.createElement('th');
    th.textContent = wd;
    if (i===5) th.classList.add('saturday');
    if (i===6) th.classList.add('sunday');
    tr.appendChild(th);
  });
  thead.appendChild(tr);
}
function clearBody(){ document.querySelector('#calendar tbody').innerHTML=''; }

function calcMonthInfo(monthStr){
  const [yy, mm] = monthStr.split('-').map(Number);
  const year = yy, month = mm - 1;                    // 0-11
  const first = new Date(year, month, 1);
  const totalDays = new Date(year, month + 1, 0).getDate();

  // 日曜(0)→6, 月曜(1)→0, … の形に変換（＝月曜始まり）
  const firstWeekday = (first.getDay() + 6) % 7;

  const numWeeks = Math.ceil((firstWeekday + totalDays) / 7);
  return { year, month, firstWeekday, totalDays, numWeeks };
}

function updateTitle(year, month){
  const name = state.clinicName ? `${state.clinicName} ` : '';
  document.getElementById('tableTitle').textContent = `${name}${year}年${month+1}月 医師勤務表`;
}

function renderCalendar(){
  const monthStr = state.monthStr || yyyymm(new Date());
  const { year, month, firstWeekday, totalDays, numWeeks } = calcMonthInfo(monthStr);

  updateTitle(year, month);
  renderHeader();
  clearBody();

  const tbody = document.querySelector('#calendar tbody');
  const holidaySet = new Set((state.holidays||[]).map(h => h.split('(')[0]));

  // 週ごと
  for (let w=0; w<numWeeks; w++){
    // (a) 日付行
    const trDate = document.createElement('tr');
    trDate.className = 'date-row';
    trDate.appendChild(document.createElement('td'));
    const weekBandClass = 'week-band';

    for(let d=0; d<7; d++){
      const td = document.createElement('td');
      const day = w*7 + d - firstWeekday + 1;
      if (day>=1 && day<=totalDays){
        td.textContent = day;
        if (d===5) td.classList.add('saturday');
        if (d===6) td.classList.add('sunday');
        const label = `${month+1}/${day}`;
        if (holidaySet.has(label)) td.classList.add('holiday');
        const today = new Date();
        if (year===today.getFullYear() && month===today.getMonth() && day===today.getDate()) {
          td.classList.add('today-cell');
        }
      }
      trDate.appendChild(td);
    }
    tbody.appendChild(trDate);

    // (b) その週に医師が一人もいない日（全科で）の判定
    const dayHasDoctor = {};
    for(let d=0; d<7; d++){
      const day = w*7 + d - firstWeekday + 1;
      if (day<1 || day>totalDays) continue;
      const key = `${month+1}/${day}(${jpDow(new Date(year,month,day))})`;
      dayHasDoctor[day] = state.rooms.some(room=>{
        const e = state.schedule[room]?.[key];
        const disp = e?.displayName || e?.name || '';
        return !!disp && disp !== '休診';
      });
    }

    // (c) 診療科ごと
    state.rooms.forEach((room, rIdx)=>{
      const tr = document.createElement('tr');
      const tdRoom = document.createElement('td');
      tdRoom.textContent = room;
      tdRoom.classList.add(weekBandClass); 
      tr.appendChild(tdRoom);

      for(let d=0; d<7; d++){
        const day = w*7 + d - firstWeekday + 1;
        if (day<1 || day>totalDays) continue;

        // まるごと休診日（すべての科で医師なし）
        if (!dayHasDoctor[day]) {
          if (rIdx===0) {
            const td = document.createElement('td');
            td.textContent = '休診日';
            td.className   = 'kyushin-cell';
            td.rowSpan     = state.rooms.length;
            tr.appendChild(td);
          }
          continue;
        }

        const td = document.createElement('td');
        const key = `${month+1}/${day}(${jpDow(new Date(year,month,day))})`;
        const e = state.schedule[room]?.[key];

        if (e && (e.name || e.displayName)) {
          const t = `${e.timeFrom || ""}${e.timeTo ? '～'+e.timeTo : ''}`;
          td.innerHTML = `
            <div><span>${t}</span></div>
            <div><span${e.sex==="女"?' class="female"':''}>${e.displayName || e.name}</span>${e.tongueMark?` <span title="舌下">${e.tongueMark}</span>`:''}</div>
          `;
          if (e.displayName === '休診') td.classList.add('kyushin-cell');
          if (e.displayName === '調整中') td.classList.add('cyousei-cell');
        } else {
          td.textContent = '−';
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
  }
}

// ===== データ取得 =====
async function fetchSchedule(){
  const url = new URL(API);
  url.searchParams.set('action','schedule');
  url.searchParams.set('clinic', state.clinic);
  if (state.monthStr) url.searchParams.set('month', state.monthStr); // URLにmonthは出さない運用でもOK
  url.searchParams.set('t', Date.now());

  document.getElementById('meta').textContent = `Source: ${url.toString()}`;

  const res = await fetch(url);
  if(!res.ok) throw new Error('API '+res.status);
  const json = await res.json();
  if(!json.ok) throw new Error(json.error || 'API error');

  const data = json.data || {};
  state.clinicName = json.clinicName || '';
  state.dates      = data.dates || [];
  state.rooms      = (data.rooms||[]).sort((a,b)=>{
    const ia = DEPT_ORDER.indexOf(a), ib = DEPT_ORDER.indexOf(b);
    if (ia===-1 && ib===-1) return a.localeCompare(b,'ja');
    if (ia===-1) return 1; if (ib===-1) return -1;
    return ia - ib;
  });
  state.schedule   = data.schedule || {};
  state.holidays   = data.holidays || [];
  state.minYM      = data.minYearMonth || null;
  state.maxYM      = data.maxYearMonth || null;

  // 初回で monthStr 未指定なら、現在月をセット（前後ボタン用）
  if (!state.monthStr) state.monthStr = yyyymm(new Date());
  renderCalendar();
}

// ===== 初期化 & ハンドラ =====
document.addEventListener('DOMContentLoaded', async ()=>{
  state.clinic = getClinicFromURL();
  document.getElementById('clinicInput').value = state.clinic;

  // クリックで再読込（URLは clinic のみ更新）
  document.getElementById('reloadBtn').onclick = ()=>{
    const v = document.getElementById('clinicInput').value.trim();
    state.clinic = /^\d{3}$/.test(v) ? v : '001';
    document.getElementById('clinicInput').value = state.clinic;
    setClinicToURL(state.clinic);
    fetchSchedule().catch(err => alert(err));
  };

  // 月移動（URLは変えず内部状態だけ month を変える）
  document.getElementById('prevMonth').onclick = ()=>{
    const [y,m] = state.monthStr.split('-').map(Number);
    state.monthStr = yyyymm(new Date(y, m-2, 1));
    fetchSchedule().catch(err => alert(err));
  };
  document.getElementById('nextMonth').onclick = ()=>{
    const [y,m] = state.monthStr.split('-').map(Number);
    state.monthStr = yyyymm(new Date(y, m, 1));
    fetchSchedule().catch(err => alert(err));
  };

  // Enterキーで再読込
  document.getElementById('clinicInput').addEventListener('keydown', e=>{
    if (e.key === 'Enter') document.getElementById('reloadBtn').click();
  });

  // 初回読み込み
  fetchSchedule().catch(err => alert(err));
});
