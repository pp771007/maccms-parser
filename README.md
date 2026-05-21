# MacCMS Parser

一個專門解析MacCMS系統影片的網路工具，支援多站點聚合搜尋、智慧站點管理還有畫面模式的切換。

[![Docker Hub](https://img.shields.io/docker/pulls/smp771007/maccms-parser.svg)](https://hub.docker.com/r/smp771007/maccms-parser)
[![GitHub Stars](https://img.shields.io/github/stars/pp771007/maccms_parser.svg)](https://github.com/pp771007/maccms_parser/stargazers)
[![GitHub license](https://img.shields.io/github/license/pp771007/maccms_parser.svg)](https://github.com/pp771007/maccms_parser/blob/main/LICENSE)

## ✨ 主要功能

### 🔍 多站點聚合搜尋

- 可以同時找很多個網站的影片
- 會自動把相同名稱的影片集合在一起
- 支援用分類來查看各個網站的影片

### 🛠️ 智慧站點管理

- **健康檢查**：可以手動檢查網站能不能用
- **單站點檢查**：可以檢查指定網站的狀況
- **站點選擇記憶**：會記住你上次選的單選或多選網站

### 🎬 整合播放器

- 內建了Artplayer播放器
- 支援在不同來源間無縫切換
- 針對手機平板特別優化

### 🔐 安全認證

- 用密碼保護管理界面
- 30天內不用重新登入
- 會保存你的搜尋記錄

### 📱 視圖模式切換

- **三種畫面模式**：直立式(縱向)、橫躺式(橫向)和方形
- 可以個人化設定畫面偏好
- 會記住你選擇的模式

### 📊 增強功能

- **批量歷史檢查**：檢查多個影片的更新狀態
- **防止重複站點**：新增站點時自動檢查URL是否已存在
- **增強錯誤處理**：提供更詳細的錯誤信息和更好的異常處理

## 🚀 快速開始

### 用Docker裝（推薦）

```bash
docker run -d -p 5000:5000 -v ./maccms_data:/app/data --name maccms-parser smp771007/maccms-parser
```

**參數說明：**

- `-d`：背景執行，不會佔用命令視窗
- `-p 5000:5000`：把主機的5000連接埠接起來給容器用
- `-v ./maccms_data:/app/data`：掛接資料夾，設定會永久保存
- `--name maccms-parser`：給容器取個名字叫maccms-parser

啟動好後，用瀏覽器開`http://你的IP:5000`就行了

### 手動安裝

**環境需求：**

- Python 3.7版以上
- Git

**安裝步驟：**

1. 下載專案

   ```bash
   git clone https://github.com/pp771007/maccms_parser.git
   cd maccms_parser
   ```

2. 安裝需要的套件

   ```bash
   pip install -r requirements.txt
   ```

3. 啟動應用程式

   ```bash
   python web_app.py
   ```

4. 打開瀏覽器訪問：`http://127.0.0.1:5000`

### 部署到 Vercel（進階）

> 💡 **想最省事的話直接用上面的 Docker**：一行指令、資料存本機資料夾、不用設定任何環境變數。Vercel 是 serverless，必須額外連一個資料庫才能保存資料（見下方說明），步驟比較多。

Vercel 的檔案系統是**唯讀的**，而且每次冷啟動可能換一台機器，所以資料（站點清單、密碼）**沒辦法存在本機檔案**，一定要接一個外部 KV 資料庫（用免費的 Upstash Redis 即可）。沒接 KV 的話，網站仍開得起來，但**新增站點、設定密碼都會失敗**。

**設定步驟（只需做一次）：**

1. **匯入專案**：把這個 repo 推到 GitHub，在 Vercel 點 **Add New → Project** 匯入。
2. **連 KV 資料庫**：進專案 → **Storage** 分頁 → **Create Database** → 選 **Upstash for Redis** → 建好後按 **Connect** 連到這個專案。連結後 Vercel 會自動注入連線用的環境變數（名稱通常是 `KV_REST_API_URL` / `KV_REST_API_TOKEN`，舊版整合則是 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`）—— **兩種命名程式都支援，不用自己手動加。**
3. **重新部署（關鍵步驟，最容易漏）**：環境變數只會套用到「之後的新部署」。連完 KV 後，到 **Deployments** → 最新那筆右邊 **⋯** → **Redeploy**，舊的部署不會自動帶到新變數。
4. 打開網址，第一次會要你設定管理員密碼，之後操作就和本機版一樣。

**可選：固定登入狀態**

不設也能用。若想讓登入在冷啟動後不要失效，到 **Settings → Environment Variables** 加一個 `SECRET_KEY`，值填一串夠長的隨機字串（設定後別再改，改了大家會被登出）。連了 KV 之後其實可省略（金鑰會存進 KV）。

**環境變數一覽：**

| 變數 | 必填 | 說明 |
|------|------|------|
| `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` | Vercel 必須 | 連結 Upstash KV 後自動帶入，二選一即可 |
| `KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` | Vercel 必須 | 連結 Upstash KV 後自動帶入，二選一即可 |
| `SECRET_KEY` | 可選 | 固定 session 簽章金鑰，避免冷啟動後登入失效；連了 KV 可省略 |

> Docker / 本機沒有上述 KV 變數時，程式會自動沿用 `data/` 檔案儲存，行為不變。

**疑難排解：**

- **每個頁面都 `500: FUNCTION_INVOCATION_FAILED`**：幾乎都是「KV 沒連」或「連了但沒重新部署」。照上面第 2、3 步把 KV 連好並 **Redeploy**。
- **網站開得起來，但新增站點 / 設密碼時報「資料寫入失敗」**：同樣是 KV 沒接到，程式抓不到 KV 變數，請確認第 2 步的環境變數有出現在 **Settings → Environment Variables**，且已 Redeploy。

## 📝 使用說明

1. **首次設定**：第一次打開時，系統會叫你設定管理員密碼
2. **新增站點**：進到首頁後，按「站點管理」按鈕，把資源站點的API地址加進去（系統會自動檢查不要重複加）
3. **畫面模式**：用畫面模式按鈕切換直立式、橫躺式或方形，設定會自動存起來
4. **多站點找片**：可以同時選好幾個網站一起找片，還能看到各個網站的找片統計
5. **歷史檢查**：在歷史面板裡，一次檢查多部片的更新狀況
6. **開始用**：加好站點之後，就可以開始找片、看片了

## 🛠️ 技術棧

- **後端**：Flask
- **前端**：HTML, CSS, JavaScript (無框架)
- **並行處理**：ThreadPoolExecutor 用於加速多站點搜尋
