# maccms-parser

**maccms-parser** 是一個基於 Flask 開發的蘋果CMS資源站點聚合管理工具，讓您能輕鬆管理、搜尋並聚合來自多個資源站點的影片內容。

[![Docker Hub](https://img.shields.io/docker/pulls/smp771007/maccms-parser.svg)](https://hub.docker.com/r/smp771007/maccms-parser)
[![GitHub Stars](https://img.shields.io/github/stars/pp771007/maccms_parser.svg)](https://github.com/pp771007/maccms_parser/stargazers)
[![GitHub license](https://img.shields.io/github/license/pp771007/maccms_parser.svg)](https://github.com/pp771007/maccms_parser/blob/main/LICENSE)

## ✨ 主要功能

- **多站點聚合搜尋**: 同時搜尋多個資源站，並將相同名稱的影片結果聚合顯示。
- **智慧站點管理**:
    - **自動健康檢查**: 每小時自動檢查站點可用性，並停用無效站點。
    - **手動檢查與排序**: 隨時手動觸發檢查，並可自訂站點順序。
- **分類瀏覽**: 支援按分類瀏覽各個站點的影片。
- **個人化設定**:
    - **站點選擇記憶**: 自動記住您上次使用的單選或多選站點。
    - **搜尋歷史**: 保存您的搜尋關鍵字與頁面狀態。
- **安全認證**: 透過密碼保護您的管理後台，並提供30天免登入 Session。
- **整合播放器**: 內建 DPlayer 播放器，支援多來源無縫切換。

## 🚀 快速開始

您可以透過 Docker 或手動方式安裝本應用。

### 使用 Docker (推薦)

這是最簡單的安裝方式。您只需要一行指令即可啟動應用。

```bash
docker run -d -p 5000:5000 -v ./maccms_data:/app/data --name maccms-parser smp771007/maccms-parser
```

- `-d`: 背景執行容器。
- `-p 5000:5000`: 將主機的 5000 連接埠映射到容器的 5000 連接埠。
- `-v ./maccms_data:/app/data`: 將主機當前目錄下的 `maccms_data` 資料夾掛載到容器的 `/app/data` 目錄，用於持久化保存您的站點設定與資料。
- `--name maccms-parser`: 為容器命名，方便管理。

啟動後，請開啟瀏覽器訪問 `http://您的主機IP:5000`。

### 手動安裝

如果您偏好手動設定環境，請依照以下步驟：

1.  **環境要求**:
    *   Python 3.7+
    *   Git

2.  **克隆專案**:
    ```bash
    git clone https://github.com/pp771007/maccms_parser.git
    cd maccms_parser
    ```

3.  **安裝依賴**:
    ```bash
    pip install -r requirements.txt
    ```

4.  **啟動應用**:
    ```bash
    python web_app.py
    ```

5.  **訪問應用**:
    開啟瀏覽器訪問 `http://127.0.0.1:5000`。

## 📝 使用說明

1.  **首次設定**: 第一次訪問應用時，系統會引導您設定管理員密碼。
2.  **新增站點**: 進入主頁後，點擊「站點管理」按鈕，新增您的資源站點 API 地址。
3.  **開始使用**: 新增站點後，即可開始搜尋、瀏覽影片。

## 🛠️ 技術棧

- **後端**: Flask
- **前端**: HTML, CSS, JavaScript (無框架)
- **並行處理**: `ThreadPoolExecutor` 用於加速多站點搜尋