import time
import json
import concurrent.futures
from flask import Blueprint, request, jsonify, session
from urllib.parse import urlparse, urlunparse

from logger_config import setup_logger
from site_manager import get_sites, save_sites
from api_parser import process_api_request, get_details_from_api
import storage

MAX_HISTORY_ITEMS = 50  # 跟前端一致,單一帳號最多保留 50 筆觀看歷史
MAX_FAVORITE_ITEMS = 500  # 收藏(目前僅 kazi 用;網頁無收藏 UI,只當同步資料存)

api_bp = Blueprint('api', __name__, url_prefix='/api')
logger = setup_logger()

@api_bp.route('/health', methods=['GET'])
def health_check():
    """健康檢查端點 - 檢查應用程式和依賴服務狀態"""
    try:
        # 檢查是否能讀取站點配置（同時驗證儲存後端可用）
        try:
            sites = get_sites()
        except Exception as e:
            return jsonify({
                'status': 'unhealthy',
                'reason': f'cannot read sites config: {str(e)}',
                'timestamp': int(time.time())
            }), 503

        return jsonify({
            'status': 'healthy',
            'sites_count': len(sites),
            'timestamp': int(time.time())
        })
    except Exception as e:
        logger.error(f"健康檢查失敗: {e}")
        return jsonify({
            'status': 'unhealthy',
            'reason': str(e),
            'timestamp': int(time.time())
        }), 503

def clean_base_url(raw_url):
    try:
        parsed = urlparse(raw_url)
        return urlunparse((parsed.scheme, parsed.netloc, '', '', '', ''))
    except Exception:
        return raw_url

# 自動命名時用來判斷哪些是 TLD（取倒數第二段當站名）
COMMON_TLDS = ['com', 'net', 'org', 'xyz', 'top', 'cn', 'cc']

def derive_site_name(cleaned_url):
    """從網址自動推導站點名稱（未大寫，由呼叫端決定是否 capitalize）"""
    try:
        domain = urlparse(cleaned_url).netloc
        if domain.startswith('www.'):
            domain = domain[4:]
        elif domain.startswith('api.'):
            domain = domain[4:]

        parts = domain.split('.')
        if len(parts) > 1 and parts[-1] in COMMON_TLDS:
            return parts[-2]
        return parts[0] if parts and parts[0] else '未命名站點'
    except Exception as e:
        logger.error(f"自動命名失敗: {e}")
        return '未命名站點'

