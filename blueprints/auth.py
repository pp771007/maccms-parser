import os
import time
from flask import Blueprint, request, render_template, session, redirect, url_for, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from config import load_config, save_config, get_config_value, set_config_value

auth_bp = Blueprint('auth', __name__)

# --- Constants for login security ---
MAX_LOGIN_ATTEMPTS = 10
LOGIN_LOCKOUT_MINUTES = 15
LOGIN_LOCKOUT_TIME = LOGIN_LOCKOUT_MINUTES * 60  # seconds

def is_password_set():
    return 'password_hash' in load_config()

def set_password(password):
    config = load_config()
    config['password_hash'] = generate_password_hash(password)
    save_config(config)

def check_password(password):
    config = load_config()
    return check_password_hash(config.get('password_hash', ''), password)

@auth_bp.route('/setup-password', methods=['GET', 'POST'])
def setup_password():
    if is_password_set():
        if 'logged_in' in session:
            return redirect(url_for('main.index'))
        return redirect(url_for('auth.login'))
    
    if request.method == 'POST':
        password = request.form['password']
        set_password(password)
        session['logged_in'] = True
        session.permanent = True  # 設定session為永久性
        return redirect(url_for('main.index'))
    return render_template('password_setup.html')

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if 'logged_in' in session:
        return redirect(url_for('main.index'))

    if session.get('login_attempts', 0) >= MAX_LOGIN_ATTEMPTS:
        last_attempt_time = session.get('last_attempt_time', 0)
        if time.time() - last_attempt_time < LOGIN_LOCKOUT_TIME:
            remaining_time = int(LOGIN_LOCKOUT_TIME - (time.time() - last_attempt_time))
            minutes, seconds = divmod(remaining_time, 60)
            error_msg = f'嘗試次數過多，請在 {minutes} 分 {seconds} 秒後再試。'
            return render_template('login.html', error=error_msg)
        else:
            session.pop('login_attempts', None)
            session.pop('last_attempt_time', None)

    if request.method == 'POST':
        if check_password(request.form['password']):
            session['logged_in'] = True
            session.permanent = True  # 設定session為永久性
            session.pop('login_attempts', None)
            session.pop('last_attempt_time', None)
            return redirect(url_for('main.index'))
        else:
            session['login_attempts'] = session.get('login_attempts', 0) + 1
            session['last_attempt_time'] = time.time()
            
            attempts_left = MAX_LOGIN_ATTEMPTS - session.get('login_attempts', 0)
            if attempts_left > 0:
                error_msg = f'密碼錯誤，還剩下 {attempts_left} 次嘗試機會。'
            else:
                error_msg = f'嘗試次數過多，帳戶已鎖定 {LOGIN_LOCKOUT_MINUTES} 分鐘。'
            return render_template('login.html', error=error_msg)
            
    return render_template('login.html')

@auth_bp.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('auth.login'))

def init_auth_check(app):
    # 設定session過期時間為30天
    app.config['PERMANENT_SESSION_LIFETIME'] = 30 * 24 * 60 * 60  # 30 days in seconds
    
    @app.before_request
    def require_login():
        # Public endpoints that don't require any checks
        public_endpoints = ['auth.setup_password', 'static']

        if not is_password_set():
            if request.endpoint not in public_endpoints:
                if request.path.startswith('/api/'):
                    return jsonify({'status': 'error', 'message': '密碼尚未設定', 'action': 'setup_password'}), 401
                return redirect(url_for('auth.setup_password'))
            return

        allowed_when_logged_out = ['auth.login', 'static']
        if 'logged_in' not in session and request.endpoint not in allowed_when_logged_out:
            if request.path.startswith('/api/'):
                return jsonify({'status': 'error', 'message': '需要登入', 'action': 'login'}), 401
            return redirect(url_for('auth.login'))
