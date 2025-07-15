import os
import json
from flask import Flask, request, jsonify, render_template, cli, session, redirect, url_for
from urllib.parse import urlparse, urlunparse
import time
import concurrent.futures
from werkzeug.security import generate_password_hash, check_password_hash

from logger_config import setup_logger
from site_manager import get_sites, save_sites
from api_parser import process_api_request, get_details_from_api

cli.show_server_banner = lambda *x: None
app = Flask(__name__)
logger = setup_logger()

DATA_DIR = 'data'
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')

def load_config():
    if not os.path.exists(CONFIG_FILE):
        return {}
    with open(CONFIG_FILE, 'r') as f:
        return json.load(f)

def save_config(config):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)

# --- Initialize Secret Key ---
config = load_config()
if 'secret_key' not in config:
    config['secret_key'] = os.urandom(24).hex()
    save_config(config)
# Convert hex string back to bytes for Flask
app.secret_key = bytes.fromhex(config['secret_key'])

# --- Constants for login security ---
MAX_LOGIN_ATTEMPTS = 10
LOGIN_LOCKOUT_MINUTES = 15
LOGIN_LOCKOUT_TIME = LOGIN_LOCKOUT_MINUTES * 60  # seconds

def is_password_set():
    config = load_config()
    return 'password_hash' in config

def set_password(password):
    config = load_config()
    config['password_hash'] = generate_password_hash(password)
    save_config(config)

def check_password(password):
    config = load_config()
    return check_password_hash(config.get('password_hash', ''), password)

@app.before_request
def require_login():
    # Define routes that don't require any checks
    public_endpoints = ['setup_password', 'static']

    # If password is not set, only allow access to setup and static files
    if not is_password_set():
        if request.endpoint not in public_endpoints:
            # For API requests, return a JSON error
            if request.path.startswith('/api/'):
                return jsonify({'status': 'error', 'message': '密碼尚未設定', 'action': 'setup_password'}), 401
            # For other requests, redirect to the setup page
            return redirect(url_for('setup_password'))
        return

    # If password is set, check for login status
    # Routes allowed without being logged in
    allowed_when_logged_out = ['login', 'static']
    if 'logged_in' not in session and request.endpoint not in allowed_when_logged_out:
        # For API requests, return a JSON error
        if request.path.startswith('/api/'):
            return jsonify({'status': 'error', 'message': '需要登入', 'action': 'login'}), 401
        # For other requests, redirect to login page
        return redirect(url_for('login'))

@app.route('/setup-password', methods=['GET', 'POST'])
def setup_password():
    if is_password_set():
        # If password is set, redirect to login or index
        if 'logged_in' in session:
            return redirect(url_for('index'))
        return redirect(url_for('login'))
    
    if request.method == 'POST':
        password = request.form['password']
        set_password(password)
        session['logged_in'] = True # Log in immediately after setting password
        return redirect(url_for('index'))
    return render_template('password_setup.html') # This template is for password setup


