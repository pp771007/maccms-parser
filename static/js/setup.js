"use strict";

import * as api from './api.js';
import { $ } from './utils.js';
import { showModal, showConfirm } from './modal.js';

// PWA 返回處理變數
let backPressCount = 0;
let backPressTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    loadSites();
    setupPWAExitHandler();
    setupReturnLink();
    $('#addSiteBtn').addEventListener('click', handleAddNewSite);
    $('#checkAllSitesBtn').addEventListener('click', handleCheckAllSites);
    // 新增外觀設定表單事件
    loadSiteSettings();
    $('#siteSettingsForm').addEventListener('submit', handleSiteSettingsSubmit);
    $('#faviconInput').addEventListener('change', handleFaviconPreview);
});

function setupReturnLink() {
    // 為「返回主頁」連結添加點擊事件
    const returnLink = document.querySelector('.find-sites-link');
    if (returnLink) {
        returnLink.addEventListener('click', (e) => {
            // 設置標記，表示從其他頁面返回
            sessionStorage.setItem('fromOtherPage', 'true');
        });
    }
}

function setupPWAExitHandler() {
    // 阻止設定頁面的返回行為
    window.history.pushState(null, null, window.location.href);

    // 監聽瀏覽器的返回按鈕事件
    window.addEventListener('popstate', (e) => {
        e.preventDefault();

        // 在PWA模式下，直接返回主頁面
        if (window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true) {

            // 清除任何現有的計時器
            if (backPressTimer) {
                clearTimeout(backPressTimer);
            }

            // 設置標記，表示從其他頁面返回
            sessionStorage.setItem('fromOtherPage', 'true');

            // 重置返回計數器並返回主頁面
            backPressCount = 0;
            window.location.href = '/';
        } else {
            // 非PWA模式，重新推入狀態以防止返回
            window.history.pushState(null, null, window.location.href);
        }
    });
}

async function loadSites() {
    try {
        const sites = await api.fetchSites('setup');
        renderSiteList(sites);
    } catch (err) {
        console.error("無法載入站點列表:", err);
        showModal("無法載入站點列表: " + err.message, 'error');
    }
}

