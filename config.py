import time
import ujson as json
import storage

# 儲存層的 key（檔案後端時即為 data/ 下的檔名，與舊版相容）
CONFIG_KEY = 'config.json'

# 設定檔每個請求都會被讀(before_request 驗密碼、各處取 site_title/favicon 等),
# 而 Vercel 的 KV / 流量有限。加「記憶體短快取」:同一實例 TTL 內重複讀走記憶體、不打 KV。
# 快取的是原始 JSON 文字,load_config 每次 json.loads 出新 dict → 呼叫端可安全 mutate。
# 寫入(save_config)時即時更新本機快取;serverless 其他實例最多 TTL 秒同步,對本用途足夠。
_CACHE_TTL = 30  # 秒
_cache_raw = None
_cache_at = 0.0


def _read_raw():
    global _cache_raw, _cache_at
    now = time.time()
    if _cache_raw is None or (now - _cache_at) >= _CACHE_TTL:
        _cache_raw = storage.get_text(CONFIG_KEY) or ''
        _cache_at = now
    return _cache_raw


def load_config():
    """載入設定檔(走短快取,少打 KV)"""
    raw = _read_raw()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        return {}

def save_config(config):
    """儲存設定檔(同時更新本機快取)"""
    global _cache_raw, _cache_at
    raw = json.dumps(config, indent=4, ensure_ascii=False)
    storage.set_text(CONFIG_KEY, raw)
    _cache_raw = raw
    _cache_at = time.time()

def get_config_value(key, default=None):
    """取得特定鍵值的設定"""
    return load_config().get(key, default)

def set_config_value(key, value):
    """設定特定鍵值"""
    config = load_config()
    config[key] = value
    save_config(config)

def get_timeout_config():
    """取得超時設定，預設為5秒"""
    return get_config_value('request_timeout', 5)

def set_timeout_config(timeout_seconds):
    """設定超時時間"""
    set_config_value('request_timeout', timeout_seconds)
