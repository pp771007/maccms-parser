# 使用官方 Python 映像檔作為基礎
FROM python:3.9-slim

# 安裝 curl（用於健康檢查）
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# 設定工作目錄
WORKDIR /app

# 複製依賴檔案並安裝
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製專案所有檔案到工作目錄
COPY . .

# 宣告資料 Volume
VOLUME /app/data

# 宣告容器對外的連接埠
EXPOSE 5000

# 設定 Gunicorn 啟動參數 - 針對小型雲端伺服器優化 (512MB RAM + 0.5 CPU)
# --workers: 2 個 worker（平衡效能和記憶體）
# --worker-connections: 每個 worker 的最大連接數
# --timeout: 請求處理超時時間（秒）
# --graceful-timeout: 優雅關閉超時時間（秒）
# --max-requests: 每個 worker 處理請求數後重啟，防止記憶體洩漏
# --max-requests-jitter: 隨機抖動，避免所有 worker 同時重啟
# --keep-alive: 保持連接時間（秒）
# --preload: 預載入應用程式以節省記憶體
CMD ["gunicorn", \
     "--worker-class", "gevent", \
     "--workers", "2", \
     "--worker-connections", "75", \
     "--timeout", "120", \
     "--graceful-timeout", "25", \
     "--max-requests", "800", \
     "--max-requests-jitter", "80", \
     "--keep-alive", "4", \
     "--preload", \
     "--bind", "0.0.0.0:5000", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "web_app:app"]
