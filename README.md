# 影視資源站點聚合器

這是一個基於 Flask 和 Vanilla JavaScript 的網頁應用程式，旨在提供一個簡潔、安全且高效的介面，用於聚合、管理、瀏覽和播放在線影視內容。本專案支援 Docker 一鍵部署，並內建使用者驗證機制。

## 核心功能

- **安全驗證**：
  - **首次設定**：應用程式首次啟動時，會引導使用者設定管理員密碼。
  - **登入系統**：所有操作均需密碼驗證，確保資源安全。

- **多站點管理**：
  - **動態站點**：支援動態新增、刪除影視資源站點。
  - **URL 自動處理**：自動清洗 URL，只保留核心域名。
  - **智慧命名**：若未提供站點名稱，系統會根據 URL 自動生成。
  - **資料持久化**：所有站點資訊儲存在 `data/sites.json`，設定檔儲存在 `data/config.json`。

- **內容瀏覽與播放**：
  - **分類與搜索**：支援按分類篩選或按關鍵字搜索影片。
  - **整合播放器**：內建 DPlayer 播放器，支援 HLS (m3u8) 格式，點擊封面即可播放。

- **使用者體驗優化**：
  - **簡繁轉換**：提供一鍵將搜索關鍵字從繁體轉換為簡體的功能，提高搜索準確性。
  - **高效分頁**：支援快速翻頁及頁碼跳轉，並在換頁後自動滾動至頁面頂部。
  - **狀態記憶**：自動記住上次使用的站點，方便後續操作。
  - **響應式設計**：介面完美適應桌面和行動裝置。

## 技術棧

- **後端**:
  - **Flask**: 輕量級 Python Web 框架。
  - **Gunicorn**: 高效能的 WSGI 伺服器，用於生產環境。
  - **Requests**: 用於向目標站點發送 HTTP 請求。

- **前端**:
  - **Vanilla JavaScript (ESM)**: 採用原生 JavaScript 和 ES 模組，無前端框架依賴。
  - **DPlayer**: 功能強大的 HTML5 影片播放器。
  - **HLS.js**: 用於在瀏覽器中播放 HLS 串流。

## 部署方式

我們提供兩種部署方式：**Docker (推薦)** 和 **本地執行**。

### 1. Docker 部署 (推薦)

使用 Docker 是最簡單、最推薦的部署方式。

1.  **安裝 Docker**
    請確保您的系統已安裝 Docker 和 Docker Compose。

2.  **啟動服務**
    專案中已包含 `docker-compose.yml` 檔案。您只需在專案根目錄下執行以下命令：
    ```bash
    docker-compose up -d
    ```

### 3. 使用 Docker Hub Image 部署 (最快速)

如果您不想自己建置 (build) 映像檔，可以直接從 Docker Hub 拉取並執行。

1.  **拉取 Image**
    ```bash
    docker pull smp771007/maccms-parser:latest
    ```

2.  **執行容器**
    請執行以下指令來啟動容器。這個指令會將容器的 5000 連接埠映射到主機，並將本地的 `data` 資料夾掛載到容器中，以確保資料持久化。

    - **在 Linux 或 macOS 上:**
      ```bash
      docker run -d -p 5000:5000 -v $(pwd)/data:/app/data --name maccms-parser smp771007/maccms-parser:latest
      ```

    - **在 Windows (CMD) 上:**
      ```bash
      docker run -d -p 5000:5000 -v "%cd%/data":/app/data --name maccms-parser smp771007/maccms-parser:latest
      ```

### 2. 本地執行

適用於開發或不方便使用 Docker 的環境。

1.  **確保已安裝 Python**
    建議使用 Python 3.9 或更高版本。

2.  **安裝依賴**
    在專案根目錄下，執行以下命令安裝所有必要的套件：
    ```bash
    pip install -r requirements.txt
    ```

3.  **啟動應用程式**
    - **開發模式**:
      ```bash
      python web_app.py
      ```
    - **生產模式 (使用 Gunicorn)**:
      ```bash
      gunicorn --bind 0.0.0.0:5000 web_app:app
      ```

## 首次使用

1.  **啟動應用**
    無論使用何種方式部署，啟動成功後，請用瀏覽器訪問 `http://<您的伺服器IP>:5000`。

2.  **設定密碼**
    首次訪問時，系統會自動跳轉至設定頁面 (`/setup`)。請在此處設定您的管理員密碼。

3.  **登入系統**
    密碼設定成功後，頁面會跳轉至登入頁面 (`/login`)。請使用您剛設定的密碼登入。

4.  **開始使用**
    登入後，您就可以開始新增和管理您的影視資源站點了。

## 資料儲存

所有重要資料都儲存在專案根目錄的 `data/` 資料夾下：
- `data/config.json`: 存放系統設定，如 `secret_key` 和密碼雜湊。
- `data/sites.json`: 存放您新增的所有站點列表。

若使用 Docker 部署，該資料夾會被掛載到主機上，確保容器更新或重建後資料不會遺失。
