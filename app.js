/* ─────────────────────────────────────────────
   Geon.입고확인  –  app.js
   ───────────────────────────────────────────── */

const CLIENT_ID = '666157816733-0uu1dkoda0ljjslrd479j371snkj62t7.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile';

// ── State
let accessToken = null;
let tokenClient = null;
let tokenExpiry = 0;

// 품목 데이터 배열
let items = [];
let itemIdCounter = 0;

// ── Sheet config (고정값)
const SHEET_ID   = '1z71UijTdDOeuyaFVTaV6Xjn6MRP4wNfy1cKiy24Cyg4';
const SHEET_NAME = '입고확인';

// ── DOM
const $ = id => document.getElementById(id);

// ── Boot
function init() {
  bindEvents();
  setDefaultDates();
  bindDateInput('inp-date');
  bindDateInput('inp-check-date');

  // 기존 서비스워커 해제
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
  }

  waitForGIS(() => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: onTokenReceived,
      error_callback: onTokenError,
    });

    const saved = sessionStorage.getItem('gw_in_token');
    const exp   = parseInt(sessionStorage.getItem('gw_in_token_exp') || '0');
    if (saved && Date.now() < exp) {
      accessToken = saved;
      tokenExpiry = exp;
      onLoginSuccess();
    } else {
      $('lock-screen').style.display = 'flex';
    }
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function waitForGIS(cb) {
  if (typeof google !== 'undefined' && google.accounts) cb();
  else setTimeout(() => waitForGIS(cb), 100);
}

// ── OAuth
function startGoogleLogin() {
  $('lock-error').textContent = '';
  $('lock-submit').textContent = '로그인 중...';
  $('lock-submit').disabled = true;
  if (tokenClient) tokenClient.requestAccessToken({ prompt: '' });
  else waitForGIS(() => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: onTokenReceived,
      error_callback: onTokenError,
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

function onTokenReceived(resp) {
  if (resp.error) { onTokenError(resp); return; }
  accessToken = resp.access_token;
  tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
  sessionStorage.setItem('gw_in_token', accessToken);
  sessionStorage.setItem('gw_in_token_exp', tokenExpiry.toString());
  onLoginSuccess();
}

function onTokenError(err) {
  const msg = err.error === 'access_denied'
    ? '접근이 거부됐어요. 조직 계정으로 로그인해 주세요.'
    : '로그인에 실패했어요. 다시 시도해 주세요.';
  $('lock-error').textContent = msg;
  $('lock-submit').innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg> Google 로그인`;
  $('lock-submit').disabled = false;
}

async function onLoginSuccess() {
  $('lock-screen').style.display = 'none';
  updateConnStatus(!!SHEET_ID);
  updateLoginStatusUI();
  await fetchUserInfo();
  await updateDropdowns();
  suppliers = await fetchSuppliers();
  addItem();
}

async function fetchUserInfo() {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return;
    const json = await res.json();
    const name = json.name || json.email || '';
    const el = $('inp-author');
    if (el) el.textContent = name;
    // 제출 시 사용할 수 있도록 저장
    window._authorName = name;
  } catch (e) {
    window._authorName = '';
  }
}

function logout() {
  if (accessToken && typeof google !== 'undefined') google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  tokenExpiry = 0;
  sessionStorage.removeItem('gw_in_token');
  sessionStorage.removeItem('gw_in_token_exp');
  $('lock-submit').innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg> Google 로그인`;
  $('lock-submit').disabled = false;
  $('lock-error').textContent = '';
  $('lock-screen').style.display = 'flex';
}

async function ensureToken() {
  if (accessToken && Date.now() < tokenExpiry) return true;
  return new Promise(resolve => {
    tokenClient.callback = resp => {
      if (resp.error) { resolve(false); return; }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      sessionStorage.setItem('gw_in_token', accessToken);
      sessionStorage.setItem('gw_in_token_exp', tokenExpiry.toString());
      resolve(true);
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// ── Events
function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      $('form-view').classList.toggle('active', name === 'form');
      $('settings-view').classList.toggle('active', name === 'settings');
      if (name === 'settings') {
        updateLoginStatusUI();
        renderMemberList();
      }
    });
  });

  // Status toggles
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.dataset.item;
      const val  = btn.dataset.val;
      status[item] = val;
      // Update UI
      const parent = btn.closest('.status-toggle');
      parent.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Submit
  $('btn-submit').addEventListener('click', submitForm);

  // New entry
  $('btn-new-entry').addEventListener('click', resetForm);

  // Add item
  $('btn-add-item').addEventListener('click', addItem);

  // Settings - 로그아웃만
  $('btn-logout').addEventListener('click', () => { if (confirm('로그아웃하시겠어요?')) logout(); });
}

// ── Dates
function setDefaultDates() {
  const today = new Date();
  const formatted = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  $('inp-check-date').value = formatted;
}

function bindDateInput(id) {
  const el = $(id);
  el.addEventListener('input', e => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 4) v = v.slice(0,4) + '-' + v.slice(4);
    if (v.length > 7) v = v.slice(0,7) + '-' + v.slice(7);
    if (v.length > 10) v = v.slice(0,10);
    e.target.value = v;
  });
}

