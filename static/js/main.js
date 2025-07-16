"use strict";

import state from './state.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { $ } from './utils.js';


document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadSitesAndAutoLoadLast();
    registerServiceWorker();
});

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/static/sw.js').then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }, err => {
                console.log('ServiceWorker registration failed: ', err);
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
}

function initScrollButtons() {
    const toTopBtn = $('#scrollToTopBtn');
    const toBottomBtn = $('#scrollToBottomBtn');

    toTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    toBottomBtn.addEventListener('click', () => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });

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
            alert('無法載入簡繁轉換功能，請檢查網絡連線。');
            return;
        }
    }
    searchInput.value = t2s(searchInput.value);
}

async function loadSitesAndAutoLoadLast() {
    try {
        state.sites = await api.fetchSites();
        ui.renderSites(state.sites);

        const lastSelectedId = localStorage.getItem('lastSelectedSiteId');
        if (lastSelectedId && state.sites.some(s => s.id == lastSelectedId)) {
            $('#siteSelector').value = lastSelectedId;
            handleSiteSelection();
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
    // Reset multi-site search state when single site is selected
    state.searchSiteIds = [];
    ui.updateSelectedSitesDisplay();

    if (siteId) {
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
        alert('請至少選擇一個站台。');
        return;
    }
    state.searchSiteIds = selectedIds;
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

    // If no multi-selection is active, use the currently selected single site
    if (state.searchSiteIds.length === 0 && state.currentSite) {
        state.searchSiteIds = [state.currentSite.id];
    } else if (state.searchSiteIds.length === 0 && !state.currentSite) {
        alert('請先選擇一個或多個站台進行搜尋。');
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
