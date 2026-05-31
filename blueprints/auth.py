import os
import time
import json
import secrets
import threading
from flask import Blueprint, request, render_template, session, redirect, url_for, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from config import load_config, save_config, get_config_value, set_config_value
import storage

auth_bp = Blueprint('auth', __name__)

# --- Constants for login security ---
MAX_LOGIN_ATTEMPTS = 10
LOGIN_LOCKOUT_MINUTES = 15
LOGIN_LOCKOUT_TIME = LOGIN_LOCKOUT_MINUTES * 60  # seconds

# --- 以「來源 IP」為 key 的登入失敗計數(伺服器端,不靠 cookie)---
# 舊版只把計數放 session/cookie,攻擊者每次請求丟掉 cookie 就能重置計數、無限猜。
# 改成記在伺服器端、以 IP 區分,腳本丟 cookie 也躲不掉。
# 後端二選一(由 storage 自動判斷):
#   - 有連 KV(Vercel/Upstash)→ 整包計數存 KV,多個 serverless 實例共享、冷啟也不丟。
#   - 沒連 KV(Docker/本機)→ 用程序記憶體(單程序,已足夠)。
# 跨實例的 read-modify-write 沒上分散式鎖,brute-force 計數容許輕微誤差,影響不大。
_LOGIN_ATTEMPTS_KEY = 'login_attempts'  # storage key(KV 後端會自動加 maccms: 前綴)
_login_attempts_mem = {}  # 記憶體後端:ip -> {'count': int, 'lock_until': float}
_login_attempts_lock = threading.Lock()
# 預設用 TCP 對端 IP(remote_addr),避免攻擊者偽造 X-Forwarded-For 繞過。
# 若部署在反向代理後面(nginx/Traefik),設環境變數 TRUST_PROXY=1 改用 XFF 第一段。
_TRUST_PROXY = os.environ.get('TRUST_PROXY', '').lower() in ('1', 'true', 'yes')


def _client_ip():
    if _TRUST_PROXY:
        xff = request.headers.get('X-Forwarded-For', '')
        if xff:
            return xff.split(',')[0].strip()
    return request.remote_addr or 'unknown'


def _load_attempts():
    """讀出整包計數 dict。KV 後端回傳新 dict(改完要 _save 寫回);記憶體後端回傳同一個物件(原地改即可)。"""
    if storage.USE_KV:
        raw = storage.get_text(_LOGIN_ATTEMPTS_KEY)
        if raw:
            try:
                return json.loads(raw)
            except ValueError:
                return {}
        return {}
    return _login_attempts_mem


def _save_attempts(d):
    if storage.USE_KV:
        storage.set_text(_LOGIN_ATTEMPTS_KEY, json.dumps(d))
    # 記憶體後端:_load_attempts 回傳的就是同一物件,已原地更新,不需另外寫回


def _login_lock_remaining(ip):
    """這個 IP 還要鎖幾秒?0 表示沒被鎖。只讀不寫(省 KV 流量)。"""
    rec = _load_attempts().get(ip)
    now = time.time()
    if rec and rec.get('lock_until', 0) > now:
        return int(rec['lock_until'] - now)
    return 0


def _record_login_failure(ip):
    """記一次失敗,回傳 (剩餘可試次數, 是否剛觸發鎖定)。"""
    with _login_attempts_lock:
        d = _load_attempts()
        now = time.time()
        # 順手清掉過期且未鎖定的紀錄,避免無限長大
        for k in [k for k, v in list(d.items())
                  if k != ip and v.get('lock_until', 0) < now and v.get('count', 0) == 0]:
            d.pop(k, None)
        rec = d.setdefault(ip, {'count': 0, 'lock_until': 0})
        rec['count'] += 1
        if rec['count'] >= MAX_LOGIN_ATTEMPTS:
            rec['lock_until'] = now + LOGIN_LOCKOUT_TIME
            rec['count'] = 0  # 重置計數,進入鎖定視窗
            result = (0, True)
        else:
            result = (MAX_LOGIN_ATTEMPTS - rec['count'], False)
        _save_attempts(d)
        return result


