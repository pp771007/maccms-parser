// 多帳號切換下拉:列出已解鎖帳號可自由切換(免再輸密碼)、用密碼新增另一個帳號、單獨/全部登出。
// 自包含、非 module,DOMContentLoaded 後執行;後端端點見 blueprints/auth.py。
(function () {
  function init() {
    const btn = document.getElementById('acctBtn');
    const menu = document.getElementById('acctMenu');
    const nameEl = document.getElementById('acctBtnName');
    const listEl = document.getElementById('acctList');
    const addPw = document.getElementById('acctAddPw');
    const addBtn = document.getElementById('acctAddBtn');
    const addMsg = document.getElementById('acctAddMsg');
    if (!btn || !menu || !listEl) return;

    const roleLabel = (r) => (r === 'admin' ? '管理員' : '會員');
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    async function loadAccounts() {
      try {
        const r = await fetch('/account/list', { headers: { Accept: 'application/json' } });
        if (!r.ok) return;
        const data = await r.json();
        const accts = data.accounts || [];
        const active = accts.find((a) => a.active);
        if (active && nameEl) nameEl.textContent = active.nickname;
        listEl.innerHTML = '';
        accts.forEach((a) => {
          const row = document.createElement('div');
          row.className = 'acct-item' + (a.active ? ' active' : '');

          const sw = document.createElement('button');
          sw.type = 'button';
          sw.className = 'acct-item-switch';
          sw.innerHTML =
            '<span class="acct-item-name">' + esc(a.nickname) + '</span>' +
            '<span class="acct-role">' + roleLabel(a.role) + '</span>' +
            (a.active ? '<span class="acct-check">✓</span>' : '');
          sw.addEventListener('click', () => switchTo(a.account_id, a.active));
          row.appendChild(sw);

          const lo = document.createElement('a');
          lo.className = 'acct-item-logout';
          lo.href = '/logout?account_id=' + encodeURIComponent(a.account_id);
          lo.title = '登出此帳號';
          lo.textContent = '✕';
          row.appendChild(lo);

          listEl.appendChild(row);
        });
      } catch (e) { /* ignore */ }
    }

    async function switchTo(accountId, isActive) {
      if (isActive) { closeMenu(); return; }
      try {
        const r = await fetch('/account/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accountId }),
        });
        if (r.ok) location.reload();
      } catch (e) { /* ignore */ }
    }

    async function addAccount() {
      const pw = addPw ? addPw.value : '';
      if (!pw) return;
      if (addMsg) addMsg.hidden = true;
      addBtn.disabled = true;
      try {
        const r = await fetch('/account/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.status === 'success') { location.reload(); return; }
        if (addMsg) { addMsg.textContent = data.message || '新增失敗'; addMsg.hidden = false; }
      } catch (e) {
        if (addMsg) { addMsg.textContent = '新增失敗，請重試'; addMsg.hidden = false; }
      } finally {
        addBtn.disabled = false;
      }
    }

    function openMenu() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); loadAccounts(); }
    function closeMenu() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }

    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden ? openMenu() : closeMenu(); });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu();
    });
    if (addBtn) addBtn.addEventListener('click', addAccount);
    if (addPw) addPw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAccount(); } });

    // 進頁面先載一次,把目前帳號暱稱顯示在按鈕上
    loadAccounts();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
