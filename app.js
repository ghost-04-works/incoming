/* ─────────────────────────────────────────────
   Geon.입고확인  –  app.js
   ───────────────────────────────────────────── */

const CLIENT_ID = '666157816733-0uu1dkoda0ljjslrd479j371snkj62t7.apps.googleusercontent.com';
const SCOPE     = 'https://www.googleapis.com/auth/spreadsheets';

// ── State
let accessToken = null;
let tokenClient = null;
let tokenExpiry = 0;

// 각 항목의 이상없음/이상있음 상태
const status = {
  product:  null,
  qty:      null,
  orderQty: null,
  box:      null,
};

// ── Config
const cfg = {
  get: k => localStorage.getItem('gw_incoming_' + k) || '',
  set: (k, v) => localStorage.setItem('gw_incoming_' + k, v),
};

// ── DOM
const $ = id => document.getElementById(id);

// ── Boot
function init() {
  bindEvents();
  setDefaultDates();
  loadSettings();

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
  updateConnStatus(!!cfg.get('sheet_id'));
  updateLoginStatusUI();
  await updateDropdowns();
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

  // Settings
  $('btn-save-settings').addEventListener('click', saveSettings);
  $('btn-logout').addEventListener('click', () => { if (confirm('로그아웃하시겠어요?')) logout(); });

  // Member management
  $('btn-add-member').addEventListener('click', addMember);
  $('inp-new-member').addEventListener('keydown', e => { if (e.key === 'Enter') addMember(); });
}

// ── Dates
function setDefaultDates() {
  const today = new Date().toISOString().split('T')[0];
  $('inp-check-date').value = today;
}

// ── Settings
function loadSettings() {
  $('cfg-sheet-id').value   = cfg.get('sheet_id');
  $('cfg-sheet-name').value = cfg.get('sheet_name') || '입고확인';
}

async function saveSettings() {
  cfg.set('sheet_id',   $('cfg-sheet-id').value.trim());
  cfg.set('sheet_name', $('cfg-sheet-name').value.trim() || '입고확인');
  $('settings-status').textContent = '연결 테스트 중...';
  const result = await testConnection();
  $('settings-status').textContent = result.ok
    ? '✅ 연결 성공'
    : `❌ 연결 실패 — ${result.msg}`;
  updateConnStatus(result.ok);
}

async function testConnection() {
  const sheetId   = cfg.get('sheet_id');
  const sheetName = cfg.get('sheet_name') || '입고확인';
  if (!sheetId) return { ok: false, msg: '스프레드시트 ID가 없어요' };
  const tokenOk = await ensureToken();
  if (!tokenOk) return { ok: false, msg: '로그인 토큰 갱신 실패' };
  try {
    const range = encodeURIComponent(`${sheetName}!A1`);
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.ok) return { ok: true };
    const err = await res.json();
    return { ok: false, msg: `HTTP ${res.status}: ${err.error?.message || '알 수 없는 오류'}` };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

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

// ── Submit
async function submitForm() {
  const sheetId   = cfg.get('sheet_id');
  const sheetName = cfg.get('sheet_name') || '입고확인';

  if (!sheetId) {
    showToast('설정에서 스프레드시트 ID를 먼저 입력하세요', 'error');
    return;
  }

  const ok = await ensureToken();
  if (!ok) { showToast('로그인이 필요해요', 'error'); return; }

  $('btn-submit').disabled = true;
  $('btn-submit').textContent = '제출 중...';

  // 전체 상태 계산
  const allStatus = Object.values(status);
  const hasError  = allStatus.includes('이상있음');
  const allFilled = allStatus.every(v => v !== null);
  const overallStatus = !allFilled ? '미완료' : hasError ? '이상있음' : '이상없음';

  // 제출 시각
  const now = new Date();
  const submitTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const row = [
    submitTime,
    $('inp-date').value,
    $('inp-check-date').value,
    $('inp-inspector').value,
    $('inp-confirmer').value,
    $('res-product').value,
    status.product   || '미입력',
    $('res-qty').value,
    status.qty       || '미입력',
    $('res-order-qty').value,
    status.orderQty  || '미입력',
    $('res-box').value,
    status.box       || '미입력',
    $('inp-notes').value,
    overallStatus,
  ];

  try {
    // 헤더가 없으면 먼저 추가
    await ensureHeader(sheetId, sheetName);

    const range = encodeURIComponent(`${sheetName}!A:A`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [row] }),
      }
    );

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    // 성공
    $('success-desc').textContent = `${submitTime} 저장됨 — 전체 상태: ${overallStatus}`;
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
    '제출일시', '입고일', '검수일', '검수자', '확인',
    '제품명', '제품명_상태',
    '제품수량', '제품수량_상태',
    '발주수량', '발주수량_상태',
    '박스수량', '박스수량_상태',
    '특이사항', '전체상태',
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