def _clear_login_failures(ip):
    with _login_attempts_lock:
        d = _load_attempts()
        if ip in d:
            d.pop(ip, None)
            _save_attempts(d)


def _render_login(error=None):
    return render_template(
        'login.html',
        error=error,
        site_title=get_config_value('site_title', '資源站點管理器'),
        favicon_url=f"/favicon?v={get_config_value('favicon_version', '')}",
    )

def is_password_set():
    return 'password_hash' in load_config()

def set_password(password):
    config = load_config()
    config['password_hash'] = generate_password_hash(password)
    save_config(config)

def check_password(password):
    config = load_config()
    return check_password_hash(config.get('password_hash', ''), password)

# --- 會員(非管理員帳號)---
# 管理員 = config 裡的 password_hash(一開始設定的那組,唯一,可進設定 / 會員管理)。
# 會員 = members 清單,每個只有 {id, password_hash, note},只能用 app。
# 登入頁只輸入密碼:先比管理員、再比每個會員的 hash;登入後 session 記 role 與 account_id
# (account_id 綁定觀看歷史:管理員固定 'admin',會員用 'm<id>')。
_MEMBERS_KEY = 'members'


def get_members():
    raw = storage.get_text(_MEMBERS_KEY)
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except ValueError:
        return []


def save_members(members):
    storage.set_text(_MEMBERS_KEY, json.dumps(members, ensure_ascii=False))


def password_in_use(password):
    """密碼是否已被管理員或某個會員使用(新增會員時擋重複,避免登入身分撞號)。"""
    if check_password_hash(load_config().get('password_hash', ''), password):
        return True
    return any(check_password_hash(m.get('password_hash', ''), password) for m in get_members())


def authenticate(password):
    """只用密碼辨識身分。回傳 (role, account_id);失敗回 (None, None)。先比管理員再比會員。"""
    if not password:
        return None, None
    if check_password_hash(load_config().get('password_hash', ''), password):
        return 'admin', 'admin'
    for m in get_members():
        if check_password_hash(m.get('password_hash', ''), password):
            return 'member', f"m{m['id']}"
    return None, None


def is_admin():
    return session.get('role') == 'admin'


def member_nickname(m):
    """會員顯示名稱。沿用舊資料的 note 欄位(改名前存的)。"""
    return (m.get('nickname') or m.get('note') or '').strip()


def account_nickname(role, account_id):
    """目前登入帳號的顯示暱稱:管理員可自訂(config admin_nickname,預設『管理員』);會員回其暱稱(沒設就『會員』)。"""
    if role == 'admin':
        return (load_config().get('admin_nickname') or '管理員').strip() or '管理員'
    if account_id and account_id.startswith('m'):
        mid = account_id[1:]
        m = next((x for x in get_members() if str(x.get('id')) == mid), None)
        if m:
            return member_nickname(m) or '會員'
    return '會員'


def role_for_account_id(account_id):
    return 'admin' if account_id == 'admin' else 'member'


# --- 多帳號:同一個 session 同時記住多個「已解鎖」帳號,可自由切換(切換免再輸密碼) ---
# session['accounts'] = [{'account_id','role'}, ...](已解鎖清單)
# session['account_id'] / session['role'] = 目前使用中的那個 —— 其餘程式(歷史/收藏/守門)都讀這兩個,不必動。
def _account_exists(account_id):
    """帳號是否還存在(會員可能被管理員刪掉)。admin 只要密碼設過就算存在。"""
    if account_id == 'admin':
        return is_password_set()
    if account_id and account_id.startswith('m'):
        return any(str(m.get('id')) == account_id[1:] for m in get_members())
    return False


def set_active_account(account_id, role):
    session['account_id'] = account_id
    session['role'] = role


