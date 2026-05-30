# storage.py
#
# 統一的儲存層，依環境自動選擇後端：
#   - 偵測到 Upstash / Vercel KV 的環境變數 -> 走 Redis REST API（serverless 用）
#   - 否則 -> 走本機 data/ 目錄的檔案（Docker / 本機，行為與原本一致）
#
# 上層只透過 get_text / set_text / get_blob / set_blob / delete / exists 操作，
# 不需要知道目前用的是哪種後端。

import os
import time
import base64
import secrets
import threading
import tempfile
import shutil
import requests

DATA_DIR = 'data'

# Vercel KV（Upstash 提供）會注入 UPSTASH_* 或 KV_REST_API_* 兩種命名，兩種都接
_KV_URL = os.environ.get('UPSTASH_REDIS_REST_URL') or os.environ.get('KV_REST_API_URL')
_KV_TOKEN = os.environ.get('UPSTASH_REDIS_REST_TOKEN') or os.environ.get('KV_REST_API_TOKEN')
USE_KV = bool(_KV_URL and _KV_TOKEN)

# Redis 內的 key 統一加前綴，避免和同一個 Redis 上其他資料撞名
_KV_PREFIX = 'maccms:'
_KV_TIMEOUT = 10

# 檔案後端用：防止併發寫入衝突（原本散在 config.py / site_manager.py 的鎖集中到這）。
# 用 RLock：update_text 會在持鎖時再呼叫 set_text→_write_file（也拿這把鎖），可重入才不會自我死鎖。
_file_lock = threading.RLock()

# update_text 的 KV 分散式鎖參數：critical section 只是一次 GET+SET，5 秒 TTL 綽綽有餘；
# 搶不到就每 50ms 重試,最多等 5 秒。TTL 是防呆（持鎖端崩了讓鎖自動過期,不會永久卡住）。
_KV_LOCK_TTL_MS = 5000
_KV_LOCK_WAIT_S = 5.0
_KV_LOCK_RETRY_S = 0.05


_writable_cache = None

def is_writable():
    """這個部署能不能持久化資料？連了 KV 就算可用；否則實際探測 data/ 能不能寫。

    用來在 serverless 唯讀環境（如未連 KV 的 Vercel）擋下使用者，給設定說明頁，
    避免他進到登入 / 設密碼流程後才在寫入時失敗。結果快取，不必每個請求都探測。
    """
    global _writable_cache
    if _writable_cache is not None:
        return _writable_cache
    if USE_KV:
        _writable_cache = True
        return _writable_cache
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        probe = os.path.join(DATA_DIR, '.write_probe')
        with open(probe, 'w', encoding='utf-8') as f:
            f.write('ok')
        os.remove(probe)
        _writable_cache = True
    except OSError:
        _writable_cache = False
    return _writable_cache


