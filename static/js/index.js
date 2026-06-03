"use strict";

import state from './state.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { $ } from './utils.js';
import { showModal, showToast } from './modal.js';
import historyManager from './historyStateManager.js';
import { attachSwipePager } from './swipePager.js';
import { armConfirmDelete } from './confirmDelete.js';
import { readVideoParams, readListParams, writeListParams, listParamString } from './urlState.js';

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadSitesAndAutoLoadLast();
    registerServiceWorker();

    // 觀看歷史寫回伺服器的「保險」:每 60 秒、且真的有變動才寫(平時靠關閉播放器/換集寫)
    setInterval(() => state.flushWatchHistory(), 60000);
    // 關分頁前把尚未寫回的進度用 sendBeacon 送出(不阻塞關閉、不另開請求迴圈)
    window.addEventListener('beforeunload', () => {
        if (state._historyDirty && navigator.sendBeacon) {
            const canonical = state.watchHistory.map(it => state._historyToCanonical(it));
            const blob = new Blob([JSON.stringify(canonical)], { type: 'application/json' });
            navigator.sendBeacon('/api/history', blob);
            state._historyDirty = false;
        }
    });

    // 手機左右滑換頁:左滑下一頁、右滑上一頁(只攔觸控、只在水平為主時接管)
    attachSwipePager($('.content-area'), $('#videoGrid'), {
        canPrev: canGoPrev,
        canNext: canGoNext,
        onPrev: goPrev,
        onNext: goNext,
    });
});

// 版面（直/方/寬卡）改由 CSS 依裝置寬度自動決定，不再手動切換（對齊 kazi）。

// The popstate event is now handled by historyStateManager.js

// 處理 ESC 鍵的邏輯
function handleEscKey(e) {
    if (e.key !== 'Escape') return;

    // ArtPlayer fullscreen check
    if (state.artplayer && (state.artplayer.fullscreen || state.artplayer.fullscreenWeb)) {
        if (state.artplayer.fullscreen) {
            // Native fullscreen is handled by the browser
            return;
        }
        if (state.artplayer.fullscreenWeb) {
            state.artplayer.fullscreenWeb = false;
        }
        return;
    }

    // Close the most recent UI element from the history stack
    const currentState = historyManager.getCurrentState();
    if (currentState) {
        historyManager.back();
    }
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/static/sw.js').then(registration => {
                // ServiceWorker registered successfully
            }, err => {
                // ServiceWorker registration failed
            });
        });
    }
}

function setupEventListeners() {
    // 站台 / 分類 chip 列：事件委派，點到 chip 就切換
    $('#siteStrip').addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (chip) handleSiteSelection(chip.dataset.siteId);
    });
    $('#categoryStrip').addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (chip) handleCategorySelection(chip.dataset.typeId);
    });
    $('#searchBtn').addEventListener('click', handleSearch);
    $('#toSimpBtn').addEventListener('click', handleToSimp);
    // 左上角站名 / logo 點一下回首頁(清搜尋、回預設站台)
    const brand = $('.brand');
    if (brand) {
        brand.setAttribute('title', '回首頁');
        brand.addEventListener('click', goHome);
    }
    $('#searchInput').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    });

    // Video Modal
    $('#videoModal .close-btn').addEventListener('click', ui.closeModal);
    $('#videoModal').addEventListener('click', (e) => {
        if (e.target === $('#videoModal')) ui.closeModal();
    });

    // Copy title button
    $('#copyTitleBtn').addEventListener('click', handleCopyTitle);

    // Site Selection Modal
    $('#multiSiteSelectBtn').addEventListener('click', ui.openSiteSelectionModal);
    $('#siteSelectionModal .close-btn').addEventListener('click', ui.closeSiteSelectionModal);
    $('#siteSelectionModal').addEventListener('click', (e) => {
        if (e.target === $('#siteSelectionModal')) ui.closeSiteSelectionModal();
    });
    $('#selectAllSitesBtn').addEventListener('click', () => ui.toggleAllSites(true));
    $('#deselectAllSitesBtn').addEventListener('click', () => ui.toggleAllSites(false));
    $('#confirmSiteSelectionBtn').addEventListener('click', handleConfirmSiteSelection);

    // History Panel
    $('#historyBtn').addEventListener('click', ui.showHistoryPanel);
    $('#closeHistoryBtn').addEventListener('click', ui.hideHistoryPanel);
    $('#historyCloseBtn').addEventListener('click', ui.hideHistoryPanel);
    armConfirmDelete($('#clearHistoryBtn'), ui.clearAllHistory);
    $('#historyOverlay').addEventListener('click', ui.hideHistoryPanel);

    // Favorites
    $('#favoritesBtn').addEventListener('click', ui.showFavoritesPanel);
    $('#favoritesCloseBtn').addEventListener('click', ui.hideFavoritesPanel);
    $('#favoritesOverlay').addEventListener('click', ui.hideFavoritesPanel);
    $('#favoriteToggleBtn').addEventListener('click', ui.toggleCurrentFavorite);
    state.onPlaybackChange = ui.updateFavoriteButton; // 播放開始更新標題列星號

    // 添加 ESC 鍵處理邏輯
    document.addEventListener('keydown', handleEscKey);
    // ← / → 翻上一頁 / 下一頁
    document.addEventListener('keydown', handleArrowPaging);
    // 返回 / 前進鍵在清單狀態間導航(historyManager 已先處理彈窗層)
    window.addEventListener('popstate', handleListPopState);
}