@api_bp.route('/sites', methods=['GET', 'POST'])
def add_or_get_sites():
    sites = get_sites()
    if request.method == 'GET':
        context = request.args.get('context')
        
        if context == 'setup':
            logger.info("GET /api/sites?context=setup - 請求所有站點列表（用於設定頁面）")
            sorted_sites = sorted(sites, key=lambda s: s.get('order', float('inf')))
            return jsonify(sorted_sites)
        
        logger.info("GET /api/sites - 請求已啟用且排序的站點列表")
        enabled_sites = [s for s in sites if s.get('enabled', True)]
        sorted_sites = sorted(enabled_sites, key=lambda s: s.get('order', float('inf')))
        return jsonify(sorted_sites)
    
    if request.method == 'POST':
        new_site_data = request.json
        raw_url = new_site_data.get('url')
        name = new_site_data.get('name')

        if not raw_url:
            return jsonify({'status': 'error', 'message': 'URL不能為空'}), 400
        
        try:
            parsed_raw = urlparse(raw_url)
            if not all([parsed_raw.scheme, parsed_raw.netloc]):
                raise ValueError("無效的URL格式，請確保包含 http:// 或 https://")

            # 檢查是否新增自己的伺服器作為外部站點，防止無限遞歸
            if parsed_raw.scheme == request.scheme and parsed_raw.netloc == request.host:
                return jsonify({'status': 'error', 'message': '不能新增自己的伺服器作為外部站點'}), 400

            cleaned_url = clean_base_url(raw_url)
            
        except ValueError as e:
            logger.warning(f"POST /api/sites - 400 Bad Request (無效URL: {raw_url}), 錯誤: {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 400
        
        # 檢查站台URL是否已存在
        if any(s.get('url') == cleaned_url for s in sites):
            logger.warning(f"POST /api/sites - 400 Bad Request (站台URL已存在: {cleaned_url})")
            return jsonify({'status': 'error', 'message': '此站點URL已存在，無法重複新增'}), 400
        
        if not name:
            name = derive_site_name(cleaned_url)
        
        new_site = {
            'id': int(time.time() * 1000),
            'name': name.capitalize(),
            'url': cleaned_url,
            'enabled': True,
            'ssl_verify': True,
            'note': '',
            'order': len(sites)
        }
        
        sites.append(new_site)
        save_sites(sites)
        logger.info(f"POST /api/sites - 201 Created (新增站點: {new_site['name']}, URL: {new_site['url']})")
        return jsonify({'status': 'success', 'site': new_site}), 201

@api_bp.route('/sites/<int:site_id>', methods=['PUT', 'DELETE'])
def manage_site(site_id):
    sites = get_sites()
    site_index, site_to_manage = next(((i, s) for i, s in enumerate(sites) if s['id'] == site_id), (None, None))

    if not site_to_manage:
        return jsonify({'status': 'error', 'message': '未找到該站點'}), 404

    if request.method == 'PUT':
        data = request.json
        site_to_manage['name'] = data.get('name', site_to_manage.get('name'))
        site_to_manage['url'] = data.get('url', site_to_manage.get('url'))
        site_to_manage['enabled'] = data.get('enabled', site_to_manage.get('enabled', True))
        site_to_manage['ssl_verify'] = data.get('ssl_verify', site_to_manage.get('ssl_verify', True))
        site_to_manage['note'] = data.get('note', site_to_manage.get('note', ''))
        sites[site_index] = site_to_manage
        save_sites(sites)
        return jsonify({'status': 'success', 'site': site_to_manage})

    if request.method == 'DELETE':
        sites.pop(site_index)
        save_sites(sites)
        return jsonify({'status': 'success', 'message': '站點已刪除'})

@api_bp.route('/sites/<int:site_id>/move', methods=['POST'])
def move_site(site_id):
    sites = get_sites()
    direction = request.json.get('direction')
    
    try:
        idx = next(i for i, s in enumerate(sites) if s['id'] == site_id)
    except StopIteration:
        return jsonify({'status': 'error', 'message': '未找到該站點'}), 404

    if direction == 'up' and idx > 0:
        sites.insert(idx - 1, sites.pop(idx))
    elif direction == 'down' and idx < len(sites) - 1:
        sites.insert(idx + 1, sites.pop(idx))
    else:
        return jsonify({'status': 'error', 'message': '無法移動'}), 400
        
    for i, site in enumerate(sites):
        site['order'] = i
        
    save_sites(sites)
    return jsonify({'status': 'success', 'sites': sites})

@api_bp.route('/sites/export', methods=['GET'])
def export_sites():
    """匯出站台清單，格式跟 kazi 一致(純陣列、name/url/ssl_verify/enabled),兩邊可互通匯入。"""
    sites = sorted(get_sites(), key=lambda s: s.get('order', float('inf')))
    export = [{
        'name': s.get('name', ''),
        'url': s.get('url', ''),
        'ssl_verify': bool(s.get('ssl_verify', True)),
        'enabled': bool(s.get('enabled', True)),
    } for s in sites]
    return jsonify(export)

@api_bp.route('/sites/import', methods=['POST'])
def import_sites():
    """匯入站台清單。接受 kazi 的純陣列格式,也容忍 {"sites": [...]} 包裝與本站完整 schema。
    依清理後的 URL 去重,跳過本站與已存在者,套用 name/url/ssl_verify/enabled。"""
    payload = request.get_json(silent=True)
    if isinstance(payload, dict):
        items = payload.get('sites') or payload.get('data') or []
    else:
        items = payload
    if not isinstance(items, list):
        return jsonify({'status': 'error', 'message': '格式錯誤:預期一個 JSON 陣列'}), 400

    sites = get_sites()
    existing = {s.get('url', '').lower() for s in sites}
    added = skipped = 0
    order = len(sites)
    next_id = int(time.time() * 1000)

    for it in items:
        if not isinstance(it, dict):
            skipped += 1
            continue
        raw_url = (it.get('url') or '').strip()
        parsed = urlparse(raw_url)
        if not all([parsed.scheme, parsed.netloc]):
            skipped += 1
            continue
        if parsed.scheme == request.scheme and parsed.netloc == request.host:
            skipped += 1
            continue
        cleaned = clean_base_url(raw_url)
        if cleaned.lower() in existing:
            skipped += 1
            continue
        name = (it.get('name') or '').strip() or derive_site_name(cleaned).capitalize()
        sites.append({
            'id': next_id,
            'name': name,
            'url': cleaned,
            'enabled': bool(it.get('enabled', True)),
            'ssl_verify': bool(it.get('ssl_verify', True)),
            'note': (it.get('note') or ''),
            'order': order,
        })
        existing.add(cleaned.lower())
        added += 1
        order += 1
        next_id += 1

    if added:
        save_sites(sites)
    logger.info(f"POST /api/sites/import - 匯入 {added} 個,略過 {skipped} 個")
    return jsonify({'status': 'success', 'added': added, 'skipped': skipped, 'total': len(sites)})

@api_bp.route('/sites/probe_batch', methods=['POST'])
def probe_batch():
    """批次驗證一組候選網址，回傳每個的健康狀態與建議站名（不寫入，只驗證）"""
    from site_manager import check_site_health

    data = request.json or {}
    # 新格式 items: [{url, name}]（書籤會連網頁上的連結文字一起帶回來當站名）；
    # 舊格式 urls: [str] 仍相容。
    raw_items = data.get('items')
    if raw_items is None:
        raw_items = [{'url': u} for u in data.get('urls', []) if isinstance(u, str)]
    if not isinstance(raw_items, list):
        return jsonify({'status': 'error', 'message': 'items / urls 必須是陣列'}), 400

    sites = get_sites()
    existing_urls = {s.get('url', '').lower() for s in sites}

    seen = set()
    candidates = []
    for raw in raw_items:
        if isinstance(raw, str):
            raw = {'url': raw}
        if not isinstance(raw, dict):
            continue
        url = (raw.get('url') or '').strip()
        if not url:
            continue
        cleaned = clean_base_url(url)
        parsed = urlparse(cleaned)
        if not all([parsed.scheme, parsed.netloc]):
            continue
        low = cleaned.lower()
        if low in seen:
            continue
        seen.add(low)
        # 優先用書籤抓到的連結文字當站名,沒有才從網址推導
        provided = (raw.get('name') or '').strip()
        name = provided if provided else derive_site_name(cleaned).capitalize()
        candidates.append({
            'url': cleaned,
            'name': name,
            'exists': low in existing_urls,
            'is_self': parsed.scheme == request.scheme and parsed.netloc == request.host,
        })

    def probe(c):
        if c['is_self']:
            return {**c, 'healthy': False, 'message': '這是本站，略過'}
        if c['exists']:
            return {**c, 'healthy': False, 'message': '已在站點清單中'}
        site = {'name': c['name'], 'url': c['url'], 'enabled': True, 'ssl_verify': True}
        try:
            healthy = check_site_health(site)
        except Exception as e:
            return {**c, 'healthy': False, 'message': f'檢查失敗: {e}'}
        return {**c, 'healthy': healthy, 'message': '可用' if healthy else '無回應或非 MacCMS 介面'}

    results = []
    if candidates:
        max_workers = min(len(candidates), 6)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(probe, c) for c in candidates]
            for future in concurrent.futures.as_completed(futures):
                results.append(future.result())

    # 可用的排前面，方便直接勾選
    results.sort(key=lambda r: (not r['healthy'], r['url']))
    logger.info(f"POST /api/sites/probe_batch - 候選 {len(candidates)} 個，可用 {sum(1 for r in results if r['healthy'])} 個")
    return jsonify({'status': 'success', 'results': results, 'total': len(results)})

