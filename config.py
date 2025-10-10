import os
import json

DATA_DIR = 'data'
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')

def load_config():
    """載入設定檔"""
    if not os.path.exists(CONFIG_FILE):
        return {}
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}

def save_config(config):
    """儲存設定檔"""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=4, ensure_ascii=False)

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