// 某個彈窗 / 面板開著時(尤其影片播放器),不要讓左右鍵翻頁 → 交給播放器快進快退
function isAnyOverlayOpen() {
    return ['#videoModal', '#siteSelectionModal', '#historyPanel'].some(sel => {
        const el = $(sel);
        return el && getComputedStyle(el).display !== 'none';
    });
}

function scrollTopSmooth() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 重畫「目前資料頁」的顯示頁切片 + 雙層分頁列
function refreshView() {
    ui.renderVideos();
    ui.renderPager(PAGER_HANDLERS);
}

// 分頁列的按鈕行為:內層(顯示頁)純前端切片即時翻;外層(資料頁)向伺服器抓
const PAGER_HANDLERS = {
    innerPrev: () => { if (state.displayPage > 1) { state.displayPage--; scrollTopSmooth(); refreshView(); } },
    innerNext: () => { if (state.displayPage < state.innerPageCount) { state.displayPage++; scrollTopSmooth(); refreshView(); } },
    outerPrev: () => { if (state.currentPage > 1) { state.currentPage--; fetchAndRender(); } },
    outerNext: () => { if (state.currentPage < state.totalPages) { state.currentPage++; fetchAndRender(); } },
    outerJump: (p) => { state.currentPage = p; fetchAndRender(); },
};

// 合併翻頁(方向鍵 / 左右滑):顯示頁(內層)優先,翻完才換資料頁(外層)
function canGoPrev() { return state.displayPage > 1 || state.currentPage > 1; }
function canGoNext() { return state.displayPage < state.innerPageCount || state.currentPage < state.totalPages; }
function goPrev() {
    if (state.displayPage > 1) { state.displayPage--; scrollTopSmooth(); refreshView(); }
    else if (state.currentPage > 1) { state._pendingDisplayLast = true; state.currentPage--; fetchAndRender(); }
}
function goNext() {
    if (state.displayPage < state.innerPageCount) { state.displayPage++; scrollTopSmooth(); refreshView(); }
    else if (state.currentPage < state.totalPages) { state.currentPage++; fetchAndRender(); }
}

function handleArrowPaging(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // 播放器 / 彈窗開著 → 左右鍵歸播放器(快進快退),外面不翻頁
    if (isAnyOverlayOpen()) return;
    // 在輸入框打字時左右鍵要移游標,不攔
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (e.key === 'ArrowLeft') { if (canGoPrev()) goPrev(); }
    else if (canGoNext()) goNext();
}

let t2s; // 儲存轉換函數