def _sync_account_id():
    """解析這次請求的帳號:優先用 X-Sync-Token(kazi 裝置 token),否則用 session(網頁登入)。"""
    from blueprints.auth import account_for_token
    tok = request.headers.get('X-Sync-Token', '')
    if tok:
        aid = account_for_token(tok)
        if aid:
            return aid
    return session.get('account_id')


@api_bp.route('/sync/token', methods=['POST', 'DELETE'])
def sync_token():
    """裝置 token:POST 用密碼換 token(套用與 /login 相同的 IP 防暴力破解);DELETE 撤銷帶來的 token。"""
    from blueprints.auth import (
        authenticate, account_nickname, mint_sync_token, revoke_sync_token,
        _client_ip, _login_lock_remaining, _record_login_failure, _clear_login_failures,
    )
    if request.method == 'DELETE':
        revoke_sync_token(request.headers.get('X-Sync-Token', ''))
        return jsonify({'status': 'success'})

    ip = _client_ip()
    locked = _login_lock_remaining(ip)
    if locked > 0:
        return jsonify({'status': 'error', 'message': f'嘗試次數過多,請 {locked} 秒後再試'}), 429

    data = request.get_json(silent=True) or {}
    password = data.get('password', '')
    label = (data.get('label') or '').strip()[:50]
    role, account_id = authenticate(password)
    if not role:
        _record_login_failure(ip)
        return jsonify({'status': 'error', 'message': '密碼錯誤'}), 401
    _clear_login_failures(ip)
    token = mint_sync_token(account_id, label)
    return jsonify({'token': token, 'accountId': account_id, 'nickname': account_nickname(role, account_id)})


