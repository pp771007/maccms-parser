"use strict";

import * as api from './api.js';
import { $ } from './utils.js';
import { showModal, showToast } from './modal.js';

// 與 kazi ScanSitesScreen 的 HARVEST_JS 同一套抓取邏輯：讀所有 <a> 的 href、
// 還原 Google 的 /url?q= 轉址、過濾含 api.php/provide/vod 的連結，再開匯入頁。
function buildBookmarklet(origin) {
    const code =
        "(function(){" +
        "var pat=/api\\.php\\/provide\\/vod/i,out=[],seen={};" +
        "document.querySelectorAll('a').forEach(function(a){" +
        "var href=a.href;if(!href)return;var url=href;" +
        "try{var u=new URL(href,location.href);" +
        "if(/google\\./.test(u.hostname)&&u.pathname==='/url'){" +
        "var q=u.searchParams.get('q')||u.searchParams.get('url');if(q)url=q;}}catch(e){}" +
        "if(pat.test(url)&&!seen[url]){seen[url]=1;out.push(url);}});" +
        "if(!out.length){alert('本頁沒抓到 MacCMS 站點連結，往下捲動載入更多結果或翻頁後再點一次');return;}" +
        "window.open('" + origin + "/scan_import#urls='+encodeURIComponent(out.join('\\n')),'_blank');" +
        "})();";
    return 'javascript:' + encodeURIComponent(code);
}

function parseHashUrls() {
    const m = location.hash.match(/urls=([^&]*)/);
    if (!m) return null;
    try {
        return decodeURIComponent(m[1]).split(/\s+/).filter(Boolean);
    } catch (e) {
        return null;
    }
}

let candidates = [];

document.addEventListener('DOMContentLoaded', () => {
    const origin = $('.container').dataset.origin;
    const bookmarkletHref = buildBookmarklet(origin);
    $('#bookmarklet').href = bookmarkletHref;

    $('#copyBookmarklet').addEventListener('click', () => {
        navigator.clipboard.writeText(bookmarkletHref)
            .then(() => showToast('已複製書籤程式碼，貼到書籤的網址欄即可', 'success'))
            .catch(() => showModal('複製失敗，請手動長按書籤連結複製', 'warning'));
    });

    $('#probeBtn').addEventListener('click', () => {
        const urls = $('#urlInput').value.split(/\s+/).filter(Boolean);
        if (urls.length === 0) {
            showModal('請先貼上至少一個網址', 'warning');
            return;
        }
        runProbe(urls);
    });

    $('#addSelectedBtn').addEventListener('click', handleAddSelected);

    // 從書籤帶回來的網址（location.hash）→ 自動填入並驗證
    const hashUrls = parseHashUrls();
    if (hashUrls && hashUrls.length > 0) {
        $('#urlInput').value = hashUrls.join('\n');
        // 清掉 hash，避免重新整理又觸發一次
        history.replaceState(null, '', location.pathname);
        runProbe(hashUrls);
    }
});

async function runProbe(urls) {
    const btn = $('#probeBtn');
    btn.disabled = true;
    btn.textContent = '驗證中...';
    $('#candidateList').innerHTML = '<li class="empty-hint">驗證中，請稍候...</li>';
    try {
        const res = await api.probeSites(urls);
        candidates = res.results.map(r => ({ ...r, selected: r.healthy }));
        renderCandidates();
    } catch (err) {
        showModal('驗證失敗: ' + err.message, 'error');
        $('#candidateList').innerHTML = '<li class="empty-hint">驗證失敗，請稍後再試。</li>';
    } finally {
        btn.disabled = false;
        btn.textContent = '驗證這些網址';
    }
}

function renderCandidates() {
    const list = $('#candidateList');
    list.innerHTML = '';

    if (candidates.length === 0) {
        list.innerHTML = '<li class="empty-hint">沒有抓到任何候選網址。</li>';
        updateSummary();
        return;
    }

    candidates.forEach((c, idx) => {
        const li = document.createElement('li');
        li.className = 'candidate-item' + (c.healthy ? '' : ' is-unavailable');

        const statusClass = c.healthy ? 'ok' : 'fail';
        const statusText = c.healthy ? '可用' : c.message;

        li.innerHTML = `
            <label class="candidate-check">
                <input type="checkbox" ${c.selected ? 'checked' : ''} ${c.healthy ? '' : 'disabled'}>
            </label>
            <div class="candidate-info">
                <div class="candidate-name">
                    <span class="dot ${statusClass}"></span>
                    <span class="name-text">${c.name}</span>
                </div>
                <div class="candidate-url">${c.url}</div>
                ${c.healthy ? '' : `<div class="candidate-msg">${statusText}</div>`}
            </div>
        `;

        const checkbox = li.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', () => {
            candidates[idx].selected = checkbox.checked;
            updateSummary();
        });

        list.appendChild(li);
    });

    updateSummary();
}

function updateSummary() {
    const okCount = candidates.filter(c => c.healthy).length;
    const failCount = candidates.length - okCount;
    const selectedCount = candidates.filter(c => c.selected && c.healthy).length;

    $('#resultSummary').textContent =
        candidates.length === 0 ? '' : `共 ${candidates.length} 個 · 可用 ${okCount} · 無效 ${failCount}`;

    const addBtn = $('#addSelectedBtn');
    addBtn.textContent = `加入所選 (${selectedCount})`;
    addBtn.disabled = selectedCount === 0;
}

async function handleAddSelected() {
    const toAdd = candidates.filter(c => c.selected && c.healthy);
    if (toAdd.length === 0) return;

    const addBtn = $('#addSelectedBtn');
    addBtn.disabled = true;
    addBtn.textContent = '加入中...';

    const addedUrls = new Set();
    let fail = 0;
    for (const c of toAdd) {
        try {
            await api.postNewSite(c.name, c.url);
            addedUrls.add(c.url);
        } catch (err) {
            fail++;
            console.error(`加入 ${c.url} 失敗:`, err);
        }
    }

    // 只把成功加入的從清單移除，失敗的留著讓使用者重試
    if (addedUrls.size > 0) {
        candidates = candidates.filter(c => !addedUrls.has(c.url));
        renderCandidates();
    }

    showToast(`已加入 ${addedUrls.size} 個站點${fail > 0 ? `（${fail} 個失敗）` : ''}`, fail > 0 ? 'warning' : 'success');
    updateSummary();
}
