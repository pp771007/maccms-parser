import os, tempfile, time
import ujson as json
import storage
from werkzeug.security import generate_password_hash

storage.DATA_DIR = tempfile.mkdtemp(prefix='maccms_preview_')
storage._writable_cache = True
storage.USE_KV = False

SITE_URL = 'http://testsite.example/api.php/provide/vod'
NOW = int(time.time() * 1000)

storage.set_text('config.json', json.dumps({
    'password_hash': generate_password_hash('preview123'),
    'site_title': '預覽',
}, ensure_ascii=False))
storage.set_text('sites.json', json.dumps([
    {'id': 's1', 'name': '測試站', 'url': SITE_URL, 'enabled': True, 'ssl_verify': False, 'order': 0},
], ensure_ascii=False))
storage.set_text('members', json.dumps([
    {'id': 1001, 'password_hash': generate_password_hash('member123'), 'nickname': '客廳電視'},
], ensure_ascii=False))
storage.set_text('history_admin', json.dumps([{
    'videoId': '12345', 'siteUrl': SITE_URL, 'siteName': '測試站',
    'videoName': '伺服器上的片', 'videoPic': '', 'episodeName': '第 3 集', 'episodeUrl': 'http://ep3',
    'sourceIndex': 0, 'episodeIndex': 2, 'positionSec': 300, 'durationSec': 1500,
    'totalEpisodes': 10, 'updatedAt': NOW,
}], ensure_ascii=False))

os.environ['SECRET_KEY'] = 'preview_secret_key_0123456789abcdef'
import web_app
web_app.app.config['TEMPLATES_AUTO_RELOAD'] = True
web_app.app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
print('DATA_DIR =', storage.DATA_DIR)
web_app.app.run(host='0.0.0.0', port=5057, debug=False, use_reloader=False)