// ── Settings
function updateConnStatus(ok) {
  $('conn-dot').className = 'status-dot ' + (ok ? 'ok' : 'err');
  $('conn-text').textContent = ok ? '연결됨' : '미연결';
}

function updateLoginStatusUI() {
  const el = $('login-status-desc');
  if (!el) return;
  if (accessToken && Date.now() < tokenExpiry) {
    el.textContent = '✅ 로그인됨';
    el.style.color = 'var(--accent)';
  } else {
    el.textContent = '로그인 필요';
    el.style.color = 'var(--text2)';
  }
}

// ── Receipt number (YYMMDD-NNN)
async function generateReceiptNo() {
  const now = new Date();
  const yy  = String(now.getFullYear()).slice(2);
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const dd  = String(now.getDate()).padStart(2, '0');
  const prefix = `${yy}${mm}${dd}`;

  try {
    const ok = await ensureToken();
    if (!ok) return `${prefix}-001`;

    const range = encodeURIComponent(`${SHEET_NAME}!A:A`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return `${prefix}-001`;

    const json = await res.json();
    const values = (json.values || []).flat();
    // 오늘 날짜 prefix로 시작하는 고유 접수번호 개수 카운트
    const todayNos = new Set(values.filter(v => String(v).startsWith(prefix)));
    const seq = String(todayNos.size + 1).padStart(3, '0');
    return `${prefix}-${seq}`;
  } catch {
    return `${prefix}-001`;
  }
}

// ── Submit
async function submitForm() {
  const sheetId   = SHEET_ID;
  const sheetName = SHEET_NAME;

  if (!sheetId) { showToast('설정에서 스프레드시트 ID를 먼저 입력하세요', 'error'); return; }
  if (!items.length) { showToast('품목을 추가해 주세요', 'error'); return; }

  // 필수 항목 검증
  if (!$('inp-date').value)       { showToast('입고일을 입력해 주세요', 'error'); $('inp-date').focus(); return; }
  if (!$('inp-check-date').value) { showToast('검수일을 입력해 주세요', 'error'); $('inp-check-date').focus(); return; }
  if (!$('inp-inspector').value)  { showToast('검수자를 선택해 주세요', 'error'); return; }
  if (!$('inp-confirmer').value)  { showToast('확인자를 선택해 주세요', 'error'); return; }

  const ok = await ensureToken();
  if (!ok) { showToast('로그인이 필요해요', 'error'); return; }

  $('btn-submit').disabled = true;
  $('btn-submit').textContent = '제출 중...';

  const now = new Date();
  const submitTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  // 접수번호 생성 (YYMMDD-NNN)
  const receiptNo = await generateReceiptNo();

  // 품목별로 한 행씩
  const rows = items.map((item, idx) => {    // 빈 항목 여부 (공급처, 제품명, 수량 모두 비어있으면 스킵)
    const isEmpty = !item.supplier && !item.product && !item.qty && !item.orderQty && !item.box && !item.notes;

    const statuses = [item.productStatus, item.orderQtyStatus];
    const hasError  = statuses.includes('이상있음');
    const allFilled = statuses.every(v => v !== null);
    const isComplete = allFilled && !hasError ? '이상없음' : allFilled ? '이상있음' : '미완료';

    return isEmpty ? null : [
      receiptNo,
      item.supplier,
      item.product,
      item.productStatus   || '미입력',
      item.qty,
      item.orderQty,
      item.orderQtyStatus  || '미입력',
      item.box,
      item.notes,
      $('inp-date').value,
      $('inp-check-date').value,
      $('inp-inspector').value,
      $('inp-confirmer').value,
      window._authorName || '',
      submitTime,
      isComplete,
    ];
  });

  const validRows = rows.filter(r => r !== null);
  if (!validRows.length) {
    showToast('작성된 품목이 없어요', 'error');
    $('btn-submit').disabled = false;
    $('btn-submit').textContent = '제출';
    return;
  }

  try {
    await ensureHeader(sheetId, sheetName);
    const range = encodeURIComponent(`${sheetName}!A:A`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: validRows }),
      }
    );
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    $('success-desc').textContent = `${submitTime} 저장됨 — ${validRows.length}개 품목`;
    $('success-screen').classList.add('show');
  } catch (e) {
    showToast('제출 실패: ' + e.message, 'error');
    $('btn-submit').disabled = false;
    $('btn-submit').textContent = '제출';
  }
}