// 處理複製標題功能
async function handleCopyTitle() {
    try {
        const titleTextElement = $('.title-text');
        if (!titleTextElement) {
            showToast('無法找到標題元素', 'error');
            return;
        }

        const titleText = titleTextElement.textContent.trim();
        if (!titleText) {
            showToast('標題為空，無法複製', 'warning');
            return;
        }

        // 使用現代 Clipboard API
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(titleText);
            showToast('標題已複製到剪貼簿', 'success');
        } else {
            // 降級處理：使用傳統方法
            const textArea = document.createElement('textarea');
            textArea.value = titleText;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();

            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    showToast('標題已複製到剪貼簿', 'success');
                } else {
                    showToast('複製失敗，請手動選擇並複製', 'error');
                }
            } catch (err) {
                console.error('複製失敗:', err);
                showToast('複製失敗，請手動選擇並複製', 'error');
            }

            document.body.removeChild(textArea);
        }
    } catch (err) {
        console.error('複製標題時發生錯誤:', err);
        showToast('複製失敗，請稍後再試', 'error');
    }
}

async function handleToSimp() {
    const searchInput = $('#searchInput');
    if (!t2s) {
        try {
            const module = await import('https://cdn.jsdelivr.net/npm/chinese-s2t@1.0.0/+esm');
            t2s = module.t2s;
        } catch (error) {
            console.error('無法載入簡繁轉換模組:', error);
            showModal('無法載入簡繁轉換功能，請檢查網絡連線。', 'error');
            return;
        }
    }
    searchInput.value = t2s(searchInput.value);
    showToast('已轉換為簡體中文。', 'success');
}

async function loadSitesAndAutoLoadLast() {
    try {
        const sites = await api.fetchSites();

        // 過濾掉無效的站台（沒有 id 或 name 的站台）
        state.sites = sites.filter(site => site && site.id && site.name && site.url);



        ui.renderSites(state.sites);

        // 載入多選站台設定
        state.loadMultiSiteSelection();

        // 載入觀看歷史 + 收藏(從伺服器,綁帳號,跟 kazi 共用)
        await state.loadWatchHistory();
        await state.loadFavorites();

        // 載入搜尋關鍵字歷史記錄
        state.loadSearchHistory();

        // 渲染搜尋標籤
        ui.renderSearchTags();

        sessionStorage.removeItem('fromOtherPage');

        // 網址帶清單狀態(分享 / 重新整理)→ 優先照網址還原;還原不了再走預設
        const listParams = readListParams();
        if (listParams && restoreListFromUrl(listParams)) {
            // 已照網址還原清單
        } else if (state.searchSiteIds.length > 0) {
            // 有多站搜尋設定 → 維持多站模式
            ui.updateSelectedSitesDisplay();
        } else {
            loadDefaultSite();
        }

        // 網址帶影片深連結(分享 / 書籤)→ 在背景清單之上直接開那部片、跳到指定來源與集
        const videoParams = readVideoParams();
        if (videoParams) {
            ui.openVideoFromUrl(videoParams);
        }
    } catch (err) {
        if (err.action === 'setup_password') {
            window.location.href = '/setup-password';
        } else if (err.action === 'login') {
            window.location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
        } else {
            ui.showError(err.message || '發生未知錯誤');
        }
    }
}


function handleSiteSelection(siteId, urlMode = 'auto') {
    if (!siteId) return;
    const site = state.sites.find(s => s.id == siteId);
    if (!site) return;

    // 切到單站瀏覽模式，清掉多選站台設定
    state.searchSiteIds = [];
    state.saveMultiSiteSelection();
    ui.updateSelectedSitesDisplay();

    localStorage.setItem('lastSelectedSiteId', siteId);
    state.currentSite = site;
    state.currentPage = 1;
    state.currentTypeId = null;
    state.currentKeyword = null;
    state.categories = [];
    ui.setActiveSiteChip(siteId);
    ui.updateSearchBox(null);
    fetchAndRender(urlMode);
}

