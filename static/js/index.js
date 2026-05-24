"use strict";

import state from './state.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { $ } from './utils.js';
import { showModal, showToast } from './modal.js';
import historyManager from './historyStateManager.js';
import { attachSwipePager } from './swipePager.js';
import { armConfirmDelete } from './confirmDelete.js';

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

        // 載入並顯示目前登入帳號(讓使用者確認登在哪個帳號,跟 kazi 同步對得起來)
        await state.loadAccount();
        ui.renderAccountNickname();

        // 載入搜尋關鍵字歷史記錄
        state.loadSearchHistory();

        // 渲染搜尋標籤
        ui.renderSearchTags();

        sessionStorage.removeItem('fromOtherPage');

        if (state.searchSiteIds.length > 0) {
            // 有多站搜尋設定 → 維持多站模式
            ui.updateSelectedSitesDisplay();
        } else {
            // 否則自動載入「上次選的站台」，沒有的話就載入第一個站台（對齊 kazi，畫面不再空白）
            const lastSelectedId = localStorage.getItem('lastSelectedSiteId');
            const target = (lastSelectedId && state.sites.some(s => s.id == lastSelectedId))
                ? lastSelectedId
                : (state.sites[0] && String(state.sites[0].id));
            if (target) handleSiteSelection(String(target));
        }
    } catch (err) {
        if (err.action === 'setup_password') {
            window.location.href = '/setup-password';
        } else if (err.action === 'login') {
            window.location.href = '/login';
        } else {
            ui.showError(err.message || '發生未知錯誤');
        }
    }
}


function handleSiteSelection(siteId) {
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
    fetchAndRender();
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

async function fetchAndRender() {
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

    } catch (err) {
        if (err.action === 'setup_password') {
            window.location.href = '/setup-password';
        } else if (err.action === 'login') {
            window.location.href = '/login';
        } else {
            ui.showError(err.message || '發生未知錯誤');
        }
    } finally {
        ui.showLoader(false);
    }
}
