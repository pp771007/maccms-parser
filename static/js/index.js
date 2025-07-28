"use strict";

import state from './state.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { $ } from './utils.js';
import { showModal } from './modal.js';

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadSitesAndAutoLoadLast();
    registerServiceWorker();
});

// 監聽瀏覽器的返回按鈕事件，處理 modal 和面板的關閉
window.addEventListener('popstate', (e) => {
    // 按照優先級順序處理：modal > 歷史面板
    // 1. 如果是videoModal開啟狀態，關閉modal而不是返回
    if ($('#videoModal').style.display === 'flex') {
        e.preventDefault();
        ui.closeModal();
        // 不立即推入狀態，讓下一次返回事件能夠觸發
        return;
    }

    // 2. 如果是siteSelectionModal開啟狀態，關閉modal而不是返回
    if ($('#siteSelectionModal').style.display === 'flex') {
        e.preventDefault();
        ui.closeSiteSelectionModal();
        // 不立即推入狀態，讓下一次返回事件能夠觸發
        return;
    }

    // 3. 如果是historyPanel開啟狀態，關閉歷史紀錄面板而不是返回
    if ($('#historyPanel').style.display === 'flex') {
        e.preventDefault();
        ui.hideHistoryPanel();
        // 關閉歷史面板後，重新推入狀態以防止返回
        window.history.pushState(null, null, window.location.href);
        return;
    }

    // 重新推入狀態以防止返回
    window.history.pushState(null, null, window.location.href);
});

// 初始化時推入狀態以防止返回
window.history.pushState(null, null, window.location.href);

// 處理 ESC 鍵的邏輯
function handleEscKey(e) {
    if (e.key !== 'Escape') return;

    // 合併全螢幕判斷，如果有任一全螢幕狀態則不處理 ESC（讓 ArtPlayer 處理）
    if (
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
    ) {
        return;
    }

    // 檢查 ArtPlayer 是否處於全螢幕模式
    if (state.artplayer && state.artplayer.fullscreenWeb) {
        state.artplayer.fullscreenWeb = false;
        return;
    }

    // 1. 檢查是否有 toast 顯示
    const toast = document.querySelector('.custom-toast.show');
    if (toast) {
        // toast 通常會自動消失，不需要手動關閉
        return;
    }

    // 2. 檢查 videoModal
    if ($('#videoModal').style.display === 'flex') {
        ui.closeModal();
        return;
    }

    // 3. 檢查 siteSelectionModal
    if ($('#siteSelectionModal').style.display === 'flex') {
        ui.closeSiteSelectionModal();
        return;
    }

    // 4. 檢查 historyPanel
    if ($('#historyPanel').style.display === 'flex') {
        ui.hideHistoryPanel();
        return;
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
    initScrollButtons();
    $('#siteSelector').addEventListener('change', handleSiteSelection);
    $('#categorySelector').addEventListener('change', handleCategorySelection);
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
    $('#clearHistoryBtn').addEventListener('click', ui.clearAllHistory);
    $('#historyOverlay').addEventListener('click', ui.hideHistoryPanel);

    // 添加 ESC 鍵處理邏輯
    document.addEventListener('keydown', handleEscKey);
}

function initScrollButtons() {
    const toTopBtn = $('#scrollToTopBtn');
    const toBottomBtn = $('#scrollToBottomBtn');
    const historyBtn = $('#historyBtn');

    toTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    toBottomBtn.addEventListener('click', () => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });

    // 歷史紀錄按鈕始終顯示
    historyBtn.style.display = 'flex';

    window.addEventListener('scroll', () => {
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        // Show/hide "scroll to top" button
        if (scrollTop > 300) {
            toTopBtn.style.display = 'flex';
        } else {
            toTopBtn.style.display = 'none';
        }

        // Show/hide "scroll to bottom" button
        if (scrollTop + clientHeight >= scrollHeight - 50) { // 50px buffer
            toBottomBtn.style.display = 'none';
        } else {
            toBottomBtn.style.display = 'flex';
        }
    });
}