def add_logged_in_account(account_id, role):
    """把剛解鎖的帳號加進 session 清單並切為使用中(已在清單就只切換)。"""
    accts = [a for a in session.get('accounts', []) if a.get('account_id') != account_id]
    accts.append({'account_id': account_id, 'role': role})
    session['accounts'] = accts
    session['logged_in'] = True
    set_active_account(account_id, role)
    session.permanent = True


def ensure_accounts_list():
    """舊 session(改版前沒有 accounts 清單)補上:用目前 account_id/role 當第一個。"""
    if 'logged_in' in session and 'accounts' not in session:
        session['accounts'] = [{
            'account_id': session.get('account_id', 'admin'),
            'role': session.get('role', 'admin'),
        }]


# --- 同步裝置 token(kazi 等裝置用密碼換一次 token,之後只帶 token,不再傳密碼)---
# 存 storage:`sync_tokens` = { token: {account_id, label, created_at} }。
# 換密碼不影響既發 token(token 綁的是 account_id,不是密碼)→ 改密碼不會斷裝置同步。
_SYNC_TOKENS_KEY = 'sync_tokens'


def get_sync_tokens():
    raw = storage.get_text(_SYNC_TOKENS_KEY)
    if not raw:
        return {}
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else {}
    except ValueError:
        return {}


def save_sync_tokens(d):
    storage.set_text(_SYNC_TOKENS_KEY, json.dumps(d, ensure_ascii=False))


def _parse_tokens(raw):
    """把 storage 原始文字 parse 成 dict;空 / 壞 JSON / 非 dict → {}。"""
    if not raw:
        return {}
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else {}
    except ValueError:
        return {}


def mint_sync_token(account_id, label=''):
    """發一組新 token 綁定到 account_id,回傳 token 字串。
    讀-改-寫走 update_text 的鎖,避免跟並行的 mint/revoke 互相覆蓋(同一個 sync_tokens key)。"""
    token = secrets.token_urlsafe(32)

    def _add(raw):
        d = _parse_tokens(raw)
        d[token] = {'account_id': account_id, 'label': label, 'created_at': int(time.time() * 1000)}
        return json.dumps(d, ensure_ascii=False)

    storage.update_text(_SYNC_TOKENS_KEY, _add)
    return token


def account_for_token(token):
    """token → account_id;無效回 None。只讀不寫(省 KV)。"""
    if not token:
        return None
    rec = get_sync_tokens().get(token)
    return rec.get('account_id') if rec else None


def revoke_sync_token(token):
    if not token:
        return
    storage.update_text(_SYNC_TOKENS_KEY,
                        lambda raw: json.dumps({t: r for t, r in _parse_tokens(raw).items() if t != token},
                                               ensure_ascii=False))


def revoke_account_tokens(account_id):
    """撤銷某帳號的所有裝置 token(刪會員時順手清掉,避免孤兒 token)。"""
    storage.update_text(_SYNC_TOKENS_KEY,
                        lambda raw: json.dumps({t: r for t, r in _parse_tokens(raw).items()
                                                if r.get('account_id') != account_id},
                                               ensure_ascii=False))


def list_account_tokens(account_id):
    """某帳號目前綁定的裝置(給網頁顯示/撤銷)。回傳 [{token, label, created_at}]。"""
    return [
        {'token': t, 'label': r.get('label', ''), 'created_at': r.get('created_at', 0)}
        for t, r in get_sync_tokens().items() if r.get('account_id') == account_id
    ]


