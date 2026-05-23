import os
import time
import json
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

@auth_bp.route('/setup-password', methods=['GET', 'POST'])
def setup_password():
    if is_password_set():
        if 'logged_in' in session:
            return redirect(url_for('main.index'))
        return redirect(url_for('auth.login'))
    
    if request.method == 'POST':
        password = request.form['password']
        set_password(password)
        session['logged_in'] = True
        session.permanent = True  # 設定session為永久性
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
        if check_password(request.form.get('password', '')):
            _clear_login_failures(ip)
            session['logged_in'] = True
            session.permanent = True
            return redirect(url_for('main.index'))

        attempts_left, just_locked = _record_login_failure(ip)
        if just_locked:
            return _render_login(f'嘗試次數過多，帳戶已鎖定 {LOGIN_LOCKOUT_MINUTES} 分鐘。')
        return _render_login(f'密碼錯誤，還剩下 {attempts_left} 次嘗試機會。')

    return _render_login()

@auth_bp.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('auth.login'))

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

        allowed_when_logged_out = ['auth.login', 'static']
        if 'logged_in' not in session and request.endpoint not in allowed_when_logged_out:
            if request.path.startswith('/api/'):
                return jsonify({'status': 'error', 'message': '需要登入', 'action': 'login'}), 401
            return redirect(url_for('auth.login'))
