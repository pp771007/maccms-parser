import state from './state.js';
import { playVideo } from './player.js';
import { fetchVideoDetails } from './api.js';
import { $, $$ } from './utils.js';

export function renderSites(sites) {
    const selector = $('#siteSelector');
    const currentVal = selector.value;
    selector.innerHTML = '<option value="">-- 請選擇一個站點 --</option>';
    // The 'sites' array is now pre-filtered and sorted by the backend.
    sites.forEach(site => {
        const displayName = site.note ? `${site.name} (${site.note})` : site.name;
        selector.innerHTML += `<option value="${site.id}">${displayName}</option>`;
    });
    if (sites.some(s => s.id == currentVal)) {
        selector.value = currentVal;
    }
}

export function renderCategories(categories) {
    const selector = $('#categorySelector');
    const currentVal = selector.value;
    selector.innerHTML = '<option value="all">全部</option>';
    if (categories && categories.length > 0) {
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.type_id;
            option.textContent = cat.type_name;
            selector.appendChild(option);
        });
    }
    // Restore previous selection if possible
    if (Array.from(selector.options).some(opt => opt.value == currentVal)) {
        selector.value = currentVal;
    }
}

export function renderVideos(videos) {
    const grid = $('#videoGrid');
    grid.innerHTML = '';
    if (!videos || videos.length === 0) {
        grid.innerHTML = '<p style="text-align: center; grid-column: 1 / -1; padding: 20px;">沒有找到相關內容。</p>';
        return;
    }

    // 聚合相同名字的影片
    const groupedVideos = {};
    videos.forEach(video => {
        const key = video.vod_name;
        if (!groupedVideos[key]) {
            groupedVideos[key] = [];
        }
        groupedVideos[key].push(video);
    });

    // 渲染聚合後的影片
    Object.entries(groupedVideos).forEach(([videoName, videoList]) => {
        const card = document.createElement('div');
        card.className = 'video-card';

        // 使用第一個影片的圖片作為代表
        const firstVideo = videoList[0];

        // 改善圖片URL處理，避免中文編碼問題
        let finalImageUrl;
        if (firstVideo.vod_pic && firstVideo.vod_pic.trim()) {
            finalImageUrl = firstVideo.vod_pic;
        } else {
            // 使用英文名稱生成佔位圖片，避免中文編碼問題
            const englishName = videoName.replace(/[^\w\s]/g, '').substring(0, 10);
            const placeholderText = encodeURIComponent(englishName || 'No Image');
            finalImageUrl = `https://placehold.co/300x400.png?text=${placeholderText}`;
        }

        // 聚合顯示站台名稱
        let siteNamesHtml = '';
        if (videoList.length > 1) {
            const uniqueSites = [...new Set(videoList.map(v => v.from_site).filter(Boolean))];
            if (uniqueSites.length > 0) {
                siteNamesHtml = `<div class="video-site-name">${uniqueSites.join(', ')}</div>`;
            }
        } else if (firstVideo.from_site) {
            siteNamesHtml = `<div class="video-site-name">${firstVideo.from_site}</div>`;
        }

        // 顯示聚合數量
        const countBadge = videoList.length > 1 ? `<div class="video-count-badge">${videoList.length}</div>` : '';

        card.innerHTML = `
            <div class="video-pic-wrapper">
                <img class="video-pic" src="${finalImageUrl}" alt="${videoName}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/300x400.png?text=No+Image';">
                ${siteNamesHtml}
                ${countBadge}
            </div>
            <div class="video-info">
                <div class="video-title" title="${videoName}">${videoName}</div>
                <div class="video-note">${firstVideo.vod_remarks || ''}</div>
            </div>
        `;

        // 點擊時顯示所有來源的詳細資訊
        card.addEventListener('click', () => {
            if (videoList.length > 1) {
                openMultiSourceModal(videoName, videoList);
            } else {
                openModal(firstVideo);
            }
        });

        grid.appendChild(card);
    });
}

