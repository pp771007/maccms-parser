# maccms-parser 開發筆記

## 本機自動化測試（免真實密碼、免真實站台）

整站是會員制、所有頁面與 `/api/*` 都要登入(`blueprints/auth.py` 的 `require_login`)。
要用 Playwright 自動化測試又不想動到使用者真實密碼,流程如下:

1. **起 dev server**(port 5000,本機):
   ```
   .venv/Scripts/python.exe web_app.py
   ```

2. **簽一張合法的 session cookie**(用 app 自己的 `secret_key`,不需也不會改到使用者密碼)。
   `secret_key` 存在 `data/config.json`(已 gitignore),所以下面這段在本機跑就會用同一把金鑰簽:
   ```
   .venv/Scripts/python.exe -c "from web_app import app; s=app.session_interface.get_signing_serializer(app); print(s.dumps({'logged_in':True,'role':'admin','account_id':'admin','accounts':[{'account_id':'admin','role':'admin'}]}))"
   ```
   輸出就是 cookie 值。**不要把這個值寫死進任何檔案**——每次測試現簽即可(它綁定本機 secret_key)。

3. **Playwright 注入 cookie + 攔截 API 回模擬資料**(session cookie 是 HttpOnly,只能用 `addCookies`,不能用 `document.cookie`):
   ```js
   await page.context().addCookies([{ name: 'session', value: '<步驟2輸出>', url: 'http://127.0.0.1:5000' }]);
   await page.route('**/api/**', async (route) => {
     const u = route.request().url();
     let body;
     if (u.includes('/api/sites'))  body = [{ id:'testsite', name:'測試站', url:'http://mock.test/api/', enabled:true }];
     else if (u.includes('/api/list')) body = { status:'success', list:[{ vod_id:'999', vod_name:'測試影片' }], page:1, pagecount:1, class:[] };
     else if (u.includes('/api/multi_site_search')) body = { status:'success', list:[{ vod_id:'999', vod_name:'測試影片', from_site_id:'testsite', from_site:'測試站' }], pagecount:1 };
     else if (u.includes('/api/details')) body = { status:'success', vod_name:'測試影片', vod_pic:'', data:[
       { flag:'線路A', episodes:[{name:'第1集',url:'http://mock.test/a/1.m3u8'},{name:'第2集',url:'http://mock.test/a/2.m3u8'}] },
       { flag:'線路B', episodes:[{name:'第1集',url:'http://mock.test/b/1.m3u8'}] },
     ] };
     else if (u.includes('history') || u.includes('favorit')) body = [];
     else body = { status:'success' };
     await route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(body) });
   });
   await page.route('**/*.m3u8', r => r.abort()); // 別讓 hls 真的去連模擬網址
   ```

關鍵格式備忘:
- `/api/details` 回 `{ status, vod_name, vod_pic, data:[{flag, episodes:[{name,url}]}] }`。
  `data` 是「播放來源 / 線路」陣列,每個來源各自一份 `episodes`(對應 MacCMS 的 `vod_play_from`/`vod_play_url` 用 `$$$` 拆)。
- `/api/list` 回 `{ status, list:[影片], page, pagecount, class:[分類] }`;影片至少要 `vod_id`/`vod_name`。
- 注意 console 的 `URL is not defined`:`browser_run_code_unsafe` 的執行環境沒有全域 `URL`,用字串 `includes` 判斷路徑,別 `new URL()`。
- 編輯 JS 後測試網址加 `&_=Date.now()` 當 cache-buster,確保拿到最新檔。

## 網址路由 scheme(`static/js/urlState.js`)

開影片 / 瀏覽狀態都反映到網址,可複製分享、重新整理還原。沒登入開分享連結會先導去登入、登入後跳回(`auth.py` 的 `next`,只收站內相對路徑)。

- 影片深連結:`vsite`(站台id) `v`(vod_id) `src`(來源索引) `ep`(集索引)
- 瀏覽清單:`site`(站台id) `cat`(分類) `page`(資料頁) `q`(關鍵字) `sites`(多站搜尋,逗號清單)

影片參數與清單參數互不覆蓋(各自只動自己那組 key)。寫網址:影片參數一律 `replaceState`;清單變動(切站/搜尋/分類/翻頁)用 `pushState` 建立瀏覽器歷史,讓返回/前進鍵能在清單狀態間導航(`index.js` 的 `syncListUrl` urlMode:首次 replace、之後 push、popstate 還原用 none)。

返回鍵協作:彈窗/面板(影片、歷史、收藏、多站選擇)的 popstate 由 `historyStateManager` 處理(關閉);`index.js` 的 `handleListPopState` 只在「沒有彈窗層 + 網址清單參數真的變了」時重抓還原清單,所以「返回關彈窗」不會誤觸清單重抓。
