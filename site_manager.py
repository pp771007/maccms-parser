# site_manager.py

import ujson as json
import os
import threading
import time
import requests
import tempfile
import shutil
from datetime import datetime, timedelta, timezone
from logger_config import setup_logger
from config import get_timeout_config

DATA_DIR = 'data'
SITES_DB_FILE = os.path.join(DATA_DIR, 'sites.json')
logger = setup_logger()

# 文件鎖，防止併發寫入衝突
_file_lock = threading.Lock()

# 創建全局 Session 對象用於站點檢查
_check_session = None

def get_check_session():
    """獲取或創建用於站點檢查的 Session 對象"""
    global _check_session
    if _check_session is None:
        _check_session = requests.Session()
        # 針對小型伺服器優化 (512MB RAM + 0.5 CPU)
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=4,   # 適中的連接池
            pool_maxsize=8,       # 適中的最大連接數
            max_retries=0
        )
        _check_session.mount('http://', adapter)
        _check_session.mount('https://', adapter)
    return _check_session


def get_sites():
    if not os.path.exists(SITES_DB_FILE):
        return []
    try:
        with open(SITES_DB_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (ValueError, FileNotFoundError):
        return []

def save_sites(sites):
    """儲存站點資料 - 使用文件鎖和原子寫入防止數據損壞"""
    with _file_lock:  # 防止併發寫入
        os.makedirs(DATA_DIR, exist_ok=True)
        
        # 使用臨時文件 + 原子重命名，防止寫入過程中斷導致文件損壞
        temp_fd, temp_path = tempfile.mkstemp(dir=DATA_DIR, suffix='.tmp', text=True)
        try:
            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                json.dump(sites, f, ensure_ascii=False, indent=4)
                f.flush()  # 確保寫入磁碟
                os.fsync(f.fileno())  # 強制同步到磁碟
            
            # 原子重命名（在大多數系統上是原子操作）
            shutil.move(temp_path, SITES_DB_FILE)
            logger.info(f"成功保存 {len(sites)} 個站點資料")
        except Exception as e:
            # 如果失敗，清理臨時文件
            if os.path.exists(temp_path):
                os.remove(temp_path)
            logger.error(f"保存站點資料失敗: {e}")
            raise e

def check_site_health(site):
    """檢查單一站點的健康狀態"""
    try:
        if not site.get('enabled', True):
            return True  # 已停用的站點不需要檢查
        
        url = site['url']
        if not url.startswith('http'):
            url = 'http://' + url
        
        clean_url = url.rstrip('/')
        api_url = f"{clean_url}/api.php/provide/vod/"
        
        headers = {'User-Agent': 'Mozilla/5.0'}
        ssl_verify = site.get('ssl_verify', True)

        # 使用統一的超時設定和 Session
        timeout_seconds = get_timeout_config()
        session = get_check_session()
        response = session.get(api_url, headers=headers, timeout=timeout_seconds, verify=ssl_verify)
        response.raise_for_status()
        
        # 檢查API回應格式
        data = response.json()
        if data.get('code') == 1:
            logger.info(f"站點檢查成功: {site['name']} ({url})")
            return True
        else:
            logger.warning(f"站點API回應異常: {site['name']} ({url}) - {data.get('msg', '未知錯誤')}")
            return False
            
    except requests.exceptions.Timeout:
        logger.error(f"站點檢查超時: {site['name']} ({url})")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"站點檢查失敗: {site['name']} ({url})", exc_info=True)
        return False
    except Exception as e:
        logger.error(f"站點檢查發生未知錯誤: {site['name']} ({url})", exc_info=True)
        return False


def check_sites_immediately(include_disabled=False):
    """立即檢查所有站點並返回結果"""
    sites = get_sites()
    if include_disabled:
        sites_to_check = sites  # 檢查所有站點
        logger.info(f"開始立即檢查所有站點（包含未啟用）: {len(sites_to_check)} 個")
    else:
        sites_to_check = [s for s in sites if s.get('enabled', True)]  # 只檢查啟用站點
        logger.info(f"開始立即檢查啟用站點: {len(sites_to_check)} 個")
    
    results = []
    
    for site in sites_to_check:
        try:
            is_healthy = check_site_health(site)
            
            site['last_check'] = datetime.now(timezone.utc).isoformat()
            if not is_healthy:
                site.setdefault('consecutive_errors', 0)
                site['consecutive_errors'] += 1
                site['check_status'] = 'failed'
                logger.warning(f"站點 {site['name']} 檢查失敗，連續錯誤 {site['consecutive_errors']} 次")
                results.append({
                    'name': site['name'],
                    'url': site['url'],
                    'status': 'failed',
                    'message': f"檢查失敗，連續錯誤 {site['consecutive_errors']} 次"
                })
            else:
                site['consecutive_errors'] = 0
                site['check_status'] = 'success'
                results.append({
                    'name': site['name'],
                    'url': site['url'],
                    'status': 'success',
                    'message': '檢查成功'
                })
                
        except Exception as e:
            logger.error(f"檢查站點 {site['name']} 時發生錯誤: {e}")
            results.append({
                'name': site['name'],
                'url': site['url'],
                'status': 'error',
                'message': f'檢查錯誤: {str(e)}'
            })
    
    # 儲存更新後的站點資料
    save_sites(sites)
    logger.info("立即檢查完成")
    
    return results

def check_single_site_health(site_id):
    """檢查單一站點的健康狀態"""
    sites = get_sites()
    site = next((s for s in sites if s['id'] == site_id), None)
    
    if not site:
        raise ValueError(f"找不到ID為 {site_id} 的站點")
    
    try:
        is_healthy = check_site_health(site)
        
        site['last_check'] = datetime.now(timezone.utc).isoformat()
        if not is_healthy:
            site.setdefault('consecutive_errors', 0)
            site['consecutive_errors'] += 1
            site['check_status'] = 'failed'
            logger.warning(f"站點 {site['name']} 檢查失敗，連續錯誤 {site['consecutive_errors']} 次")
            result = {
                'name': site['name'],
                'url': site['url'],
                'status': 'failed',
                'message': f"檢查失敗，連續錯誤 {site['consecutive_errors']} 次"
            }
        else:
            site['consecutive_errors'] = 0
            site['check_status'] = 'success'
            result = {
                'name': site['name'],
                'url': site['url'],
                'status': 'success',
                'message': '檢查成功'
            }
            
        # 儲存更新後的站點資料
        save_sites(sites)
        logger.info(f"站點 {site['name']} 檢查完成: {result['status']}")
        
        return result
        
    except Exception as e:
        logger.error(f"檢查站點 {site['name']} 時發生錯誤: {e}")
        return {
            'name': site['name'],
            'url': site['url'],
            'status': 'error',
            'message': f'檢查錯誤: {str(e)}'
        }