async function ensureHeader(sheetId, sheetName) {
  const range = encodeURIComponent(`${sheetName}!A1`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const json = await res.json();
  if (json.values && json.values.length > 0) return; // 이미 있음

  // 헤더 추가
  const header = [
    '접수번호', '공급처', '제품명', '제품명_상태',
    '제품수량', '발주수량', '발주수량_상태',
    '박스수량', '특이사항',
    '입고일', '검수일', '검수자', '확인자', '작성자', '작성일시', '검수결과',
  ];
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [header] }),
    }
  );
}

// ── Item management
let suppliers = []; // 공급처 목록 캐시

function addItem() {
  const id = ++itemIdCounter;
  items.push({ id, supplier: '', product: '', qty: '', orderQty: '', box: '', notes: '', productStatus: null, orderQtyStatus: null });
  renderItems();
}

function removeItem(id) {
  if (items.length <= 1) { showToast('최소 1개 품목이 필요해요', 'error'); return; }
  items = items.filter(it => it.id !== id);
  renderItems();
}

function setItemStatus(id, field, val) {
  const item = items.find(it => it.id === id);
  if (item) item[field] = val;
}

function renderItems() {
  const container = $('items-container');
  const supplierOptions = ['<option value="">선택</option>',
    ...suppliers.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`)
  ].join('');

  container.innerHTML = items.map((item, idx) => `
    <div class="item-card" id="item-${item.id}">
      <div class="item-card-header">
        <span class="item-num">ITEM ${idx + 1}</span>
        <button class="btn-remove-item" onclick="removeItem(${item.id})">✕</button>
      </div>
      <div class="item-fields">

        <!-- 공급처 -->
        <div class="item-field">
          <div class="item-field-label">공급처</div>
          <div class="item-field-row">
            <select class="check-result-input" id="supplier-sel-${item.id}"
              onchange="items.find(i=>i.id===${item.id}).supplier=this.value;toggleSupplierInput(${item.id})">
              ${supplierOptions}
            </select>
            <button class="status-btn ok" style="flex-shrink:0;padding:8px 10px;font-size:14px;"
              onclick="showSupplierAdd(${item.id})" title="공급처 추가">＋</button>
          </div>
          <div id="supplier-add-${item.id}" style="display:none;margin-top:6px;">
            <div class="item-field-row">
              <input class="check-result-input" id="supplier-inp-${item.id}" type="text" placeholder="새 공급처 이름" />
              <button class="status-btn ok" style="flex-shrink:0;padding:8px 10px;"
                onclick="addSupplierInline(${item.id})">저장</button>
            </div>
          </div>
        </div>

        <!-- 제품명 -->
        <div class="item-field">
          <div class="item-field-label">제품명 · 입고품 및 인보이스 확인</div>
          <div class="item-field-row">
            <input class="check-result-input" type="text" placeholder="제품명 입력"
              value="${escHtml(item.product)}"
              oninput="items.find(i=>i.id===${item.id}).product=this.value" />
            <div class="status-toggle">
              <button class="status-btn ok ${item.productStatus === '이상없음' ? 'active' : ''}"
                onclick="setItemStatus(${item.id},'productStatus','이상없음');toggleStatus(this)">✓</button>
              <button class="status-btn err ${item.productStatus === '이상있음' ? 'active' : ''}"
                onclick="setItemStatus(${item.id},'productStatus','이상있음');toggleStatus(this)">✗</button>
            </div>
          </div>
        </div>

        <!-- 제품 수량 (토글 없음) -->
        <div class="item-field">
          <div class="item-field-label">제품 수량 · 실수량 확인</div>
          <input class="check-result-input" type="number" placeholder="수량 입력" min="0"
            value="${item.qty}"
            oninput="items.find(i=>i.id===${item.id}).qty=this.value" />
        </div>

        <!-- 발주 수량 -->
        <div class="item-field">
          <div class="item-field-label">발주 수량 · 거래명세서, 인보이스 확인</div>
          <div class="item-field-row">
            <input class="check-result-input" type="number" placeholder="수량 입력" min="0"
              value="${item.orderQty}"
              oninput="items.find(i=>i.id===${item.id}).orderQty=this.value" />
            <div class="status-toggle">
              <button class="status-btn ok ${item.orderQtyStatus === '이상없음' ? 'active' : ''}"
                onclick="setItemStatus(${item.id},'orderQtyStatus','이상없음');toggleStatus(this)">✓</button>
              <button class="status-btn err ${item.orderQtyStatus === '이상있음' ? 'active' : ''}"
                onclick="setItemStatus(${item.id},'orderQtyStatus','이상있음');toggleStatus(this)">✗</button>
            </div>
          </div>
        </div>

        <!-- 박스 수량 (토글 없음) -->
        <div class="item-field">
          <div class="item-field-label">박스 수량 · 실수량 확인</div>
          <input class="check-result-input" type="number" placeholder="수량 입력" min="0"
            value="${item.box}"
            oninput="items.find(i=>i.id===${item.id}).box=this.value" />
        </div>

        <!-- 특이사항 -->
        <div class="item-field">
          <div class="item-field-label">특이사항</div>
          <textarea class="check-result-input" placeholder="특이사항이 있으면 입력해 주세요"
            style="resize:none;min-height:64px;line-height:1.5;"
            oninput="items.find(i=>i.id===${item.id}).notes=this.value">${escHtml(item.notes || '')}</textarea>
        </div>

      </div>
    </div>
  `).join('');

  // 저장된 공급처 값 복원
  items.forEach(item => {
    const sel = $(`supplier-sel-${item.id}`);
    if (sel && item.supplier) sel.value = item.supplier;
  });
}

function toggleStatus(btn) {
  const parent = btn.closest('.status-toggle');
  parent.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function showSupplierAdd(id) {
  const el = $(`supplier-add-${id}`);
  if (el) { el.style.display = el.style.display === 'none' ? '' : 'none'; }
  const inp = $(`supplier-inp-${id}`);
  if (inp) inp.focus();
}

function toggleSupplierInput(id) {
  // 드롭다운 선택 시 추가 입력 닫기
  const el = $(`supplier-add-${id}`);
  if (el) el.style.display = 'none';
}

async function addSupplierInline(id) {
  const inp = $(`supplier-inp-${id}`);
  const name = inp?.value.trim();
  if (!name) return;
  if (suppliers.includes(name)) {
    showToast('이미 있는 공급처예요', 'error');
    return;
  }
  const sheetId = SHEET_ID;
  if (!sheetId) { showToast('설정에서 스프레드시트 ID를 먼저 입력하세요', 'error'); return; }
  const ok = await ensureToken();
  if (!ok) return;
  try {
    await ensureSheetTab(sheetId, SUPPLIER_SHEET);
    const range = encodeURIComponent(`${SUPPLIER_SHEET}!A:A`);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[name]] }),
      }
    );
    suppliers.push(name);
    // 현재 아이템에 바로 선택
    items.find(i => i.id === id).supplier = name;
    inp.value = '';
    renderItems();
    showToast(`'${name}' 추가됐어요`, 'success');
  } catch (e) {
    showToast('추가 실패: ' + e.message, 'error');
  }
}

// ── Member & Supplier management (Google Sheets 기반)
const MEMBER_SHEET   = '멤버';
const SUPPLIER_SHEET = '공급처';

async function fetchSuppliers() {
  const sheetId = SHEET_ID;
  if (!sheetId) return [];
  const ok = await ensureToken();
  if (!ok) return [];
  try {
    const range = encodeURIComponent(`${SUPPLIER_SHEET}!A:A`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return (json.values || []).flat().filter(v => v && v.trim());
  } catch { return []; }
}

async function fetchMembers() {
  const sheetId = SHEET_ID;
  if (!sheetId) { showToast('시트ID 없음', 'error'); return []; }
  const ok = await ensureToken();
  if (!ok) { showToast('토큰 실패', 'error'); return []; }
  try {
    const range = encodeURIComponent(`${MEMBER_SHEET}!A:A`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const err = await res.json();
      showToast('멤버 로드 실패: ' + (err.error?.message || res.status), 'error');
      return [];
    }
    const json = await res.json();
    return (json.values || []).flat().filter(v => v && v.trim());
  } catch (e) {
    showToast('멤버 오류: ' + e.message, 'error');
    return [];
  }
}

// ── User info
let currentUserName = '';

async function fetchUserName() {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return '';
    const json = await res.json();
    return json.name || json.email || '';
  } catch { return ''; }
}

async function addMember() {} // 더 이상 사용 안 함
async function removeMember() {} // 더 이상 사용 안 함

async function ensureSheetTab(sheetId, tabName) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const json = await res.json();
  const exists = json.sheets?.some(s => s.properties.title === tabName);
  if (exists) return;
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
    }
  );
}

async function renderMemberList() {
  const el = $('member-list');
  if (!el) return;
  el.innerHTML = `<div style="font-size:13px;color:var(--text3);padding:4px 0;">불러오는 중...</div>`;
  const members = await fetchMembers();
  if (!members.length) {
    el.innerHTML = `<div style="font-size:13px;color:var(--text3);padding:4px 0;">멤버가 없어요 — 시트의 '멤버' 탭 A열에 이름을 입력하세요</div>`;
    return;
  }
  el.innerHTML = members.map(name => `
    <div style="background:var(--bg3);border-radius:8px;padding:9px 12px;font-size:14px;">${escHtml(name)}</div>
  `).join('');
}

async function updateDropdowns() {
  const members = await fetchMembers();
  ['inp-inspector', 'inp-confirmer'].forEach(id => {
    const sel = $(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="">선택</option>' +
      members.map(m => `<option value="${escHtml(m)}" ${m === cur ? 'selected' : ''}>${escHtml(m)}</option>`).join('');
  });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function resetForm() {
  $('success-screen').classList.remove('show');
  $('inp-date').value = '';
  setDefaultDates();
  $('inp-inspector').value = '';
  $('inp-confirmer').value = '';
  $('btn-submit').disabled = false;
  $('btn-submit').textContent = '제출';
  items = [];
  itemIdCounter = 0;
  addItem();
}

// ── Toast
let toastTimer;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3000);
}