@api_bp.route('/account', methods=['GET'])
def account_info():
    """目前登入帳號的身分:給網頁顯示『目前登入』、給 kazi 同步顯示『已綁定』,兩邊一比即知是否同一帳號。"""
    from blueprints.auth import account_nickname, role_for_account_id
    account_id = _sync_account_id()
    if not account_id:
        return jsonify({'status': 'error', 'message': '未登入'}), 401
    role = session.get('role') or role_for_account_id(account_id)
    return jsonify({'role': role, 'accountId': account_id, 'nickname': account_nickname(role, account_id)})


@api_bp.route('/account', methods=['PATCH'])
def update_account():
    """個人中心:改『自己』的暱稱 / 密碼(管理員或會員皆可)。改密碼需帶目前密碼確認;
    不影響已發的裝置 token(kazi 不會斷)。管理員改別人走 /api/members/<id>。"""
    from blueprints.auth import set_password, check_password, get_members, save_members
    from config import load_config, save_config
    from werkzeug.security import generate_password_hash, check_password_hash
    role = session.get('role')
    account_id = session.get('account_id')
    if not account_id:
        return jsonify({'status': 'error', 'message': '未登入'}), 401
    data = request.get_json(silent=True) or {}
    nickname = data.get('nickname')
    new_pw = (data.get('newPassword') or '').strip()
    cur_pw = data.get('currentPassword', '')

    if role == 'admin':
        if nickname is not None:
            cfg = load_config()
            cfg['admin_nickname'] = nickname.strip()
            save_config(cfg)
        if new_pw:
            if len(new_pw) < 4:
                return jsonify({'status': 'error', 'message': '密碼至少 4 個字元'}), 400
            if not check_password(cur_pw):
                return jsonify({'status': 'error', 'message': '目前密碼錯誤'}), 400
            if any(check_password_hash(o.get('password_hash', ''), new_pw) for o in get_members()):
                return jsonify({'status': 'error', 'message': '這個密碼已被某個會員使用,請換一個'}), 400
            set_password(new_pw)
        return jsonify({'status': 'success'})

    # 會員:只改自己那筆
    members = get_members()
    mid = account_id[1:] if account_id.startswith('m') else ''
    m = next((x for x in members if str(x.get('id')) == mid), None)
    if not m:
        return jsonify({'status': 'error', 'message': '找不到帳號'}), 404
    if nickname is not None:
        m['nickname'] = nickname.strip()
        m.pop('note', None)
    if new_pw:
        if len(new_pw) < 4:
            return jsonify({'status': 'error', 'message': '密碼至少 4 個字元'}), 400
        if not check_password_hash(m.get('password_hash', ''), cur_pw):
            return jsonify({'status': 'error', 'message': '目前密碼錯誤'}), 400
        if check_password_hash(load_config().get('password_hash', ''), new_pw) or \
           any(check_password_hash(o.get('password_hash', ''), new_pw) for o in members if o['id'] != m['id']):
            return jsonify({'status': 'error', 'message': '這個密碼已被其他帳號使用,請換一個'}), 400
        m['password_hash'] = generate_password_hash(new_pw)
    save_members(members)
    return jsonify({'status': 'success'})