function handleConfirmSiteSelection() {
    const selectedIds = ui.getSelectedSiteIds();
    if (selectedIds.length === 0) {
        showModal('請至少選擇一個站台。', 'warning');
        return;
    }
    state.searchSiteIds = selectedIds;
    // 儲存多選站台設定
    state.saveMultiSiteSelection();

    // Set currentSite to null to indicate multi-site search mode
    state.currentSite = null;
    ui.setActiveSiteChip(null); // 多站搜尋時不高亮任何單一站台
    ui.updateSelectedSitesDisplay();
    ui.closeSiteSelectionModal();
    // Optional: trigger a search immediately after confirming
    // handleSearch(); 
}

function handleSearch() {
    const keyword = $('#searchInput').value.trim();

    state.currentTypeId = null;
    state.currentPage = 1;
    state.currentKeyword = keyword;

    // 記錄搜尋關鍵字到歷史記錄
    if (keyword) {
        state.addSearchKeyword(keyword);
        ui.renderSearchTags();
    }

    // If no multi-selection is active, use the currently selected single site
    if (state.searchSiteIds.length === 0 && state.currentSite) {
        state.searchSiteIds = [state.currentSite.id];
    } else if (state.searchSiteIds.length === 0 && !state.currentSite) {
        showModal('請先選擇一個或多個站台進行搜尋。', 'warning');
        return;
    }

    fetchAndRender();
}

function handleCategorySelection(rawTypeId) {
    const normalized = (rawTypeId === 'all' || rawTypeId == null) ? null : rawTypeId;
    if (normalized !== state.currentTypeId || state.currentKeyword) {
        state.currentKeyword = null;
        state.currentTypeId = normalized;
        state.currentPage = 1;
        ui.updateSearchBox(null);
        fetchAndRender();
    }
}

async function fetchAndRender(urlMode = 'auto') {
    const isMultiSiteSearch = state.searchSiteIds.length > 0;

    if (!state.currentSite && !isMultiSiteSearch) return;

    window.scrollTo({ top: 0, behavior: 'smooth' });

    ui.showLoader(true);
    ui.showError(null);
    $('#videoGrid').innerHTML = '';
    $('#pagination').innerHTML = '';

    if (state.categories.length === 0) {
        ui.renderCategories([]);
    }

    try {
        let result;
        if (isMultiSiteSearch) {
            result = await api.fetchMultiSiteVideoList(
                state.searchSiteIds,
                state.currentPage,
                state.currentKeyword
            );



            // In multi-site search, categories are disabled.
            state.categories = [];
            ui.renderCategories([]);
        } else {
            result = await api.fetchVideoList(
                state.currentSite.url,
                state.currentPage,
                state.currentKeyword ? null : state.currentTypeId,
                state.currentKeyword
            );
        }

        state.videos = result.list;
        state.currentPage = Number(result.page);
        state.totalPages = Number(result.pagecount);

        // 聚合 + 切顯示頁(雙層分頁的內層)
        state.aggregated = ui.aggregateVideos(state.videos);
        state.innerPageCount = Math.max(1, Math.ceil(state.aggregated.length / ui.INNER_PAGE_SIZE));
        // 一般跳到第 1 個顯示頁;若是「往前跨資料頁」則停在最後一個顯示頁(連續往回)
        state.displayPage = state._pendingDisplayLast ? state.innerPageCount : 1;
        state._pendingDisplayLast = false;

        if (!isMultiSiteSearch && result.class && result.class.length > 0) {
            state.categories = result.class;
            ui.renderCategories(state.categories);
        } else if (!isMultiSiteSearch && state.categories.length === 0) {
            ui.renderCategories([]);
        }

        refreshView();
        ui.updateSearchBox(state.currentKeyword);
        syncListUrl(urlMode);

    } catch (err) {
        if (err.action === 'setup_password') {
            window.location.href = '/setup-password';
        } else if (err.action === 'login') {
            window.location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
        } else {
            ui.showError(err.message || '發生未知錯誤');
        }
    } finally {
        ui.showLoader(false);
    }
}

// 第一次渲染清單時用 replace 建立「基準」歷史,之後的清單變動 push 新歷史(讓返回鍵可回上一個清單)。
let listUrlInitialized = false;
// 目前顯示中的清單對應的網址清單參數;popstate 時拿來判斷「清單真的變了才重抓」。
let currentListKey = '';

