<div align="center">

# 🍿 MacCMS Parser

解析 MacCMS 影片的**網頁版工具** — 多站聚合搜尋、帳號系統、跨裝置（含 Android App）歷史 / 收藏同步<br>
自己架（Docker 一行搞定，也可上 Vercel），跟 Android 版 [咔滋影院 (kazi)](https://github.com/pp771007/kazi) 共用同一組帳號

<a href="https://hub.docker.com/r/smp771007/maccms-parser"><img src="https://img.shields.io/docker/pulls/smp771007/maccms-parser?logo=docker&logoColor=white&label=docker%20pulls&color=2496ED"></a> <a href="https://github.com/pp771007/maccms-parser/stargazers"><img src="https://img.shields.io/github/stars/pp771007/maccms-parser?logo=github&color=yellow"></a> <img src="https://img.shields.io/badge/Python-3.7%2B-3776AB?logo=python&logoColor=white"> <img src="https://img.shields.io/badge/Flask-backend-000000?logo=flask&logoColor=white">

</div>

---

## ⚠️ 免責聲明

- 本專案是一個**通用的 MacCMS 解析 / 播放網頁工具**，本身**不提供、不儲存、不內建任何影片內容或站台來源**。所有站台 URL 與影片內容皆由架設者 / 使用者自行提供與存取，與本專案及作者無關。
- 本專案僅供**個人學習、技術研究與合法用途**。架設者與使用者須自行確保所存取的內容來源合法，並遵守所在地區的法律與著作權規範。
- 作者**不對**透過本工具存取的任何第三方內容之合法性、正確性或可用性負責；因架設或使用本工具所衍生的任何爭議與法律責任，**由架設者 / 使用者自行承擔**。
- 若任何內容涉及侵權，請逕向該內容的**來源站台**反映，與本工具無關。
- **請勿**將本工具用於任何違法用途。部署 / 使用本工具，即視為您已閱讀並同意以上條款。

---

## ✨ 主要功能

| | |
|---|---|
| 🔍 **多站聚合搜尋** | 同時搜多個站、依片名自動聚合來源，可用分類瀏覽各站 |
| 🛠️ **智慧站點管理** | 健康檢查（全部 / 單站）、記住上次選的站、新增時自動防重複 URL |
| 🎬 **整合播放器** | 內建 Artplayer，多來源無縫切換，手機平板優化，支援 Chromecast |
| 🔐 **帳號系統** | 管理員 + 多組會員（家人各自密碼）；個人中心可改暱稱 / 密碼；登入防暴力破解、30 天免重登 |
| 🔄 **跨裝置同步** | 歷史 + 收藏綁帳號存伺服器，多裝置自動同步（含刪除同步）；跟 Android 版 kazi 共用帳號互通 |
| 📱 **響應式版面** | 依視窗寬度自動切換手機窄欄 / 桌機寬欄，站台 / 分類用橫向標籤列 |
| 📊 **批量更新檢查** | 一次檢查多部片有沒有新集數 |

---

## 🚀 快速開始

### 🐳 Docker（推薦，最省事）

```bash
docker run -d -p 5000:5000 -v ./maccms_data:/app/data --name maccms-parser smp771007/maccms-parser
```

| 參數 | 說明 |
|---|---|
| `-d` | 背景執行 |
| `-p 5000:5000` | 對外連接埠 |
| `-v ./maccms_data:/app/data` | 掛載資料夾，設定永久保存 |
| `--name maccms-parser` | 容器名稱 |

啟動後用瀏覽器開 `http://你的IP:5000` 即可。

### 🐍 手動安裝

需要 **Python 3.7+** 與 **Git**：

```bash
git clone https://github.com/pp771007/maccms-parser.git
cd maccms-parser
pip install -r requirements.txt
python web_app.py
```

開瀏覽器訪問 `http://127.0.0.1:5000`。

<details>
<summary><b>☁️ 部署到 Vercel（進階，需接 Upstash KV）</b></summary>

<br>

> 💡 想最省事直接用上面的 Docker：一行指令、資料存本機資料夾、不用設定任何環境變數。Vercel 是 serverless、檔案系統**唯讀**，必須額外連一個 KV 資料庫才能保存資料，步驟比較多。

Vercel 每次冷啟動可能換一台機器，資料（站點清單、密碼）**沒辦法存在本機檔案**，一定要接外部 KV（用免費的 Upstash Redis 即可）。沒接 KV 網站仍開得起來，但**新增站點、設定密碼都會失敗**。

**設定步驟（只需做一次）：**

1. **匯入專案**：把 repo 推到 GitHub，在 Vercel 點 **Add New → Project** 匯入
2. **連 KV 資料庫**：專案 → **Storage** → **Create Database** → **Upstash for Redis** → 建好按 **Connect** 連到專案。Vercel 會自動注入環境變數（名稱通常是 `KV_REST_API_URL` / `KV_REST_API_TOKEN`，舊版整合是 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`，**兩種命名程式都支援**）
3. **重新部署（最容易漏）**：環境變數只套用到「之後的新部署」→ **Deployments** → 最新那筆 **⋯** → **Redeploy**
4. 打開網址，第一次設定管理員密碼，之後操作跟本機版一樣

**可選：固定登入狀態** — 想讓登入在冷啟動後不失效，到 **Settings → Environment Variables** 加一個 `SECRET_KEY`（一串夠長的隨機字串，設了別再改）。連了 KV 後可省略。

| 變數 | 必填 | 說明 |
|---|---|---|
| `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` | Vercel 必須 | 連 KV 後自動帶入，二選一即可 |
| `KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` | Vercel 必須 | 連 KV 後自動帶入，二選一即可 |
| `SECRET_KEY` | 可選 | 固定 session 簽章金鑰，避免冷啟動後登入失效；連了 KV 可省略 |

> Docker / 本機沒有上述 KV 變數時，程式會自動沿用 `data/` 檔案儲存，行為不變。

**疑難排解：**

- **看到「尚未設定資料儲存」引導頁**：KV 沒連到，照步驟 2、3 連好並 **Redeploy**（這是引導頁不是錯誤）
- **每頁 `500: FUNCTION_INVOCATION_FAILED`**：到該 deployment 的 **Logs** 看實際 traceback
- **設定 KV 後仍進不去**：確認 KV 變數有出現在 **Settings → Environment Variables**，且**連完有 Redeploy**（環境變數只對新部署生效）

</details>

---

## 📝 使用說明

1. **首次設定**：第一次打開時設定管理員密碼
2. **新增站點**：首頁「站點管理」加入 MacCMS API 網址（自動防重複）
3. **多站找片**：可同時選多站一起搜，會顯示各站找片統計
4. **歷史 / 收藏**：看片自動記進度、可收藏，綁帳號跨裝置同步
5. **批量檢查**：歷史面板一次檢查多部片更新狀況
6. **會員管理**（管理員）：「會員」頁新增 / 編輯會員，給家人各自一組密碼
7. **個人中心**：頂列「個人」改自己的暱稱與密碼
8. **跟 App 同步**：在 [咔滋影院 (kazi)](https://github.com/pp771007/kazi) 的「設定 → 帳號同步」填這個網站的網址 + 密碼，歷史 / 收藏就會互通

---

## ➕ 站點怎麼來

本工具**不內建任何站台**。你需要自己提供 MacCMS 規格的 API URL（通常長得像 `https://example.com/api.php/provide/vod/`），在「站點管理」加入即可。

---

## 🛠️ 技術棧

- **後端**：Flask（Python）
- **前端**：原生 HTML / CSS / JavaScript（無框架）+ Artplayer 播放器
- **儲存**：本機 `data/` 檔案；Vercel 走 Upstash Redis KV
- **並行**：ThreadPoolExecutor 加速多站搜尋

<div align="center">
<br>
<sub>本專案為通用解析 / 播放工具，不提供任何影片內容；架設與使用請遵守當地法律與著作權規範。</sub>
</div>