// ── Member management (Google Sheets 기반)
const MEMBER_SHEET = '멤버';

async function fetchMembers() {
  const sheetId = cfg.get('sheet_id');
  if (!sheetId) return [];
  const ok = await ensureToken();
  if (!ok) return [];
  try {
    const range = encodeURIComponent(`${MEMBER_SHEET}!A:A`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return (json.values || []).flat().filter(v => v && v.trim());
  } catch { return []; }
}

async function addMember() {
  const name = $('inp-new-member').value.trim();
  if (!name) return;
  const sheetId = cfg.get('sheet_id');
  if (!sheetId) { showToast('설정에서 스프레드시트 ID를 먼저 입력하세요', 'error'); return; }

  const members = await fetchMembers();
  if (members.includes(name)) { showToast('이미 있는 이름이에요', 'error'); return; }

  const ok = await ensureToken();
  if (!ok) return;

  try {
    await ensureMemberSheet(sheetId);
    const range = encodeURIComponent(`${MEMBER_SHEET}!A:A`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[name]] }),
      }
    );
    if (!res.ok) throw new Error('추가 실패');
    $('inp-new-member').value = '';
    showToast(`${name} 추가됐어요`, 'success');
    await renderMemberList();
    await updateDropdowns();
  } catch (e) {
    showToast('추가 실패: ' + e.message, 'error');
  }
}

async function removeMember(name) {
  if (!confirm(`'${name}'을(를) 삭제할까요?`)) return;
  const sheetId = cfg.get('sheet_id');
  if (!sheetId) return;
  const ok = await ensureToken();
  if (!ok) return;

  try {
    // 전체 데이터 읽기
    const range = encodeURIComponent(`${MEMBER_SHEET}!A:A`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const json = await res.json();
    const values = (json.values || []).flat();

    // 해당 이름의 행 인덱스 찾기 (1-based)
    const rowIdx = values.findIndex(v => v === name);
    if (rowIdx === -1) return;

    // 스프레드시트 ID 가져와서 시트 ID 확인
    const ssRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const ssJson = await ssRes.json();
    const sheet = ssJson.sheets.find(s => s.properties.title === MEMBER_SHEET);
    if (!sheet) return;
    const sheetGid = sheet.properties.sheetId;

    // 해당 행 삭제
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 }
            }
          }]
        }),
      }
    );
    showToast(`${name} 삭제됐어요`, 'success');
    await renderMemberList();
    await updateDropdowns();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

async function ensureMemberSheet(sheetId) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const json = await res.json();
  const exists = json.sheets?.some(s => s.properties.title === MEMBER_SHEET);
  if (exists) return;
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: MEMBER_SHEET } } }] }),
    }
  );
}

async function renderMemberList() {
  const el = $('member-list');
  el.innerHTML = `<div style="font-size:13px;color:var(--text3);padding:4px 0;">불러오는 중...</div>`;
  const members = await fetchMembers();
  if (!members.length) {
    el.innerHTML = `<div style="font-size:13px;color:var(--text3);padding:4px 0;">멤버가 없어요</div>`;
    return;
  }
  el.innerHTML = members.map(name => `
    <div style="display:flex;align-items:center;gap:8px;background:var(--bg3);border-radius:8px;padding:9px 12px;">
      <span style="flex:1;font-size:14px;">${escHtml(name)}</span>
      <button onclick="removeMember('${escHtml(name)}')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0;line-height:1;">✕</button>
    </div>
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
  $('res-product').value = '';
  $('res-qty').value = '';
  $('res-order-qty').value = '';
  $('res-box').value = '';
  $('inp-notes').value = '';
  $('btn-submit').disabled = false;
  $('btn-submit').textContent = '제출';

  // 토글 초기화
  Object.keys(status).forEach(k => status[k] = null);
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
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