export function renderPagination(currentPage, totalPages, onPageChange) {
    const pag = $('#pagination');
    pag.innerHTML = '';
    if (!totalPages || totalPages <= 1) return;

    const createBtn = (page, text = page, isDisabled = false) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.disabled = isDisabled;
        const pageNumber = Number(page);
        if (pageNumber === currentPage) btn.classList.add('active');
        btn.addEventListener('click', () => {
            if (currentPage !== pageNumber) {
                onPageChange(pageNumber);
            }
        });
        return btn;
    };

    pag.appendChild(createBtn(currentPage - 1, '上一頁', currentPage === 1));

    const pageInput = document.createElement('input');
    pageInput.type = 'number';
    pageInput.min = 1;
    pageInput.max = totalPages;
    pageInput.value = currentPage;
    pageInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            const newPage = parseInt(e.target.value, 10);
            if (newPage >= 1 && newPage <= totalPages) {
                onPageChange(newPage);
            } else {
                alert(`請輸入 1 到 ${totalPages} 之間的頁碼`);
            }
        }
    });
    pag.appendChild(pageInput);

    const pageInfo = document.createElement('span');
    pageInfo.textContent = `/ ${totalPages} 頁`;
    pag.appendChild(pageInfo);

    pag.appendChild(createBtn(currentPage + 1, '下一頁', currentPage === totalPages));
}


export function updateSearchBox(keyword) {
    const searchInput = $('#searchInput');
    if (searchInput.value !== (keyword || '')) {
        searchInput.value = keyword || '';
    }
}

export async function openModal(video) {
    $('#modalTitle').textContent = video.vod_name;
    $('#videoModal').style.display = 'flex';
    $('#playlistSources').innerHTML = '';
    $('#episodeList').innerHTML = '正在加載播放列表...';

    try {
        let siteUrl;
        // Check if it's from a multi-site search
        if (video.from_site_id) {
            const site = state.sites.find(s => s.id === video.from_site_id);
            if (site) {
                siteUrl = site.url;
            } else {
                // Fallback or error
                throw new Error(`在站台列表中找不到 ID 為 ${video.from_site_id} 的站台。`);
            }
        } else if (state.currentSite) {
            // Single site mode
            siteUrl = state.currentSite.url;
        } else {
            throw new Error('無法確定要從哪個站台獲取詳細資訊。');
        }

        const result = await fetchVideoDetails(siteUrl, video.vod_id);
        state.modalData = result.data;
        renderPlaylist();
    } catch (err) {
        $('#episodeList').innerHTML = `<p style="color:red;">獲取播放列表失敗: ${err.message}</p>`;
    }
}