let t2s; // 儲存轉換函數
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
}

async function loadSitesAndAutoLoadLast() {
    try {
        const sites = await api.fetchSites();

        // 過濾掉無效的站台（沒有 id 或 name 的站台）
        state.sites = sites.filter(site => site && site.id && site.name && site.url);



        ui.renderSites(state.sites);

        // 載入多選站台設定
        state.loadMultiSiteSelection();

        // 載入觀看歷史紀錄
        state.loadWatchHistory();

        // 載入搜尋關鍵字歷史記錄
        state.loadSearchHistory();

        // 渲染搜尋標籤
        ui.renderSearchTags();

        // 渲染影片列表
        ui.renderVideos(state.videos);

        // 檢查是否從其他頁面返回
        const isFromOtherPage = sessionStorage.getItem('fromOtherPage');
        if (isFromOtherPage) {
            // 如果從其他頁面返回，確保UI狀態正確
            sessionStorage.removeItem('fromOtherPage');

            // 重新載入站台選擇器
            if (state.searchSiteIds.length > 0) {
                // 更新UI顯示已選擇的站台
                ui.updateSelectedSitesDisplay();
                $('#mainContent').style.display = 'flex';
            } else {
                // 否則載入單選站台設定
                const lastSelectedId = localStorage.getItem('lastSelectedSiteId');
                if (lastSelectedId && state.sites.some(s => s.id == lastSelectedId)) {
                    $('#siteSelector').value = lastSelectedId;
                    handleSiteSelection();
                }
            }
        } else {
            // 正常載入流程
            // 如果有多選站台設定，優先使用多選模式
            if (state.searchSiteIds.length > 0) {
                // 更新UI顯示已選擇的站台
                ui.updateSelectedSitesDisplay();
                $('#mainContent').style.display = 'flex';
            } else {
                // 否則載入單選站台設定
                const lastSelectedId = localStorage.getItem('lastSelectedSiteId');
                if (lastSelectedId && state.sites.some(s => s.id == lastSelectedId)) {
                    $('#siteSelector').value = lastSelectedId;
                    handleSiteSelection();
                }
            }
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


function handleSiteSelection() {
    const siteId = $('#siteSelector').value;

    if (siteId) {
        // 清掉多選站台設定
        state.searchSiteIds = [];
        state.saveMultiSiteSelection();
        ui.updateSelectedSitesDisplay();

        localStorage.setItem('lastSelectedSiteId', siteId);
        state.currentSite = state.sites.find(s => s.id == siteId);
        if (state.currentSite) {
            state.currentPage = 1;
            state.currentTypeId = null;
            state.currentKeyword = null;
            state.categories = [];
            $('#mainContent').style.display = 'flex';
            fetchAndRender();
        }
    } else {
        localStorage.removeItem('lastSelectedSiteId');
        $('#mainContent').style.display = 'none';
        state.currentSite = null;
    }
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
    $('#siteSelector').value = ''; // Deselect single site selector
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

    $('#mainContent').style.display = 'flex';
    fetchAndRender();
}

function handleCategorySelection() {
    const newTypeId = $('#categorySelector').value;
    if (newTypeId !== state.currentTypeId || state.currentKeyword) {
        state.currentKeyword = null;
        state.currentTypeId = newTypeId === "all" ? null : newTypeId;
        state.currentPage = 1;
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
        // You might want to show a loading state in the select dropdown
        ui.renderCategories([]);
    }

    $('#siteSelector').disabled = true;

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

        if (!isMultiSiteSearch && result.class && result.class.length > 0) {
            state.categories = result.class;
            ui.renderCategories(state.categories);
        } else if (!isMultiSiteSearch && state.categories.length === 0) {
            ui.renderCategories([]);
        }

        ui.renderVideos(state.videos);
        ui.renderPagination(state.currentPage, state.totalPages, (newPage) => {
            state.currentPage = newPage;
            fetchAndRender(); // Now this will correctly re-trigger the same search type
        });
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
        $('#siteSelector').disabled = false;
    }
}
