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

# 設定 Gunicorn 啟動參數，避免卡死
CMD ["gunicorn", "--worker-class", "gevent", "--workers", "2", "--bind", "0.0.0.0:5000", "web_app:app"]
