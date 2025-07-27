import time
import concurrent.futures
from flask import Blueprint, request, jsonify
from urllib.parse import urlparse, urlunparse

from logger_config import setup_logger
from site_manager import get_sites, save_sites
from api_parser import process_api_request, get_details_from_api

api_bp = Blueprint('api', __name__, url_prefix='/api')
logger = setup_logger()

def clean_base_url(raw_url):
    try:
        parsed = urlparse(raw_url)
        return urlunparse((parsed.scheme, parsed.netloc, '', '', '', ''))
    except Exception:
        return raw_url

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
            
            cleaned_url = clean_base_url(raw_url)
            
        except ValueError as e:
            logger.warning(f"POST /api/sites - 400 Bad Request (無效URL: {raw_url}), 錯誤: {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 400
        
        if not name:
            try:
                domain = urlparse(cleaned_url).netloc
                if domain.startswith('www.'): domain = domain[4:]
                elif domain.startswith('api.'): domain = domain[4:]
                
                parts = domain.split('.')
                common_tlds = ['com', 'net', 'org', 'xyz', 'top', 'cn', 'cc']
                if len(parts) > 1 and parts[-1] in common_tlds:
                    name = parts[-2]
                else:
                    name = parts[0]
            except Exception as e:
                logger.error(f"自動命名失敗: {e}")
                name = "未命名站點"
        
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
    
    # 獲取站點名稱用於日誌
    sites = get_sites()
    site = next((s for s in sites if s['url'] == url), None)
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

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(sites_to_search)) as executor:
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
