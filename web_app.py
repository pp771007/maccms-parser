import os
import json
from flask import Flask, request, jsonify, render_template, cli, session, redirect, url_for
from urllib.parse import urlparse, urlunparse
import time
from werkzeug.security import generate_password_hash, check_password_hash

from logger_config import setup_logger
from site_manager import get_sites, save_sites
from api_parser import process_api_request, get_details_from_api

cli.show_server_banner = lambda *x: None
app = Flask(__name__)
logger = setup_logger()

CONFIG_FILE = 'config.json'

def load_config():
    if not os.path.exists(CONFIG_FILE):
        return {}
    with open(CONFIG_FILE, 'r') as f:
        return json.load(f)

def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)

# --- Initialize Secret Key ---
config = load_config()
if 'secret_key' not in config:
    config['secret_key'] = os.urandom(24).hex()
    save_config(config)
# Convert hex string back to bytes for Flask
app.secret_key = bytes.fromhex(config['secret_key'])

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
    if not is_password_set() and request.endpoint not in ['setup', 'static']:
        return redirect(url_for('setup'))
    
    allowed_routes = ['login', 'setup', 'static']
    if 'logged_in' not in session and request.endpoint not in allowed_routes:
        return redirect(url_for('login'))

@app.route('/setup', methods=['GET', 'POST'])
def setup():
    if is_password_set():
        return redirect(url_for('login'))
    if request.method == 'POST':
        password = request.form['password']
        set_password(password)
        return redirect(url_for('login'))
    return render_template('setup.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'logged_in' in session:
        return redirect(url_for('index'))
    if request.method == 'POST':
        if check_password(request.form['password']):
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='密碼錯誤')
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
        logger.info("GET /api/sites - 請求站點列表")
        return jsonify(sites)
    
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
            'url': cleaned_url
        }
        
        sites.append(new_site)
        save_sites(sites)
        logger.info(f"POST /api/sites - 201 Created (新增站點: {new_site['name']}, URL: {new_site['url']})")
        return jsonify({'status': 'success', 'site': new_site}), 201

@app.route('/api/sites/<int:site_id>', methods=['DELETE'])
def delete_site(site_id):
    sites = get_sites()
    site_to_delete = next((s for s in sites if s['id'] == site_id), None)
    if not site_to_delete:
        return jsonify({'status': 'error', 'message': '未找到該站點'}), 404
    updated_sites = [s for s in sites if s['id'] != site_id]
    save_sites(updated_sites)
    return jsonify({'status': 'success', 'message': '站點已刪除'}), 200

@app.route('/api/list', methods=['POST'])
def api_get_list_route():
    data = request.json
    params = {
        'pg': data.get('page', 1),
        't': data.get('type_id'),
        'wd': data.get('keyword')
    }
    params = {k: v for k, v in params.items() if v}
    result = process_api_request(data.get('url'), params, logger)
    return jsonify(result)

@app.route('/api/details', methods=['POST'])
def api_get_details_route():
    data = request.json
    result = get_details_from_api(data.get('url'), data.get('id'), logger)
    return jsonify(result)

if __name__ == '__main__':
    logger.info("==============================================")
    logger.info("   資源站點管理器 v5.8 啟動！")
    logger.info("==============================================")
    logger.info(f"請用瀏覽器訪問: http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=True)