function renderSiteList(sites) {
    const siteList = $('#siteList');
    siteList.innerHTML = '';

    if (!sites || sites.length === 0) {
        siteList.innerHTML = '<li>沒有找到任何站點。</li>';
        return;
    }

    sites.forEach(site => {
        const li = document.createElement('li');
        li.className = 'site-item';
        li.dataset.siteId = site.id;

        // 格式化檢查時間
        let checkTimeDisplay = '';
        let checkStatusDisplay = '';
        if (site.last_check) {
            const checkTime = new Date(site.last_check);
            // 轉換UTC時間為本地時區顯示
            checkTimeDisplay = checkTime.toLocaleString('zh-TW', {
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            if (site.check_status === 'success') {
                checkStatusDisplay = '<span class="check-success">✓ 正常</span>';
            } else if (site.check_status === 'failed') {
                checkStatusDisplay = '<span class="check-failed">✗ 失敗</span>';
            }
        }

        li.innerHTML = `
            <div class="site-info">
                <input type="text" class="site-name-input" value="${site.name}" placeholder="站點名稱">
                <input type="text" class="site-url-input" value="${site.url}" placeholder="站點URL">
                <input type="text" class="site-note-input" value="${site.note || ''}" placeholder="備註">
            </div>
            <div class="site-status">
                <div class="check-info">
                    <span class="check-time">${checkTimeDisplay ? `檢查時間: ${checkTimeDisplay}` : '尚未檢查'}</span>
                    <span class="check-result">${checkStatusDisplay}</span>
                </div>
            </div>
            <div class="site-controls">
                <label><input type="checkbox" class="site-enabled-toggle" ${site.enabled ? 'checked' : ''}><span>啟用</span></label>
                <label><input type="checkbox" class="site-ssl-toggle" ${site.ssl_verify ? 'checked' : ''}><span>SSL</span></label>
                <button class="btn-check-site" data-site-id="${site.id}">檢查</button>
                <button class="btn-update">更新</button>
                <button class="btn-delete">刪除</button>
                <button class="btn-move-up">↑</button>
                <button class="btn-move-down">↓</button>
            </div>
        `;

        li.querySelector('.btn-update').addEventListener('click', () => handleUpdateSite(site.id, li));
        li.querySelector('.btn-delete').addEventListener('click', () => handleDeleteSite(site.id, site.name));
        li.querySelector('.btn-move-up').addEventListener('click', () => handleMoveSite(site.id, 'up'));
        li.querySelector('.btn-move-down').addEventListener('click', () => handleMoveSite(site.id, 'down'));
        li.querySelector('.btn-check-site').addEventListener('click', () => handleCheckSingleSite(site.id, li));

        siteList.appendChild(li);
    });
}

async function handleCheckAllSites() {
    const checkBtn = $('#checkAllSitesBtn');
    const statusDiv = $('#checkStatus');
    const includeDisabled = $('#includeDisabledCheckbox').checked;

    try {
        checkBtn.disabled = true;
        checkBtn.textContent = '檢查中...';
        statusDiv.innerHTML = '<span class="checking">正在檢查站點...</span>';

        // 呼叫立即檢查API
        const result = await api.checkSitesNow(includeDisabled);

        if (result.status === 'success') {
            // 顯示檢查結果清單
            displayCheckResults(result.results);
        } else {
            statusDiv.innerHTML = `<span class="check-failed">檢查失敗: ${result.message}</span>`;
        }

        // 重新載入站點列表以顯示最新狀態
        loadSites();

    } catch (err) {
        statusDiv.innerHTML = `<span class="check-failed">檢查失敗: ${err.message}</span>`;
    } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = '檢查所有站點';
    }
}

async function handleCheckSingleSite(siteId, listItem) {
    const checkBtn = listItem.querySelector('.btn-check-site');
    const originalText = checkBtn.textContent;

    try {
        checkBtn.disabled = true;
        checkBtn.textContent = '檢查中...';

        const result = await api.checkSingleSite(siteId);

        if (result.status === 'success') {
            const checkResult = result.result;
            const statusClass = checkResult.status === 'success' ? 'check-success' :
                checkResult.status === 'failed' ? 'check-failed' : 'check-error';
            const statusIcon = checkResult.status === 'success' ? '✓' :
                checkResult.status === 'failed' ? '✗' : '⚠';

            // 顯示檢查結果
            const statusDiv = listItem.querySelector('.check-result');
            statusDiv.innerHTML = `<span class="${statusClass}">${statusIcon} ${checkResult.message}</span>`;

            // 更新檢查時間
            const timeDiv = listItem.querySelector('.check-time');
            const now = new Date().toLocaleString('zh-TW', {
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            timeDiv.textContent = `檢查時間: ${now}`;

            // 顯示臨時提示
            showTemporaryMessage(`站點 ${checkResult.name} 檢查完成: ${checkResult.message}`, statusClass);
        } else {
            showTemporaryMessage(`檢查失敗: ${result.message}`, 'check-failed');
        }

        // 重新載入站點列表以顯示最新狀態
        loadSites();

    } catch (err) {
        showTemporaryMessage(`檢查失敗: ${err.message}`, 'check-failed');
    } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = originalText;
    }
}

function showTemporaryMessage(message, className) {
    const statusDiv = $('#checkStatus');
    statusDiv.innerHTML = `<span class="${className}">${message}</span>`;

    // 3秒後清除訊息
    setTimeout(() => {
        statusDiv.innerHTML = '';
    }, 3000);
}

function displayCheckResults(results) {
    const statusDiv = $('#checkStatus');

    if (!results || results.length === 0) {
        statusDiv.innerHTML = '<span class="check-success">沒有站點需要檢查</span>';
        return;
    }

    // 統計結果
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    let resultHtml = `
        <div class="check-results">
            <div class="check-summary">
                <span class="check-success">✓ 成功: ${successCount}</span>
                <span class="check-failed">✗ 失敗: ${failedCount}</span>
                <span class="check-error">⚠ 錯誤: ${errorCount}</span>
            </div>
            <div class="check-details">
    `;

    results.forEach(result => {
        const statusClass = result.status === 'success' ? 'check-success' :
            result.status === 'failed' ? 'check-failed' : 'check-error';
        const statusIcon = result.status === 'success' ? '✓' :
            result.status === 'failed' ? '✗' : '⚠';

        resultHtml += `
            <div class="check-item ${statusClass}">
                <span class="check-icon">${statusIcon}</span>
                <span class="check-name">${result.name}</span>
                <span class="check-message">${result.message}</span>
            </div>
        `;
    });

    resultHtml += `
            </div>
        </div>
    `;

    statusDiv.innerHTML = resultHtml;
}

async function handleAddNewSite() {
    const name = $('#newSiteName').value.trim();
    const url = $('#newSiteUrl').value.trim();
    if (!url) {
        showModal('站點URL不能為空', 'warning');
        return;
    }
    try {
        $('#addSiteBtn').disabled = true;
        await api.postNewSite(name, url);
        $('#newSiteName').value = '';
        $('#newSiteUrl').value = '';
        loadSites();
        showModal('站點新增成功！', 'success');
    } catch (err) {
        showModal(`新增失敗: ${err.message}`, 'error');
    } finally {
        $('#addSiteBtn').disabled = false;
    }
}

async function handleUpdateSite(siteId, listItem) {
    const name = listItem.querySelector('.site-name-input').value.trim();
    const url = listItem.querySelector('.site-url-input').value.trim();
    const note = listItem.querySelector('.site-note-input').value.trim();
    const enabled = listItem.querySelector('.site-enabled-toggle').checked;
    const ssl_verify = listItem.querySelector('.site-ssl-toggle').checked;

    if (!url) {
        showModal('站點URL不能為空', 'warning');
        return;
    }

    try {
        await api.updateSite(siteId, { name, url, note, enabled, ssl_verify });
        showModal('站點更新成功！', 'success');
        loadSites();
    } catch (err) {
        showModal(`更新失敗: ${err.message}`, 'error');
    }
}

async function handleDeleteSite(siteId, siteName) {
    showConfirm(`確定要刪除站點 "${siteName}" 嗎？此操作不可恢復。`, async () => {
        try {
            await api.deleteSite(siteId);
            showModal('站點已刪除。', 'success');
            loadSites();
        } catch (err) {
            showModal('刪除失敗: ' + err.message, 'error');
        }
    }, '請確認', 'warning');
}

async function handleMoveSite(siteId, direction) {
    try {
        await api.moveSite(siteId, direction);
        loadSites();
    } catch (err) {
        showModal(`移動失敗: ${err.message}`, 'error');
    }
}

async function loadSiteSettings() {
    try {
        const res = await fetch('/settings');
        const data = await res.json();
        $('#siteTitleInput').value = data.site_title || '';
        // favicon 預覽
        if (data.favicon_ext && data.favicon_version !== undefined) {
            const url = `/favicon?v=${data.favicon_version}`;
            $('#faviconPreview').innerHTML = `<img src="${url}" alt="目前 Favicon" style="width:32px;height:32px;">` +
                `<button id="resetFaviconBtn" type="button" class="btn btn-secondary" style="margin-left:10px;">回復預設值</button>`;
            $('#resetFaviconBtn').onclick = handleResetFavicon;
        }
    } catch (err) {
        console.error('無法載入外觀設定:', err);
    }
}

async function handleResetFavicon() {
    showConfirm('確定要回復預設 Favicon 嗎？', async () => {
        try {
            const res = await fetch('/settings?reset_favicon=1', { method: 'POST' });
            const data = await res.json();
            if (data.status === 'success') {
                showModal('已回復預設 Favicon！', 'success');
                loadSiteSettings();
            } else {
                showModal(data.message || '操作失敗', 'error');
            }
        } catch (err) {
            showModal('操作失敗: ' + err.message, 'error');
        }
    });
}

function handleFaviconPreview(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
        $('#faviconPreview').innerHTML = `<img src="${evt.target.result}" alt="預覽 Favicon" style="width:32px;height:32px;">`;
    };
    reader.readAsDataURL(file);
}

async function handleSiteSettingsSubmit(e) {
    e.preventDefault();
    const form = $('#siteSettingsForm');
    const formData = new FormData(form);
    // 若標題為空，自動設為預設值
    if (!formData.get('site_title') || formData.get('site_title').trim() === '') {
        formData.set('site_title', '資源站點管理器');
    }
    try {
        const res = await fetch('/settings', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.status === 'success') {
            showModal('外觀設定已儲存！', 'success');
            loadSiteSettings();
        } else {
            showModal(data.message || '儲存失敗', 'error');
        }
    } catch (err) {
        showModal('儲存失敗: ' + err.message, 'error');
    }
}