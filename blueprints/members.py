import time
from flask import Blueprint, request, render_template, jsonify
from werkzeug.security import generate_password_hash
from config import get_config_value
from blueprints.auth import get_members, save_members, password_in_use, member_nickname, revoke_account_tokens
import storage

members_bp = Blueprint('members', __name__)


@members_bp.route('/members')
def members_page():
    site_title = get_config_value('site_title', '資源站點管理器')
    favicon_url = f"/favicon?v={get_config_value('favicon_version', '')}"
    return render_template('members.html', site_title=site_title, favicon_url=favicon_url)


@members_bp.route('/api/members', methods=['GET'])
def api_list_members():
    # 不外洩 password_hash,只回 id 與暱稱
    return jsonify([{'id': m['id'], 'nickname': member_nickname(m)} for m in get_members()])


@members_bp.route('/api/members', methods=['POST'])
def api_add_member():
    data = request.get_json(silent=True) or {}
    password = (data.get('password') or '').strip()
    nickname = (data.get('nickname') or data.get('note') or '').strip()
    if not password:
        return jsonify({'status': 'error', 'message': '密碼不能為空'}), 400
    if len(password) < 4:
        return jsonify({'status': 'error', 'message': '密碼至少 4 個字元'}), 400
    # 登入只用密碼辨識身分,所以密碼不可與管理員或其他會員重複
    if password_in_use(password):
        return jsonify({'status': 'error', 'message': '這個密碼已被管理員或其他會員使用,請換一個'}), 400

    members = get_members()
    members.append({
        'id': int(time.time() * 1000),
        'password_hash': generate_password_hash(password),
        'nickname': nickname,
    })
    save_members(members)
    return jsonify({'status': 'success'}), 201


@members_bp.route('/api/members/<int:member_id>', methods=['DELETE'])
def api_delete_member(member_id):
    members = get_members()
    remaining = [m for m in members if m['id'] != member_id]
    if len(remaining) == len(members):
        return jsonify({'status': 'error', 'message': '找不到該會員'}), 404
    save_members(remaining)
    # 順手清掉該會員綁定的觀看歷史 + 撤銷其裝置 token
    storage.delete(f'history_m{member_id}')
    revoke_account_tokens(f'm{member_id}')
    return jsonify({'status': 'success'})
