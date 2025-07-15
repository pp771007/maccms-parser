"use strict";

import * as api from './api.js';
import { $ } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    loadSites();
    $('#addSiteBtn').addEventListener('click', handleAddNewSite);
});

async function loadSites() {
    try {
        const sites = await api.fetchSites();
        renderSiteList(sites);
    } catch (err) {
        console.error("無法載入站點列表:", err);
        alert("無法載入站點列表: " + err.message);
    }
}

function renderSiteList(sites) {
    const siteList = $('#siteList');
    siteList.innerHTML = ''; // 清空現有列表

    if (!sites || sites.length === 0) {
        siteList.innerHTML = '<li>沒有找到任何站點。</li>';
        return;
    }

    sites.forEach(site => {
        const li = document.createElement('li');
        li.className = 'site-item';
        li.dataset.siteId = site.id;

        li.innerHTML = `
            <div class="site-info">
                <input type="text" class="site-name-input" value="${site.name}" placeholder="站點名稱">
                <input type="text" class="site-url-input" value="${site.url}" placeholder="站點URL">
                <input type="text" class="site-note-input" value="${site.note || ''}" placeholder="備註">
            </div>
            <div class="site-controls">
                <label><input type="checkbox" class="site-enabled-toggle" ${site.enabled ? 'checked' : ''}> 啟用</label>
                <label><input type="checkbox" class="site-ssl-toggle" ${site.ssl_verify ? 'checked' : ''}> SSL</label>
                <button class="btn-update">更新</button>
                <button class="btn-delete">刪除</button>
                <button class="btn-move-up">↑</button>
                <button class="btn-move-down">↓</button>
            </div>
        `;

        // Event Listeners for site actions
        li.querySelector('.btn-update').addEventListener('click', () => handleUpdateSite(site.id, li));
        li.querySelector('.btn-delete').addEventListener('click', () => handleDeleteSite(site.id, site.name));
        li.querySelector('.btn-move-up').addEventListener('click', () => handleMoveSite(site.id, 'up'));
        li.querySelector('.btn-move-down').addEventListener('click', () => handleMoveSite(site.id, 'down'));

        siteList.appendChild(li);
    });
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
        loadSites(); // 重新載入列表
        alert('站點新增成功！');
    } catch (err) {
        alert(`新增失敗: ${err.message}`);
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
        alert('站點URL不能為空');
        return;
    }

    try {
        await api.updateSite(siteId, { name, url, note, enabled, ssl_verify });
        alert('站點更新成功！');
        loadSites(); // 重新載入以反映變更
    } catch (err) {
        alert(`更新失敗: ${err.message}`);
    }
}

async function handleDeleteSite(siteId, siteName) {
    if (confirm(`確定要刪除站點 "${siteName}" 嗎？此操作不可恢復。`)) {
        try {
            await api.deleteSite(siteId);
            alert('站點已刪除。');
            loadSites(); // 重新載入列表
        } catch (err) {
            alert('刪除失敗: ' + err.message);
        }
    }
}

async function handleMoveSite(siteId, direction) {
    try {
        await api.moveSite(siteId, direction);
        loadSites(); // 重新載入以反映新的排序
    } catch (err) {
        alert(`移動失敗: ${err.message}`);
    }
}