// 新增多來源影片的modal
export async function openMultiSourceModal(videoName, videoList) {
    $('#modalTitle').textContent = `${videoName} (${videoList.length} 個來源)`;
    $('#videoModal').style.display = 'flex';
    $('#playlistSources').innerHTML = '';
    $('#episodeList').innerHTML = '請選擇來源...';

    // 創建來源選擇按鈕
    const playlistSources = $('#playlistSources');
    playlistSources.innerHTML = '';

    // 儲存影片列表到state中，方便切換
    state.multiSourceVideos = videoList;

    videoList.forEach((video, index) => {
        const btn = document.createElement('button');
        btn.className = 'source-btn';
        btn.textContent = video.from_site || `來源 ${index + 1}`;
        btn.dataset.index = index;
        btn.onclick = async () => {
            try {
                // 更新按鈕狀態
                $$('.source-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                let siteUrl;
                if (video.from_site_id) {
                    const site = state.sites.find(s => s.id === video.from_site_id);
                    if (site) {
                        siteUrl = site.url;
                    } else {
                        throw new Error(`找不到站台 ID ${video.from_site_id}`);
                    }
                } else if (state.currentSite) {
                    siteUrl = state.currentSite.url;
                } else {
                    throw new Error('無法確定站台來源');
                }

                const result = await fetchVideoDetails(siteUrl, video.vod_id);
                state.modalData = result.data;
                state.currentSourceIndex = index;
                // 使用renderPlaylist來顯示播放列表
                renderPlaylist();
            } catch (err) {
                $('#episodeList').innerHTML = `<p style="color:red;">獲取播放列表失敗: ${err.message}</p>`;
            }
        };
        playlistSources.appendChild(btn);
    });

    // 自動選擇第一個來源
    if (videoList.length > 0) {
        playlistSources.firstElementChild.click();
    }
}

// 新增只渲染劇集的函數，不清空來源按鈕
function renderEpisodesOnly() {
    if (!state.modalData || state.modalData.length === 0) {
        $('#episodeList').innerHTML = '<p>沒有可用的播放源。</p>';
        return;
    }

    const episodeList = $('#episodeList');
    episodeList.innerHTML = '';

    // 使用當前選擇的來源索引
    const sourceIndex = state.currentSourceIndex || 0;
    const currentSource = state.modalData[sourceIndex];

    if (currentSource && currentSource.episodes.length > 0) {
        currentSource.episodes.forEach(epi => {
            const item = document.createElement('div');
            item.className = 'episode-item';
            item.textContent = epi.name;
            item.onclick = () => playVideo(epi.url, item);
            episodeList.appendChild(item);
        });
        playVideo(currentSource.episodes[0].url, $('.episode-item'));
    } else {
        episodeList.innerHTML = '<p>此來源下沒有劇集。</p>';
        if (state.dplayer) { state.dplayer.destroy(); state.dplayer = null; }
        $('#dplayer').innerHTML = '';
    }
}

function renderPlaylist(sourceIndex = 0) {
    if (!state.modalData || state.modalData.length === 0) {
        $('#episodeList').innerHTML = '<p>沒有可用的播放源。</p>';
        return;
    }

    // 檢查是否為多來源模式
    const isMultiSourceMode = state.multiSourceVideos && state.multiSourceVideos.length > 0;

    // 只有在非多來源模式下才清空並重新創建播放源按鈕
    if (!isMultiSourceMode) {
        const playlistSources = $('#playlistSources');
        playlistSources.innerHTML = '';
        state.modalData.forEach((source, index) => {
            const btn = document.createElement('button');
            btn.className = 'source-btn';
            btn.textContent = source.flag;
            if (index === sourceIndex) btn.classList.add('active');
            btn.onclick = () => renderPlaylist(index);
            playlistSources.appendChild(btn);
        });
    }

    const episodeList = $('#episodeList');
    episodeList.innerHTML = '';
    const currentSource = state.modalData[sourceIndex];
    if (currentSource && currentSource.episodes.length > 0) {
        currentSource.episodes.forEach(epi => {
            const item = document.createElement('div');
            item.className = 'episode-item';
            item.textContent = epi.name;
            item.onclick = () => playVideo(epi.url, item);
            episodeList.appendChild(item);
        });
        playVideo(currentSource.episodes[0].url, $('.episode-item'));
    } else {
        episodeList.innerHTML = '<p>此來源下沒有劇集。</p>';
        if (state.dplayer) { state.dplayer.destroy(); state.dplayer = null; }
        $('#dplayer').innerHTML = '';
    }
}

export function closeModal() {
    $('#videoModal').style.display = 'none';
    if (state.dplayer) {
        state.dplayer.destroy();
        state.dplayer = null;
    }
    state.modalData = null;
    state.multiSourceVideos = []; // 清空多來源影片列表
    state.currentSourceIndex = 0; // 重置來源索引
}

export function openSiteSelectionModal() {
    const list = $('#siteCheckboxList');
    list.innerHTML = '';
    // The 'sites' in the state are now pre-filtered and sorted.
    state.sites.forEach(site => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = site.id;
        checkbox.checked = state.searchSiteIds.includes(site.id);
        label.appendChild(checkbox);
        const displayName = site.note ? `${site.name} (${site.note})` : site.name;
        label.append(` ${displayName}`);
        list.appendChild(label);
    });
    $('#siteSelectionModal').style.display = 'flex';
}

export function closeSiteSelectionModal() {
    $('#siteSelectionModal').style.display = 'none';
}

export function getSelectedSiteIds() {
    return Array.from($$('#siteCheckboxList input:checked')).map(cb => parseInt(cb.value, 10));
}

export function toggleAllSites(select) {
    $$('#siteCheckboxList input').forEach(cb => cb.checked = select);
}

export function updateSelectedSitesDisplay() {
    const display = $('#selectedSites');
    if (state.searchSiteIds.length > 0) {
        const selectedNames = state.sites
            .filter(s => state.searchSiteIds.includes(s.id))
            .map(s => s.note ? `${s.name} (${s.note})` : s.name)
            .join(', ');
        display.textContent = `搜尋範圍: ${selectedNames}`;
    } else {
        display.textContent = '';
    }
}

export function showLoader(show) { $('#loader').style.display = show ? 'block' : 'none'; }
export function showError(msg) {
    const errorDiv = $('#error');
    if (msg) {
        errorDiv.textContent = `錯誤: ${msg}`;
        errorDiv.style.display = 'block';
    } else {
        errorDiv.style.display = 'none';
    }
}