@api_bp.route('/history', methods=['GET', 'POST'])
def account_history():
    """觀看歷史綁帳號、存伺服器端(storage:Docker 檔案 / Vercel KV)→ 跨裝置同步。
    寫入由前端嚴格節流(只在關閉播放器 / 換集 / 清除 / 關分頁 / 每 60 秒有變動時),避免狂打。"""
    account_id = _sync_account_id()
    if not account_id:
        return jsonify([]) if request.method == 'GET' else (jsonify({'status': 'error', 'message': '未登入'}), 401)

    key = f'history_{account_id}'

    if request.method == 'GET':
        raw = storage.get_text(key)
        if not raw:
            return jsonify([])
        try:
            data = json.loads(raw)
            return jsonify(data if isinstance(data, list) else [])
        except ValueError:
            return jsonify([])

    # POST:整包覆寫(前端維護順序與上限)
    data = request.get_json(silent=True)
    if not isinstance(data, list):
        return jsonify({'status': 'error', 'message': '格式錯誤:預期陣列'}), 400
    storage.set_text(key, json.dumps(data[:MAX_HISTORY_ITEMS], ensure_ascii=False))
    return jsonify({'status': 'success'})


@api_bp.route('/favorites', methods=['GET', 'POST'])
def account_favorites():
    """收藏清單,綁帳號、存伺服器端(共通格式)。網頁+kazi 共用。"""
    account_id = _sync_account_id()
    if not account_id:
        return jsonify([]) if request.method == 'GET' else (jsonify({'status': 'error', 'message': '未登入'}), 401)

    key = f'favorites_{account_id}'

    if request.method == 'GET':
        raw = storage.get_text(key)
        if not raw:
            return jsonify([])
        try:
            data = json.loads(raw)
            return jsonify(data if isinstance(data, list) else [])
        except ValueError:
            return jsonify([])

    data = request.get_json(silent=True)
    if not isinstance(data, list):
        return jsonify({'status': 'error', 'message': '格式錯誤:預期陣列'}), 400
    storage.set_text(key, json.dumps(data[:MAX_FAVORITE_ITEMS], ensure_ascii=False))
    return jsonify({'status': 'success'})


@api_bp.route('/list', methods=['POST'])
def api_get_list_route():
    data = request.json
    url = data.get('url')
    sites = get_sites()
    site = next((s for s in sites if s['url'] == url), None)
    ssl_verify = site.get('ssl_verify', True) if site else True

    params = {
        'pg': data.get('page', 1),
        't': data.get('type_id'),
        'wd': data.get('keyword')
    }
    params = {k: v for k, v in params.items() if v}

    # 站點名稱用於日誌(沿用上面已查到的 site,不必再讀一次)
    site_name = site['name'] if site else None

    result = process_api_request(url, params, logger, ssl_verify=ssl_verify, site_name=site_name)
    return jsonify(result)

@api_bp.route('/details', methods=['POST'])
def api_get_details_route():
    data = request.json
    url = data.get('url')
    sites = get_sites()
    site = next((s for s in sites if s['url'] == url), None)
    ssl_verify = site.get('ssl_verify', True) if site else True

    result = get_details_from_api(url, data.get('id'), logger, ssl_verify=ssl_verify, site_name=site['name'] if site else None)
    return jsonify(result)

