# storage.py
#
# 統一的儲存層，依環境自動選擇後端：
#   - 偵測到 Upstash / Vercel KV 的環境變數 -> 走 Redis REST API（serverless 用）
#   - 否則 -> 走本機 data/ 目錄的檔案（Docker / 本機，行為與原本一致）
#
# 上層只透過 get_text / set_text / get_blob / set_blob / delete / exists 操作，
# 不需要知道目前用的是哪種後端。

import os
import base64
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

# 檔案後端用：防止併發寫入衝突（原本散在 config.py / site_manager.py 的鎖集中到這）
_file_lock = threading.Lock()


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


def set_text(key, value):
    """寫文字（UTF-8）。"""
    if USE_KV:
        _kv_command('SET', _KV_PREFIX + key, value)
        return
    with _file_lock:
        _atomic_write(os.path.join(DATA_DIR, key), value.encode('utf-8'))


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
    with _file_lock:
        _atomic_write(os.path.join(DATA_DIR, key), data)


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
