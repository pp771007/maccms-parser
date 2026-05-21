import ujson as json
import storage

# 儲存層的 key（檔案後端時即為 data/ 下的檔名，與舊版相容）
CONFIG_KEY = 'config.json'

def load_config():
    """載入設定檔"""
    raw = storage.get_text(CONFIG_KEY)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        return {}

def save_config(config):
    """儲存設定檔"""
    storage.set_text(CONFIG_KEY, json.dumps(config, indent=4, ensure_ascii=False))

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