@api_bp.route('/multi_site_search', methods=['POST'])
def multi_site_search():
    data = request.json
    site_ids = data.get('site_ids', [])
    keyword = data.get('keyword')
    page = data.get('page', 1)

    if not site_ids:
        return jsonify({'status': 'error', 'message': '缺少站台資訊'}), 400

    all_sites = get_sites()
    sites_to_search = [s for s in all_sites if s['id'] in site_ids and s.get('enabled', True)]
    
    all_results = []
    max_page_count = 0
    
    def search_site(site):
        params = {'wd': keyword, 'pg': page}
        ssl_verify = site.get('ssl_verify', True)
        try:
            result = process_api_request(site['url'], params, logger, ssl_verify=ssl_verify, site_name=site['name'])
            
            if result.get('status') == 'success':
                if result.get('list'):
                    for video in result['list']:
                        video['from_site'] = site['name']
                        video['from_site_id'] = site['id']
                    
                    page_count = int(result.get('pagecount', 0))
                    return result['list'], page_count
                else:
                    # 搜尋成功但沒有結果
                    page_count = int(result.get('pagecount', 0))
                    return [], page_count
            else:
                # 真正的搜尋失敗
                error_msg = result.get('message', '未知錯誤')
                logger.warning(f"站台 {site['name']} 搜尋失敗: {error_msg}")
                return [], 0
        except Exception as e:
            logger.error(f"站台 {site['name']} 搜尋異常: {type(e).__name__}: {str(e)}")
            return [], 0

    # 限制最大併發數，防止資源耗盡 - 針對小型伺服器 (512MB RAM + 0.5 CPU)
    max_workers = min(len(sites_to_search), 6)  # 最多同時 6 個請求（適中配置）
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_site = {executor.submit(search_site, site): site for site in sites_to_search}
        for future in concurrent.futures.as_completed(future_to_site):
            try:
                results, page_count = future.result()
                all_results.extend(results)
                if page_count > max_page_count:
                    max_page_count = page_count
            except Exception as exc:
                site_name = future_to_site[future]['name']
                logger.error(f'站台 {site_name} 搜尋異常: {type(exc).__name__}: {str(exc)}')

    if max_page_count == 0 and len(all_results) == 0:
        max_page_count = page

    # 統計各站台的搜尋結果
    results_by_site = {}
    # 初始化所有站台的結果為0
    for site in sites_to_search:
        results_by_site[site['name']] = 0
    
    # 統計有結果的站台
    for video in all_results:
        site_name = video.get('from_site', 'unknown')
        if site_name in results_by_site:
            results_by_site[site_name] += 1

    logger.info(f"多站台搜尋完成 - 總結果數: {len(all_results)}, 參與搜尋站台數: {len(sites_to_search)}, 有結果站台數: {len([s for s in results_by_site.values() if s > 0])}, 各站台統計: {results_by_site}")

    return jsonify({
        'status': 'success',
        'list': all_results,
        'page': page,
        'pagecount': max_page_count,
        'total': len(all_results),
        'search_stats': {
            'total_sites_searched': len(sites_to_search),
            'sites_with_results': len(results_by_site),
            'results_by_site': results_by_site
        }
    })

@api_bp.route('/sites/check_now', methods=['POST'])
def check_sites_now():
    """立即檢查所有站點並返回結果"""
    from site_manager import check_sites_immediately
    try:
        data = request.json or {}
        include_disabled = data.get('include_disabled', False)
        results = check_sites_immediately(include_disabled=include_disabled)
        return jsonify({
            'status': 'success',
            'results': results
        })
    except Exception as e:
        logger.error(f"立即檢查站點失敗: {e}")
        return jsonify({'status': 'error', 'message': f'檢查失敗: {e}'}), 500

@api_bp.route('/sites/<int:site_id>/check', methods=['POST'])
def check_single_site(site_id):
    """檢查單一站點"""
    from site_manager import check_single_site_health
    try:
        result = check_single_site_health(site_id)
        return jsonify({
            'status': 'success',
            'result': result
        })
    except Exception as e:
        logger.error(f"檢查站點 {site_id} 失敗: {e}")
        return jsonify({'status': 'error', 'message': f'檢查失敗: {e}'}), 500