@auth_bp.route('/setup-password', methods=['GET', 'POST'])
def setup_password():
    if is_password_set():
        if 'logged_in' in session:
            return redirect(url_for('main.index'))
        return redirect(url_for('auth.login'))
    
    if request.method == 'POST':
        password = request.form['password']
        set_password(password)
        add_logged_in_account('admin', 'admin')
        return redirect(url_for('main.index'))
    site_title = get_config_value('site_title', '資源站點管理器')
    favicon_ext = get_config_value('favicon_ext', 'svg')
    favicon_version = get_config_value('favicon_version', '')
    favicon_url = f"/favicon?v={favicon_version}"
    return render_template('password_setup.html', site_title=site_title, favicon_url=favicon_url)

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if 'logged_in' in session:
        return redirect(url_for('main.index'))

    ip = _client_ip()

    # 鎖定中:不管帶不帶 cookie 都擋(以 IP 計)
    locked = _login_lock_remaining(ip)
    if locked > 0:
        minutes, seconds = divmod(locked, 60)
        return _render_login(f'嘗試次數過多，請在 {minutes} 分 {seconds} 秒後再試。')

    if request.method == 'POST':
        role, account_id = authenticate(request.form.get('password', ''))
        if role:
            _clear_login_failures(ip)
            add_logged_in_account(account_id, role)
            return redirect(url_for('main.index'))

        attempts_left, just_locked = _record_login_failure(ip)
        if just_locked:
            return _render_login(f'嘗試次數過多，帳戶已鎖定 {LOGIN_LOCKOUT_MINUTES} 分鐘。')
        return _render_login(f'密碼錯誤，還剩下 {attempts_left} 次嘗試機會。')

    return _render_login()

@auth_bp.route('/logout')
def logout():
    # 帶 account_id → 只登出那一個(其餘保留,若登出的是使用中就自動切到別的);不帶 → 全部登出
    target = request.args.get('account_id')
    accts = session.get('accounts', [])
    if target and any(a.get('account_id') == target for a in accts):
        accts = [a for a in accts if a.get('account_id') != target]
        session['accounts'] = accts
        if accts:
            if session.get('account_id') == target:
                set_active_account(accts[0]['account_id'], accts[0]['role'])
            return redirect(url_for('main.index'))
    # 全部登出
    session.pop('logged_in', None)
    session.pop('role', None)
    session.pop('account_id', None)
    session.pop('accounts', None)
    return redirect(url_for('auth.login'))


@auth_bp.route('/account/add', methods=['POST'])
def account_add():
    """用另一組密碼解鎖並加入 session(之後可自由切換)。沿用登入的 IP 防暴力破解。"""
    ip = _client_ip()
    locked = _login_lock_remaining(ip)
    if locked > 0:
        return jsonify({'status': 'error', 'message': f'嘗試次數過多，請 {locked} 秒後再試'}), 429
    data = request.get_json(silent=True) or {}
    password = data.get('password') or request.form.get('password', '')
    role, account_id = authenticate(password)
    if not role:
        attempts_left, just_locked = _record_login_failure(ip)
        msg = (f'嘗試次數過多，已鎖定 {LOGIN_LOCKOUT_MINUTES} 分鐘'
               if just_locked else f'密碼錯誤，還剩 {attempts_left} 次嘗試')
        return jsonify({'status': 'error', 'message': msg}), 401
    if any(a.get('account_id') == account_id for a in session.get('accounts', [])):
        set_active_account(account_id, role)  # 已登入過 → 直接切過去
        return jsonify({'status': 'success', 'account_id': account_id, 'already': True})
    _clear_login_failures(ip)
    add_logged_in_account(account_id, role)
    return jsonify({'status': 'success', 'account_id': account_id})


@auth_bp.route('/account/switch', methods=['POST'])
def account_switch():
    """切換到已解鎖的帳號(免再輸密碼)。"""
    data = request.get_json(silent=True) or {}
    target = data.get('account_id') or request.form.get('account_id', '')
    match = next((a for a in session.get('accounts', []) if a.get('account_id') == target), None)
    if not match or not _account_exists(target):
        return jsonify({'status': 'error', 'message': '此帳號未登入或已不存在'}), 400
    set_active_account(match['account_id'], match['role'])
    return jsonify({'status': 'success'})