// 把目前清單狀態(搜尋 / 站台 / 分類 / 頁碼)同步到網址。影片參數由 urlState 保留不動。
// urlMode: 'auto' 首次 replace、之後 push;'replace' 一律取代;'none' 不寫(popstate 還原時網址已是目標)。
function syncListUrl(urlMode) {
    if (urlMode === 'none') { currentListKey = listParamString(); return; }
    const opts = {
        keyword: state.currentKeyword,
        sites: state.searchSiteIds.map(id => state.sites.find(s => s.id === id)?.name).filter(Boolean),
        site: state.currentSite?.name,
        cat: state.currentTypeId,
        page: state.currentPage,
    };
    if (urlMode === 'replace' || !listUrlInitialized) {
        writeListParams(opts, false);
        listUrlInitialized = true;
    } else {
        writeListParams(opts, true);
    }
    currentListKey = listParamString();
}

// 回首頁:清掉搜尋 / 分類,回到預設站台(等同剛進站)。當作一次清單導航 → 返回鍵可回到原本的頁。
function goHome() {
    state.searchSiteIds = [];
    state.saveMultiSiteSelection();
    state.currentKeyword = null;
    state.currentTypeId = null;
    ui.updateSearchBox(null);
    ui.updateSelectedSitesDisplay();
    loadDefaultSite();
}

// 自動載入「上次選的站台」,沒有的話載第一個站台(對齊 kazi,畫面不空白)。
function loadDefaultSite(urlMode = 'auto') {
    const lastSelectedId = localStorage.getItem('lastSelectedSiteId');
    const target = (lastSelectedId && state.sites.some(s => s.id == lastSelectedId))
        ? lastSelectedId
        : (state.sites[0] && String(state.sites[0].id));
    if (target) handleSiteSelection(String(target), urlMode);
}

// 返回 / 前進鍵:彈窗還開著就交給 historyManager 關彈窗;否則清單參數變了才重抓還原。
function handleListPopState() {
    if (historyManager.getCurrentState()) return; // 彈窗 / 面板層,不是清單導航
    const newKey = listParamString();
    if (newKey === currentListKey) return; // 清單沒變(例如剛關掉影片彈窗)
    const lp = readListParams();
    if (lp) restoreListFromUrl(lp, 'none');
    else loadDefaultSite('none');
}

// 依網址清單參數還原狀態並抓資料。站台 / 影片在清單裡找不到就回 false,交回預設邏輯。
function restoreListFromUrl(lp, urlMode = 'auto') {
    if (lp.q) {
        // 站名優先比對,找不到再試 id(相容舊的數字網址)
        const matched = lp.sites
            .map(key => state.sites.find(s => s.name === key) || state.sites.find(s => String(s.id) === key))
            .filter(Boolean);
        if (matched.length === 0) return false;
        state.searchSiteIds = matched.map(s => s.id);
        state.saveMultiSiteSelection();
        state.currentSite = matched.length === 1 ? matched[0] : null;
        state.currentKeyword = lp.q;
        state.currentTypeId = null;
        state.currentPage = lp.page;
        ui.setActiveSiteChip(state.currentSite ? state.currentSite.id : null);
        ui.updateSearchBox(lp.q);
        ui.updateSelectedSitesDisplay();
        fetchAndRender(urlMode);
        return true;
    }
    if (lp.site) {
        const site = state.sites.find(s => s.name === lp.site)
            || state.sites.find(s => String(s.id) === String(lp.site));
        if (!site) return false;
        state.searchSiteIds = [];
        state.saveMultiSiteSelection();
        state.currentSite = site;
        state.currentKeyword = null;
        state.currentTypeId = lp.cat || null;
        state.currentPage = lp.page;
        localStorage.setItem('lastSelectedSiteId', site.id);
        ui.setActiveSiteChip(site.id);
        ui.updateSearchBox(null);
        ui.updateSelectedSitesDisplay();
        fetchAndRender(urlMode);
        return true;
    }
    return false;
}