def _kv_command(*args):
    """對 Upstash REST API 送一個 Redis 指令（命令陣列形式）。"""
    resp = requests.post(
        _KV_URL,
        json=list(args),
        headers={'Authorization': f'Bearer {_KV_TOKEN}'},
        timeout=_KV_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json().get('result')


def _atomic_write(path, data):
    """原子寫入：先寫暫存檔再 rename，避免寫到一半中斷導致檔案損壞。"""
    directory = os.path.dirname(path) or '.'
    os.makedirs(directory, exist_ok=True)
    temp_fd, temp_path = tempfile.mkstemp(dir=directory, suffix='.tmp')
    try:
        with os.fdopen(temp_fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        shutil.move(temp_path, path)
    except Exception:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise


def get_text(key):
    """讀文字（UTF-8）。不存在回傳 None。"""
    if USE_KV:
        return _kv_command('GET', _KV_PREFIX + key)
    path = os.path.join(DATA_DIR, key)
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def _write_file(key, data):
    """檔案後端的寫入；唯讀環境（未連 KV 的 serverless）會給出明確訊息而非裸 OSError。"""
    with _file_lock:
        try:
            _atomic_write(os.path.join(DATA_DIR, key), data)
        except OSError as e:
            raise RuntimeError(
                "資料寫入失敗：偵測到唯讀檔案系統且未設定 KV。"
                "若部署在 Vercel 等 serverless 平台，請依 README 連結 Upstash KV 後重新部署。"
                f"（原始錯誤：{e}）"
            ) from e


def set_text(key, value):
    """寫文字（UTF-8）。"""
    if USE_KV:
        _kv_command('SET', _KV_PREFIX + key, value)
        return
    _write_file(key, value.encode('utf-8'))


def _kv_acquire_lock(lock_key, token):
    """搶 KV 分散式鎖（SET NX PX）。搶到回 True;等超過 _KV_LOCK_WAIT_S 仍搶不到回 False。"""
    deadline = time.time() + _KV_LOCK_WAIT_S
    while True:
        res = _kv_command('SET', lock_key, token, 'NX', 'PX', _KV_LOCK_TTL_MS)
        if res == 'OK':
            return True
        if time.time() >= deadline:
            return False
        time.sleep(_KV_LOCK_RETRY_S)


def _kv_release_lock(lock_key, token):
    """放鎖:compare-and-delete(只刪自己這把)。避免 TTL 過期後被別人接手、又被我們誤刪。"""
    script = ("if redis.call('get', KEYS[1]) == ARGV[1] "
              "then return redis.call('del', KEYS[1]) else return 0 end")
    try:
        _kv_command('EVAL', script, 1, lock_key, token)
    except Exception:
        pass  # 放鎖失敗不致命:TTL 到了鎖會自己消失


def update_text(key, fn):
    """原子的「讀→改→寫」:fn(目前文字 or None) 回傳新文字,整段序列化避免併發 lost update。

    這是同步資料(history / favorites / sync_tokens)的關鍵:client 端整包 POST,伺服器要先
    讀現有再 merge 寫回。若讀-改-寫沒包在同一把鎖內,兩個請求交錯時後寫的會蓋掉先寫的 merge 結果。
      - 檔案後端:整段持 _file_lock(RLock)。
      - KV 後端:用 SET NX 分散式鎖序列化跨 serverless invocation 的併發。搶不到鎖就退化成
        無鎖讀改寫(等同舊行為,不比現在差),記一筆 warning。
    回傳寫入後的新文字。"""
    if USE_KV:
        lock_key = _KV_PREFIX + 'lock:' + key
        token = secrets.token_urlsafe(16)
        locked = _kv_acquire_lock(lock_key, token)
        try:
            new_val = fn(get_text(key))
            set_text(key, new_val)
            return new_val
        finally:
            if locked:
                _kv_release_lock(lock_key, token)
    with _file_lock:
        new_val = fn(get_text(key))
        set_text(key, new_val)
        return new_val


def get_blob(key):
    """讀二進位資料（KV 後端以 base64 存放）。不存在回傳 None。"""
    if USE_KV:
        encoded = _kv_command('GET', _KV_PREFIX + key)
        return base64.b64decode(encoded) if encoded else None
    path = os.path.join(DATA_DIR, key)
    if not os.path.exists(path):
        return None
    with open(path, 'rb') as f:
        return f.read()


def set_blob(key, data):
    """寫二進位資料。"""
    if USE_KV:
        _kv_command('SET', _KV_PREFIX + key, base64.b64encode(data).decode('ascii'))
        return
    _write_file(key, data)


def delete(key):
    """刪除一個 key（不存在也不報錯）。"""
    if USE_KV:
        _kv_command('DEL', _KV_PREFIX + key)
        return
    path = os.path.join(DATA_DIR, key)
    if os.path.exists(path):
        os.remove(path)


def exists(key):
    if USE_KV:
        return bool(_kv_command('EXISTS', _KV_PREFIX + key))
    return os.path.exists(os.path.join(DATA_DIR, key))