@auth_bp.route('/account/list')
def account_list():
    """給前端切換選單:已解鎖帳號 + 暱稱 + 是否使用中(過濾掉已被刪的會員)。"""
    ensure_accounts_list()
    active = session.get('account_id')
    out = [
        {
            'account_id': a.get('account_id'),
            'role': a.get('role'),
            'nickname': account_nickname(a.get('role'), a.get('account_id')),
            'active': a.get('account_id') == active,
        }
        for a in session.get('accounts', []) if _account_exists(a.get('account_id'))
    ]
    return jsonify({'accounts': out, 'active': active})

def init_auth_check(app):
    # 設定session過期時間為30天
    app.config['PERMANENT_SESSION_LIFETIME'] = 30 * 24 * 60 * 60  # 30 days in seconds
    
    @app.before_request
    def require_login():
        # 靜態資源、favicon、manifest 一律放行（設定說明頁也要靠這些才能正常顯示）
        if request.endpoint == 'static' or request.path in ['/manifest.json', '/favicon']:
            return

        # 沒有可用儲存（serverless 唯讀又沒連 KV）→ 任何資料都存不住。
        # 直接擋在最前面給設定說明頁，不要放使用者進到會中途失敗的登入 / 設密碼流程。
        if not storage.is_writable():
            if request.path.startswith('/api/'):
                return jsonify({
                    'status': 'error',
                    'message': '此部署尚未設定資料儲存（KV），無法保存資料。請依說明連結 Upstash KV 後重新部署。',
                    'action': 'storage_required'
                }), 503
            return render_template('storage_required.html'), 503

        # Public endpoints that don't require any checks
        public_endpoints = ['auth.setup_password', 'static']

        if not is_password_set():
            if request.endpoint not in public_endpoints:
                if request.path.startswith('/api/'):
                    return jsonify({'status': 'error', 'message': '密碼尚未設定', 'action': 'setup_password'}), 401
                return redirect(url_for('auth.setup_password'))
            return

        # 裝置 token 換發/撤銷端點自帶憑證驗證(POST 比密碼、DELETE 認 token),不需 session
        if request.endpoint == 'api.sync_token':
            return
        # 帶有效裝置 token 的同步端點(kazi)放行,不需 session;token 無效則往下走一般登入檢查
        if request.endpoint in ('api.account_history', 'api.account_favorites', 'api.account_info'):
            if account_for_token(request.headers.get('X-Sync-Token', '')):
                return

        allowed_when_logged_out = ['auth.login', 'static']
        if 'logged_in' not in session and request.endpoint not in allowed_when_logged_out:
            if request.path.startswith('/api/'):
                return jsonify({'status': 'error', 'message': '需要登入', 'action': 'login'}), 401
            return redirect(url_for('auth.login'))

        # 舊 session(改版前只有單一密碼)補上身分欄位,視為管理員
        if 'logged_in' in session and 'role' not in session:
            session['role'] = 'admin'
            session['account_id'] = 'admin'
        # 舊 session 補上多帳號清單(用目前帳號當第一個),讓切換/登出一致運作
        ensure_accounts_list()

        # 已登入但非管理員 → 擋掉「設定 / 掃描匯入 / 會員管理」頁與站台 / 會員管理 API
        if 'logged_in' in session and session.get('role') != 'admin':
            ep = request.endpoint or ''
            admin_only = (
                ep in ('main.site_setup', 'main.scan_import')
                or ep.startswith('members.')
                or ep in ('api.manage_site', 'api.move_site', 'api.probe_batch',
                          'api.import_sites', 'api.export_sites',
                          'api.check_sites_now', 'api.check_single_site')
                or (ep == 'api.add_or_get_sites' and request.method == 'POST')
                or (ep == 'main.site_settings' and request.method == 'POST')
            )
            if admin_only:
                if request.path.startswith('/api/'):
                    return jsonify({'status': 'error', 'message': '需要管理員權限'}), 403
                return redirect(url_for('main.index'))
