"use strict";

// 把「目前在看哪部片 / 哪個來源 / 第幾集」反映到網址,讓使用者複製網址當書籤、貼上接著看。
// 影片用獨立參數 (vsite/v/src/ep),跟瀏覽清單的 site 參數分開,避免同一部片來源在別站時撞名。
// 寫網址一律用 replaceState:開影片本身已經由 historyStateManager 推一筆歷史,這裡只更新該筆的網址。

// 影片深連結參數
export const PARAM_VIDEO_SITE = 'vsite'; // 影片所在站台(站名,較好讀;解析端站名優先、找不到再試 id)
export const PARAM_VIDEO_ID = 'v';       // vod_id
export const PARAM_SOURCE = 'src';       // 來源(線路)索引
export const PARAM_EPISODE = 'ep';       // 集數索引

const VIDEO_PARAMS = [PARAM_VIDEO_SITE, PARAM_VIDEO_ID, PARAM_SOURCE, PARAM_EPISODE];

// 瀏覽清單參數
export const PARAM_SITE = 'site';   // 單站瀏覽:站名
export const PARAM_CATEGORY = 'cat'; // 分類 type id
export const PARAM_PAGE = 'page';    // 資料頁(外層)頁碼
export const PARAM_QUERY = 'q';      // 搜尋關鍵字
export const PARAM_SITES = 'sites';  // 多站搜尋:站名逗號清單

const LIST_PARAMS = [PARAM_SITE, PARAM_CATEGORY, PARAM_PAGE, PARAM_QUERY, PARAM_SITES];

// 讀網址的清單狀態。無任何清單參數回 null(交給預設「上次站台」邏輯)。
// site / sites 放的是「站名」(較好讀);解析端站名優先、找不到再試 id(舊數字網址仍可開)。
export function readListParams() {
    const p = new URLSearchParams(window.location.search);
    if (!LIST_PARAMS.some(k => p.has(k))) return null;
    const sitesRaw = p.get(PARAM_SITES);
    return {
        site: p.get(PARAM_SITE),
        cat: p.get(PARAM_CATEGORY),
        page: parsePage(p.get(PARAM_PAGE)),
        q: p.get(PARAM_QUERY),
        sites: sitesRaw ? sitesRaw.split(',').filter(Boolean) : [],
    };
}

// 把目前清單狀態寫進網址(保留影片參數)。搜尋模式寫 q+sites;瀏覽模式寫 site(+cat)。
// site / sites 傳「站名」。push=true 推一筆新瀏覽器歷史(返回鍵可回上一個清單);否則原地取代。
export function writeListParams({ keyword, sites, site, cat, page }, push = false) {
    const p = new URLSearchParams(window.location.search);
    for (const k of LIST_PARAMS) p.delete(k);

    if (keyword) {
        p.set(PARAM_QUERY, keyword);
        if (sites && sites.length) p.set(PARAM_SITES, sites.join(','));
    } else if (site != null && site !== '') {
        p.set(PARAM_SITE, String(site));
        if (cat != null && cat !== '') p.set(PARAM_CATEGORY, String(cat));
    }
    if (page && page > 1) p.set(PARAM_PAGE, String(page));

    if (push) pushQuery(p); else replaceQuery(p);
}

// 目前網址的「清單參數」字串(順序固定 → 可拿來比對清單狀態是否變了)。
export function listParamString() {
    const p = new URLSearchParams(window.location.search);
    return LIST_PARAMS.filter(k => p.has(k)).map(k => `${k}=${p.get(k)}`).join('&');
}

function parsePage(raw) {
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n >= 1 ? n : 1;
}

// 讀網址裡的影片深連結;沒有 vsite/v 就回 null。src/ep 預設 0。site 放站名。
export function readVideoParams() {
    const p = new URLSearchParams(window.location.search);
    const site = p.get(PARAM_VIDEO_SITE);
    const vodId = p.get(PARAM_VIDEO_ID);
    if (!site || !vodId) return null;
    return {
        site,
        vodId,
        src: parseIndex(p.get(PARAM_SOURCE)),
        ep: parseIndex(p.get(PARAM_EPISODE)),
    };
}

// 把目前看的影片寫進網址(保留其他既有參數)。site 傳站名。
export function writeVideoParams({ site, vodId, src, ep }) {
    if (site == null || vodId == null) return;
    const p = new URLSearchParams(window.location.search);
    p.set(PARAM_VIDEO_SITE, String(site));
    p.set(PARAM_VIDEO_ID, String(vodId));
    p.set(PARAM_SOURCE, String(src ?? 0));
    p.set(PARAM_EPISODE, String(ep ?? 0));
    replaceQuery(p);
}

// 關閉影片時把影片相關參數從網址移掉(其他參數保留)。
export function clearVideoParams() {
    const p = new URLSearchParams(window.location.search);
    let changed = false;
    for (const key of VIDEO_PARAMS) {
        if (p.has(key)) { p.delete(key); changed = true; }
    }
    if (changed) replaceQuery(p);
}

function parseIndex(raw) {
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
}

function buildUrl(params) {
    const qs = params.toString();
    return window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
}

function replaceQuery(params) {
    window.history.replaceState(window.history.state, '', buildUrl(params));
}

// 推一筆帶標記的歷史(標記讓 historyStateManager 的 popstate 處理器知道這不是它管的彈窗層)
function pushQuery(params) {
    window.history.pushState({ listNav: true }, '', buildUrl(params));
}