@api_bp.route('/history/check_updates', methods=['POST'])
def check_history_updates():
    """批量檢查歷史記錄更新"""
    try:
        data = request.json
        history_items = data.get('history_items', [])
        
        if not history_items:
            return jsonify({'status': 'error', 'message': '沒有要檢查的歷史記錄'}), 400
        
        # 限制最多檢查10個，避免過度請求
        history_items = history_items[:10]
        
        all_sites = get_sites()
        results = []
        updated_count = 0
        failed_count = 0
        
        for item in history_items:
            try:
                video_id = item.get('videoId')
                site_id = item.get('siteId')
                site_name = item.get('siteName')
                old_total_episodes = item.get('totalEpisodes', 0)
                video_name = item.get('videoName', '未知影片')
                
                # 查找對應的站點
                site = next((s for s in all_sites if s['id'] == site_id), None)
                if not site and site_name:
                    site = next((s for s in all_sites if s['name'] == site_name), None)
                
                # 跳過不存在、無URL或已停用的站點
                if not site or not site.get('url') or not site.get('enabled', True):
                    results.append({
                        'videoId': video_id,
                        'siteId': site_id,
                        'status': 'skipped',
                        'reason': '站台不存在、無URL或已停用'
                    })
                    continue
                
                # 獲取影片詳情
                ssl_verify = site.get('ssl_verify', True)
                detail_result = get_details_from_api(site['url'], video_id, logger, ssl_verify=ssl_verify, site_name=site['name'])
                
                if detail_result.get('status') != 'success' or not detail_result.get('data'):
                    results.append({
                        'videoId': video_id,
                        'siteId': site_id,
                        'status': 'failed',
                        'reason': detail_result.get('message', '獲取詳情失敗')
                    })
                    failed_count += 1
                    continue
                
                # 計算總集數（取各來源最大值）
                total_episodes = 0
                for source in detail_result['data']:
                    if source.get('episodes'):
                        episode_count = len(source['episodes'])
                        if episode_count > total_episodes:
                            total_episodes = episode_count
                
                # 比較集數變化
                has_update = False
                new_episodes_count = 0
                
                if old_total_episodes == 0:
                    # 首次記錄集數
                    results.append({
                        'videoId': video_id,
                        'siteId': site_id,
                        'status': 'success',
                        'totalEpisodes': total_episodes,
                        'hasUpdate': False
                    })
                elif total_episodes > old_total_episodes:
                    # 有新集數
                    has_update = True
                    new_episodes_count = total_episodes - old_total_episodes
                    updated_count += 1
                    
                    results.append({
                        'videoId': video_id,
                        'siteId': site_id,
                        'status': 'success',
                        'totalEpisodes': total_episodes,
                        'hasUpdate': True,
                        'newEpisodesCount': new_episodes_count
                    })
                    
                    logger.info(f"發現更新: {video_name} 新增 {new_episodes_count} 集 (從 {old_total_episodes} 到 {total_episodes})")
                else:
                    # 無變化
                    results.append({
                        'videoId': video_id,
                        'siteId': site_id,
                        'status': 'success',
                        'totalEpisodes': total_episodes,
                        'hasUpdate': False
                    })
                
            except Exception as e:
                logger.error(f"檢查影片 {item.get('videoName', '未知')} 更新失敗: {e}")
                results.append({
                    'videoId': item.get('videoId'),
                    'siteId': item.get('siteId'),
                    'status': 'error',
                    'reason': str(e)
                })
                failed_count += 1
        
        logger.info(f"批量檢查完成: 檢查 {len(history_items)} 個，更新 {updated_count} 個，失敗 {failed_count} 個")
        
        return jsonify({
            'status': 'success',
            'results': results,
            'summary': {
                'total': len(history_items),
                'updated': updated_count,
                'failed': failed_count
            }
        })
        
    except Exception as e:
        logger.error(f"批量檢查歷史更新失敗: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500
