import os
from flask import Flask, cli
from config import get_config_value, set_config_value
from logger_config import setup_logger

# --- Blueprints ---
from blueprints.auth import auth_bp, init_auth_check
from blueprints.api import api_bp
from blueprints.main import main_bp

# --- Flask App Initialization ---
cli.show_server_banner = lambda *x: None
app = Flask(__name__)
logger = setup_logger()

logger.info("==============================================")
logger.info("   資源站點管理器 v5.8 啟動！(Refactored)")
logger.info("==============================================")

# --- Initialize Secret Key ---
secret_key = get_config_value('secret_key')
if not secret_key:
    secret_key = os.urandom(24).hex()
    set_config_value('secret_key', secret_key)
app.secret_key = bytes.fromhex(secret_key)

# --- Register Blueprints ---
app.register_blueprint(auth_bp)
app.register_blueprint(api_bp)
app.register_blueprint(main_bp)

# --- Initialize Request Hooks ---
init_auth_check(app)

# --- Main Execution ---
if __name__ == '__main__':
    logger.info(f"請用瀏覽器訪問: http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=True)