@app.route('/setup', methods=['GET'])
def site_setup():
    return render_template('setup.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'logged_in' in session:
        return redirect(url_for('index'))

    # Check for lockout
    if session.get('login_attempts', 0) >= MAX_LOGIN_ATTEMPTS:
        last_attempt_time = session.get('last_attempt_time', 0)
        if time.time() - last_attempt_time < LOGIN_LOCKOUT_TIME:
            remaining_time = int(LOGIN_LOCKOUT_TIME - (time.time() - last_attempt_time))
            minutes, seconds = divmod(remaining_time, 60)
            error_msg = f'嘗試次數過多，請在 {minutes} 分 {seconds} 秒後再試。'
            return render_template('login.html', error=error_msg)
        else:
            # If lockout time has passed, reset the counter
            session.pop('login_attempts', None)
            session.pop('last_attempt_time', None)

    if request.method == 'POST':
        if check_password(request.form['password']):
            session['logged_in'] = True
            # Reset attempts on successful login
            session.pop('login_attempts', None)
            session.pop('last_attempt_time', None)
            return redirect(url_for('index'))
        else:
            # Increment failed attempts
            session['login_attempts'] = session.get('login_attempts', 0) + 1
            session['last_attempt_time'] = time.time()
            
            attempts_left = MAX_LOGIN_ATTEMPTS - session.get('login_attempts', 0)
            if attempts_left > 0:
                error_msg = f'密碼錯誤，還剩下 {attempts_left} 次嘗試機會。'
            else:
                error_msg = f'嘗試次數過多，帳戶已鎖定 {LOGIN_LOCKOUT_MINUTES} 分鐘。'
            return render_template('login.html', error=error_msg)
            
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

def clean_base_url(raw_url):
    try:
        parsed = urlparse(raw_url)
        return urlunparse((parsed.scheme, parsed.netloc, '', '', '', ''))
    except Exception:
        return raw_url

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/sites', methods=['GET', 'POST'])
def add_or_get_sites():
    sites = get_sites()
    if request.method == 'GET':
        logger.info("GET /api/sites - 請求已啟用且排序的站點列表")
        # Filter for enabled sites and sort by the 'order' key
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

@app.route('/api/sites/<int:site_id>', methods=['PUT', 'DELETE'])
def manage_site(site_id):
    sites = get_sites()
    site_index, site_to_manage = next(((i, s) for i, s in enumerate(sites) if s['id'] == site_id), (None, None))

    if not site_to_manage:
        return jsonify({'status': 'error', 'message': '未找到該站點'}), 404

    if request.method == 'PUT':
        data = request.json
        # Safely update fields, providing defaults for old data that might be missing keys.
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

@app.route('/api/sites/<int:site_id>/move', methods=['POST'])
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
        
    # Re-assign order
    for i, site in enumerate(sites):
        site['order'] = i
        
    save_sites(sites)
    return jsonify({'status': 'success', 'sites': sites})

@app.route('/api/list', methods=['POST'])
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
    result = process_api_request(url, params, logger, ssl_verify=ssl_verify)
    return jsonify(result)

@app.route('/api/details', methods=['POST'])
def api_get_details_route():
    data = request.json
    url = data.get('url')
    sites = get_sites()
    site = next((s for s in sites if s['url'] == url), None)
    ssl_verify = site.get('ssl_verify', True) if site else True

    result = get_details_from_api(url, data.get('id'), logger, ssl_verify=ssl_verify)
    return jsonify(result)

@app.route('/api/multi_site_search', methods=['POST'])
def multi_site_search():
    data = request.json
    site_ids = data.get('site_ids', [])
    keyword = data.get('keyword')
    page = data.get('page', 1)

    if not keyword or not site_ids:
        return jsonify({'status': 'error', 'message': '缺少關鍵字或站台資訊'}), 400

    all_sites = get_sites()
    sites_to_search = [s for s in all_sites if s['id'] in site_ids and s.get('enabled', True)]
    
    all_results = []
    max_page_count = 0
    
    def search_site(site):
        params = {'wd': keyword, 'pg': page}
        ssl_verify = site.get('ssl_verify', True)
        try:
            result = process_api_request(site['url'], params, logger, ssl_verify=ssl_verify)
            if result.get('status') == 'success' and result.get('list'):
                for video in result['list']:
                    video['from_site'] = site['name']
                    video['from_site_id'] = site['id']
                
                page_count = int(result.get('pagecount', 0))
                return result['list'], page_count
        except Exception as e:
            logger.error(f"多站台搜尋失敗 - 站台: {site['name']}, 錯誤: {e}")
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
                logger.error(f'{site_name} generated an exception: {exc}')

    # If no results were found on any site for the current page, max_page_count might be 0.
    # In this case, we can assume the total page count is the current page number.
    if max_page_count == 0 and len(all_results) == 0:
        max_page_count = page

    return jsonify({
        'status': 'success',
        'list': all_results,
        'page': page,
        'pagecount': max_page_count,
        'total': len(all_results)
    })

if __name__ == '__main__':
    logger.info("==============================================")
    logger.info("   資源站點管理器 v5.8 啟動！")
    logger.info("==============================================")
    logger.info(f"請用瀏覽器訪問: http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=True)
