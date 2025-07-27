# MacCMS Parser

一個用於解析和播放 MacCMS 系統影片的 Web 應用程式，支援多站點聚合搜尋與智慧管理。

[![Docker Hub](https://img.shields.io/docker/pulls/smp771007/maccms-parser.svg)](https://hub.docker.com/r/smp771007/maccms-parser)
[![GitHub Stars](https://img.shields.io/github/stars/pp771007/maccms_parser.svg)](https://github.com/pp771007/maccms_parser/stargazers)
[![GitHub license](https://img.shields.io/github/license/pp771007/maccms_parser.svg)](https://github.com/pp771007/maccms_parser/blob/main/LICENSE)

## ✨ 主要功能

### 🔍 多站點聚合搜尋
- 同時搜尋多個資源站點
- 智慧聚合相同名稱的影片結果
- 支援按分類瀏覽各站點影片

### 🛠️ 智慧站點管理
- **自動健康檢查**：每小時自動檢查站點可用性
- **手動檢查與排序**：隨時手動觸發檢查，可自訂站點順序
- **站點選擇記憶**：自動記住您上次使用的單選或多選站點

### 🎬 整合播放器
- 內建 Artplayer 播放器
- 支援多來源無縫切換
- 針對行動裝置優化

### 🔐 安全認證
- 密碼保護管理後台
- 30天免登入 Session
- 搜尋歷史保存

## 🚀 快速開始

### 使用 Docker (推薦)

```bash
docker run -d -p 5000:5000 -v ./maccms_data:/app/data --name maccms-parser smp771007/maccms-parser
```

**參數說明：**
- `-d`：背景執行容器
- `-p 5000:5000`：將主機的 5000 連接埠映射到容器
- `-v ./maccms_data:/app/data`：掛載資料夾，持久化保存設定
- `--name maccms-parser`：為容器命名

啟動後訪問：`http://您的主機IP:5000`

### 手動安裝

**環境要求：**
- Python 3.7+
- Git

**安裝步驟：**

1. 克隆專案
```bash
git clone https://github.com/pp771007/maccms_parser.git
cd maccms_parser
```

2. 安裝依賴
```bash
pip install -r requirements.txt
```

3. 啟動應用
```bash
python web_app.py
```

4. 訪問應用：`http://127.0.0.1:5000`

## 📝 使用說明

1. **首次設定**：第一次訪問時，系統會引導您設定管理員密碼
2. **新增站點**：進入主頁後，點擊「站點管理」按鈕，新增資源站點 API 地址
3. **開始使用**：新增站點後，即可開始搜尋、瀏覽影片

## 🛠️ 技術棧

- **後端**：Flask
- **前端**：HTML, CSS, JavaScript (無框架)
- **並行處理**：ThreadPoolExecutor 用於加速多站點搜尋
