"use strict";

import state from './state.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { $ } from './utils.js';


document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadSitesAndAutoLoadLast();
});

function setupEventListeners() {
    $('#siteSelector').addEventListener('change', handleSiteSelection);
    $('#addSiteBtn').addEventListener('click', handleAddNewSite);
    $('#category-nav').addEventListener('click', handleCategoryClick);
    $('#deleteSiteBtn').addEventListener('click', handleDeleteSite);
    $('#searchBtn').addEventListener('click', handleSearch);
    $('#toSimpBtn').addEventListener('click', handleToSimp);
    $('#searchInput').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    });
    $('.close-btn').addEventListener('click', ui.closeModal);
    $('#videoModal').addEventListener('click', (e) => {
        if (e.target === $('#videoModal')) ui.closeModal();
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
        ui.showError(err.message);
    }
}

async function handleAddNewSite() {
    const name = $('#newSiteName').value.trim();
    const url = $('#newSiteUrl').value.trim();
    if (!url) {
        alert('站點URL不能為空');
        return;
    }
    try {
        $('#addSiteBtn').disabled = true;
        await api.postNewSite(name, url);
        $('#newSiteName').value = '';
        $('#newSiteUrl').value = '';
        state.sites = await api.fetchSites();
        ui.renderSites(state.sites);
        alert('站點新增成功！請從下拉選單中選擇它來加載。');
    } catch (err) {
        alert(`新增失敗: ${err.message}`);
    } finally {
        $('#addSiteBtn').disabled = false;
    }
}

async function handleDeleteSite() {
    const siteId = $('#siteSelector').value;
    if (!siteId) {
        alert('請先選擇一個要刪除的站點');
        return;
    }
    const selectedSite = state.sites.find(s => s.id == siteId);
    if (confirm(`確定要刪除站點 "${selectedSite.name}" 嗎？此操作不可恢復。`)) {
        try {
            await fetch(`/api/sites/${Number(siteId)}`, { method: 'DELETE' });
            localStorage.removeItem('lastSelectedSiteId');
            $('#mainContent').style.display = 'none';
            state.currentSite = null;
            await loadSitesAndAutoLoadLast();
            alert('站點已刪除。');
        } catch (err) {
            alert('刪除失敗: ' + err.message);
        }
    }
}

function handleSiteSelection() {
    const siteId = $('#siteSelector').value;
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

function handleSearch() {
    const keyword = $('#searchInput').value.trim();
    state.currentTypeId = null;
    state.currentPage = 1;
    state.currentKeyword = keyword;
    fetchAndRender();
}

function handleCategoryClick(e) {
    if (e.target.classList.contains('category-tag')) {
        const newTypeId = e.target.dataset.id === "" ? null : e.target.dataset.id;
        if (newTypeId !== state.currentTypeId || state.currentKeyword) {
            state.currentKeyword = null;
            state.currentTypeId = newTypeId;
            state.currentPage = 1;
            fetchAndRender();
        }
    }
}

async function fetchAndRender() {
    if (!state.currentSite) return;

    window.scrollTo({ top: 0, behavior: 'smooth' });

    ui.showLoader(true);
    ui.showError(null);
    $('#videoGrid').innerHTML = '';
    $('#pagination').innerHTML = '';

    if (state.categories.length === 0) {
        $('#category-nav').innerHTML = '正在加載分類...';
    }

    $('#siteSelector').disabled = true;

    try {
        const result = await api.fetchVideoList(
            state.currentSite.url,
            state.currentPage,
            state.currentKeyword ? null : state.currentTypeId,
            state.currentKeyword
        );

        state.videos = result.list;
        state.currentPage = Number(result.page);
        state.totalPages = Number(result.pagecount);

        if (result.class && result.class.length > 0) {
            state.categories = result.class;
            ui.renderCategories(state.categories);
        } else if (state.categories.length === 0) {
            ui.renderCategories([]);
        }

        ui.renderVideos(state.videos);
        ui.renderPagination(state.currentPage, state.totalPages, (newPage) => {
            state.currentPage = newPage;
            fetchAndRender();
        });
        ui.updateActiveCategory(state.currentTypeId);
        ui.updateSearchBox(state.currentKeyword);

    } catch (err) {
        ui.showError(err.message);
    } finally {
        ui.showLoader(false);
        $('#siteSelector').disabled = false;
    }
}
