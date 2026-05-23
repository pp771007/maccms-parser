# web_app.py

import os
from flask import Flask, cli
from config import get_config_value, set_config_value
from logger_config import setup_logger

# --- Blueprints ---
from blueprints.auth import auth_bp, init_auth_check
from blueprints.api import api_bp
from blueprints.main import main_bp
from blueprints.members import members_bp

# --- Flask App Initialization ---
cli.show_server_banner = lambda *x: None
app = Flask(__name__)
logger = setup_logger()

# --- Version Configuration ---
VERSION = "v7.11"

logger.info("==============================================")
logger.info(f"   資源站點管理器 {VERSION} 啟動！")
logger.info("==============================================")

# --- Initialize Secret Key ---
# serverless（如 Vercel）每次冷啟動都是全新環境、檔案存不住，所以優先吃環境變數
# SECRET_KEY，確保 session cookie 簽章用的鑰匙固定、登入狀態不會被重置。
# 本機 / Docker 沒設環境變數時，沿用舊行為：生成一把存進設定檔。
env_secret_key = os.environ.get('SECRET_KEY')
if env_secret_key:
    app.secret_key = env_secret_key.encode('utf-8')
else:
    secret_key = get_config_value('secret_key')
    if not secret_key:
        secret_key = os.urandom(24).hex()
        try:
            set_config_value('secret_key', secret_key)
        except Exception as e:
            # 唯讀環境（如未連 KV 的 Vercel）寫不進設定檔。早期版本會在這裡直接拋例外，
            # 導致整個 serverless function 在 import 階段就崩潰、每個請求都 500。
            # 改成退而求其次：用這把記憶體裡的臨時金鑰，至少讓網站起得來。
            # 代價：冷啟動換機器後金鑰會變、需要重新登入。要穩定就設 SECRET_KEY 環境變數或連 KV。
            logger.warning(
                f"無法保存 secret_key（可能是唯讀檔案系統且未設定 KV）: {e}。"
                "改用記憶體臨時金鑰，冷啟動後需重新登入；要穩定請設定 SECRET_KEY 環境變數或連結 KV。"
            )
    app.secret_key = bytes.fromhex(secret_key)

# --- Register Blueprints ---
app.register_blueprint(auth_bp)
app.register_blueprint(api_bp)
app.register_blueprint(main_bp)
app.register_blueprint(members_bp)

# --- Initialize Request Hooks ---
init_auth_check(app)



# --- Main Execution ---
if __name__ == '__main__':
    is_docker = os.path.exists('/.dockerenv')
    host = '0.0.0.0' if is_docker else '127.0.0.1'
    logger.info(f"請用瀏覽器訪問: http://{host}:5000")
    app.run(host=host, port=5000, debug=True)
