# Vercel serverless 進入點
#
# Vercel 的 @vercel/python 會自動偵測名為 `app` 的 WSGI 物件並接管。
# 這裡只負責把專案根目錄加進 import 路徑，再匯入既有的 Flask app，
# 不改動任何原本的應用邏輯（Docker / 本機仍走 web_app.py 自己）。

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from web_app import app  # noqa: E402  (匯入前必須先設好 sys.path)
