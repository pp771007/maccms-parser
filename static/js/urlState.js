"use strict";

// 把「目前在看哪部片 / 哪個來源 / 第幾集」反映到網址,讓使用者複製網址當書籤、貼上接著看。
// 影片用獨立參數 (vsite/v/src/ep),跟瀏覽清單的 site 參數分開,避免同一部片來源在別站時撞名。
// 寫網址一律用 replaceState:開影片本身已經由 historyStateManager 推一筆歷史,這裡只更新該筆的網址。

// 影片深連結參數
export const PARAM_VIDEO_SITE = 'vsite'; // 影片所在站台 id
export const PARAM_VIDEO_ID = 'v';       // vod_id
export const PARAM_SOURCE = 'src';       // 來源(線路)索引
export const PARAM_EPISODE = 'ep';       // 集數索引

const VIDEO_PARAMS = [PARAM_VIDEO_SITE, PARAM_VIDEO_ID, PARAM_SOURCE, PARAM_EPISODE];

// 瀏覽清單參數
export const PARAM_SITE = 'site';   // 單站瀏覽:站台 id
export const PARAM_CATEGORY = 'cat'; // 分類 type id
export const PARAM_PAGE = 'page';    // 資料頁(外層)頁碼
export const PARAM_QUERY = 'q';      // 搜尋關鍵字
export const PARAM_SITES = 'sites';  // 多站搜尋:站台 id 逗號清單

const LIST_PARAMS = [PARAM_SITE, PARAM_CATEGORY, PARAM_PAGE, PARAM_QUERY, PARAM_SITES];

// 讀網址的清單狀態。無任何清單參數回 null(交給預設「上次站台」邏輯)。
export function readListParams() {
    const p = new URLSearchParams(window.location.search);
    if (!LIST_PARAMS.some(k => p.has(k))) return null;
    const sitesRaw = p.get(PARAM_SITES);
    return {
        siteId: p.get(PARAM_SITE),
        cat: p.get(PARAM_CATEGORY),
        page: parsePage(p.get(PARAM_PAGE)),
        q: p.get(PARAM_QUERY),
        siteIds: sitesRaw ? sitesRaw.split(',').filter(Boolean) : [],
    };
}

// 把目前清單狀態寫進網址(保留影片參數)。搜尋模式寫 q+sites;瀏覽模式寫 site(+cat)。
export function writeListParams({ keyword, siteIds, siteId, cat, page }) {
    const p = new URLSearchParams(window.location.search);
    for (const k of LIST_PARAMS) p.delete(k);

    if (keyword) {
        p.set(PARAM_QUERY, keyword);
        if (siteIds && siteIds.length) p.set(PARAM_SITES, siteIds.join(','));
    } else if (siteId != null) {
        p.set(PARAM_SITE, String(siteId));
        if (cat != null && cat !== '') p.set(PARAM_CATEGORY, String(cat));
    }
    if (page && page > 1) p.set(PARAM_PAGE, String(page));

    replaceQuery(p);
}

function parsePage(raw) {
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n >= 1 ? n : 1;
}

// 讀網址裡的影片深連結;沒有 vsite/v 就回 null。src/ep 預設 0。
export function readVideoParams() {
    const p = new URLSearchParams(window.location.search);
    const siteId = p.get(PARAM_VIDEO_SITE);
    const vodId = p.get(PARAM_VIDEO_ID);
    if (!siteId || !vodId) return null;
    return {
        siteId,
        vodId,
        src: parseIndex(p.get(PARAM_SOURCE)),
        ep: parseIndex(p.get(PARAM_EPISODE)),
    };
}

// 把目前看的影片寫進網址(保留其他既有參數)。
export function writeVideoParams({ siteId, vodId, src, ep }) {
    if (siteId == null || vodId == null) return;
    const p = new URLSearchParams(window.location.search);
    p.set(PARAM_VIDEO_SITE, String(siteId));
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

function replaceQuery(params) {
    const qs = params.toString();
    const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState(window.history.state, '', url);
}
