from flask import Blueprint, render_template, request, jsonify, send_file, Response
import os
import time
import ujson as json
from config import get_config_value, set_config_value

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    from web_app import VERSION
    site_title = get_config_value('site_title', '資源站點管理器')
    favicon_ext = get_config_value('favicon_ext', 'svg')
    favicon_version = get_config_value('favicon_version', '')
    favicon_url = f"/favicon?v={favicon_version}"
    return render_template('index.html', site_title=site_title, favicon_url=favicon_url, version=VERSION)

@main_bp.route('/setup')
def site_setup():
    site_title = get_config_value('site_title', '資源站點管理器')
    favicon_ext = get_config_value('favicon_ext', 'svg')
    favicon_version = get_config_value('favicon_version', '')
    favicon_url = f"/favicon?v={favicon_version}"
    return render_template('setup.html', site_title=site_title, favicon_url=favicon_url)

@main_bp.route('/settings', methods=['GET', 'POST'])
def site_settings():
    if request.method == 'GET':
        site_title = get_config_value('site_title', '資源站點管理器')
        favicon_ext = get_config_value('favicon_ext', 'svg')
        favicon_version = get_config_value('favicon_version', '')
        return jsonify({
            'site_title': site_title,
            'favicon_ext': favicon_ext,
            'favicon_version': favicon_version
        })
    # POST: 更新 site_title 與 favicon
    if request.args.get('reset_favicon') == '1':
        # 刪除自訂 favicon，回復預設
        for ext in ['svg', 'png']:
            path = os.path.join('data', f'favicon.{ext}')
            if os.path.exists(path):
                os.remove(path)
        set_config_value('favicon_ext', 'svg')
        set_config_value('favicon_version', str(int(time.time())))
        return jsonify({'status': 'success'})
    site_title = request.form.get('site_title', '資源站點管理器')
    if not site_title.strip():
        site_title = '資源站點管理器'
    set_config_value('site_title', site_title)
    # 處理 favicon 上傳
    if 'favicon' in request.files:
        file = request.files['favicon']
        if file.filename:
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in ['.svg', '.png']:
                return jsonify({'status': 'error', 'message': '只允許上傳 SVG 或 PNG 檔案'}), 400
            mime = file.mimetype
            if ext == '.svg' and mime != 'image/svg+xml':
                return jsonify({'status': 'error', 'message': 'SVG 檔案格式錯誤'}), 400
            if ext == '.png' and mime != 'image/png':
                return jsonify({'status': 'error', 'message': 'PNG 檔案格式錯誤'}), 400
            # 刪除舊檔案
            for old_ext in ['svg', 'png']:
                old_path = os.path.join('data', f'favicon.{old_ext}')
                if os.path.exists(old_path):
                    os.remove(old_path)
            # 儲存新檔案
            save_path = os.path.join('data', f'favicon{ext}')
            file.save(save_path)
            set_config_value('favicon_ext', ext[1:])
            set_config_value('favicon_version', str(int(time.time())))
    return jsonify({'status': 'success'})

@main_bp.route('/favicon')
def serve_favicon():
    ext = get_config_value('favicon_ext', 'svg')
    path = os.path.join('data', f'favicon.{ext}')
    if not os.path.exists(path):
        # fallback to預設
        path = os.path.join('static', 'img', 'favicon.svg')
        mimetype = 'image/svg+xml'
    else:
        mimetype = 'image/svg+xml' if ext == 'svg' else 'image/png'
    return send_file(path, mimetype=mimetype)

@main_bp.route('/manifest.json', strict_slashes=False)
def manifest():
    site_title = get_config_value('site_title', '資源站點管理器')
    favicon_ext = get_config_value('favicon_ext', 'svg')
    favicon_version = get_config_value('favicon_version', '')
    icon_url = f"/favicon?v={favicon_version}"
    manifest_data = {
        "name": site_title,
        "short_name": site_title,
        "start_url": "/",
        "display": "standalone",
        "background_color": "#121212",
        "theme_color": "#1890ff",
        "icons": [
            {
                "src": icon_url,
                "sizes": "192x192",
                "type": f"image/{'svg+xml' if favicon_ext == 'svg' else 'png'}"
            },
            {
                "src": icon_url,
                "sizes": "512x512",
                "type": f"image/{'svg+xml' if favicon_ext == 'svg' else 'png'}"
            }
        ]
    }
    return Response(json.dumps(manifest_data, ensure_ascii=False), content_type='application/json')
