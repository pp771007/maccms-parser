import state from './state.js';
import { playVideo } from './player.js';
import { fetchVideoDetails } from './api.js';
import { $, $$ } from './utils.js';
import { showModal, showConfirm, showToast } from './modal.js';

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

        // 為不同類型的按鈕添加顏色
        if (text === '上一頁' || text === '下一頁') {
            btn.classList.add('btn', 'btn-outline-info');
        }

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
                showModal(`請輸入 1 到 ${totalPages} 之間的頁碼`, 'warning');
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
    document.body.classList.add('modal-open');
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
        // 保存原始影片資訊，包含影片ID
        state.currentVideo = video;
        renderPlaylist();
    } catch (err) {
        $('#episodeList').innerHTML = `<p style="color:red;">獲取播放列表失敗: ${err.message}</p>`;
    }
}

// 新增多來源影片的modal
export async function openMultiSourceModal(videoName, videoList) {
    document.body.classList.add('modal-open');
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
                // 保存當前選擇的影片資訊
                state.currentVideo = video;
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
            item.onclick = () => {
                const videoInfo = {
                    videoId: state.currentVideo?.vod_id || epi.vod_id,
                    videoName: $('#modalTitle').textContent,
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    siteId: state.currentSite?.id || state.multiSourceVideos?.[state.currentSourceIndex]?.from_site_id,
                    siteName: state.currentSite?.name || state.multiSourceVideos?.[state.currentSourceIndex]?.from_site
                };
                playVideo(epi.url, item, videoInfo);
            };
            episodeList.appendChild(item);
        });

        // 自動播放第一個劇集
        const firstEpisode = episodeList.firstElementChild;
        if (firstEpisode) {
            const videoInfo = {
                videoId: state.currentVideo?.vod_id || currentSource.episodes[0]?.vod_id,
                videoName: $('#modalTitle').textContent,
                episodeName: currentSource.episodes[0].name,
                episodeUrl: currentSource.episodes[0].url,
                siteId: state.currentSite?.id || state.multiSourceVideos?.[state.currentSourceIndex]?.from_site_id,
                siteName: state.currentSite?.name || state.multiSourceVideos?.[state.currentSourceIndex]?.from_site
            };
            playVideo(currentSource.episodes[0].url, firstEpisode, videoInfo);
        }
    } else {
        episodeList.innerHTML = '<p>此來源下沒有劇集。</p>';
        if (state.artplayer) { state.artplayer.destroy(); state.artplayer = null; }
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
            item.onclick = () => {
                const videoInfo = {
                    videoId: state.currentVideo?.vod_id,
                    videoName: $('#modalTitle').textContent,
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    siteId: state.currentSite?.id || state.multiSourceVideos?.[state.currentSourceIndex]?.from_site_id,
                    siteName: state.currentSite?.name || state.multiSourceVideos?.[state.currentSourceIndex]?.from_site
                };
                playVideo(epi.url, item, videoInfo);
            };
            episodeList.appendChild(item);
        });

        // 自動播放第一個劇集
        const firstEpisode = episodeList.firstElementChild;
        if (firstEpisode) {
            const videoInfo = {
                videoId: state.currentVideo?.vod_id,
                videoName: $('#modalTitle').textContent,
                episodeName: currentSource.episodes[0].name,
                episodeUrl: currentSource.episodes[0].url,
                siteId: state.currentSite?.id || state.multiSourceVideos?.[state.currentSourceIndex]?.from_site_id,
                siteName: state.currentSite?.name || state.multiSourceVideos?.[state.currentSourceIndex]?.from_site
            };
            playVideo(currentSource.episodes[0].url, firstEpisode, videoInfo);
        }
    } else {
        episodeList.innerHTML = '<p>此來源下沒有劇集。</p>';
        if (state.artplayer) { state.artplayer.destroy(); state.artplayer = null; }
    }
}

export function closeModal() {
    document.body.classList.remove('modal-open');
    $('#videoModal').style.display = 'none';
    if (state.artplayer) {
        state.artplayer.destroy();
        state.artplayer = null;
    }
    state.modalData = null;
    state.multiSourceVideos = []; // 清空多來源影片列表
    state.currentSourceIndex = 0; // 重置來源索引
    state.currentVideo = null; // 重置當前影片資訊
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



// 新增歷史紀錄相關功能
export function renderWatchHistory() {
    const historyContainer = $('#watchHistoryContainer');
    if (!historyContainer) return;

    if (state.watchHistory.length === 0) {
        historyContainer.innerHTML = '<p class="no-history">暫無觀看歷史</p>';
        return;
    }

    historyContainer.innerHTML = '';

    state.watchHistory.forEach((item, index) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';

        // 計算播放進度百分比
        const progressPercent = item.duration > 0 ?
            Math.round((item.currentTime / item.duration) * 100) : 0;

        // 格式化時間
        const formatTime = (seconds) => {
            if (!seconds || seconds <= 0) return '00:00';
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);

            if (hours > 0) {
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
            return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        };

        // 格式化時間戳
        const formatDate = (timestamp) => {
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;

            if (diff < 60000) return '剛剛';
            if (diff < 3600000) return `${Math.floor(diff / 60000)}分鐘前`;
            if (diff < 86400000) return `${Math.floor(diff / 3600000)}小時前`;
            if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

            return date.toLocaleDateString('zh-TW');
        };

        historyItem.innerHTML = `
            <div class="history-info">
                <div class="history-title" title="${item.videoName}">${item.videoName}</div>
                <div class="history-episode">${item.episodeName || '未知劇集'}</div>
                <div class="history-site">${item.siteName || '未知站台'}</div>
                <div class="history-time">${formatDate(item.lastWatched || item.timestamp)}</div>
            </div>
            <div class="history-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progressPercent}%"></div>
                </div>
                <div class="progress-text">${formatTime(item.currentTime)} / ${formatTime(item.duration)}</div>
            </div>
            <div class="history-actions">
                <button class="btn btn-primary btn-sm continue-btn" title="繼續觀看">繼續觀看</button>
                <button class="btn btn-danger btn-sm remove-btn" title="移除紀錄">×</button>
            </div>
        `;

        // 繼續觀看按鈕事件
        const continueBtn = historyItem.querySelector('.continue-btn');
        continueBtn.addEventListener('click', async () => {
            try {
                // 獲取站台資訊
                const site = state.sites.find(s => s.id === item.siteId);
                if (!site) {
                    showModal('找不到對應的站台資訊', 'error');
                    return;
                }

                // 獲取影片詳細資訊
                const result = await fetchVideoDetails(site.url, item.videoId);
                state.modalData = result.data;
                // 保存原始影片資訊
                state.currentVideo = { vod_id: item.videoId, vod_name: item.videoName };

                // 打開播放器並定位到對應劇集
                openHistoryVideoModal(item, result.data);
            } catch (err) {
                showModal(`無法載入影片: ${err.message}`, 'error');
            }
        });

        // 移除紀錄按鈕事件
        const removeBtn = historyItem.querySelector('.remove-btn');
        removeBtn.addEventListener('click', () => {
            state.watchHistory.splice(index, 1);
            state.saveWatchHistory();
            renderWatchHistory();
            showToast('已移除觀看紀錄');
        });

        historyContainer.appendChild(historyItem);
    });
}

// 打開歷史紀錄影片的播放器
export function openHistoryVideoModal(historyItem, modalData) {
    document.body.classList.add('modal-open');
    $('#modalTitle').textContent = historyItem.videoName;
    $('#videoModal').style.display = 'flex';
    $('#playlistSources').innerHTML = '';
    $('#episodeList').innerHTML = '正在載入...';

    // 設置當前影片資訊
    state.currentVideo = { vod_id: historyItem.videoId, vod_name: historyItem.videoName };

    // 渲染播放源按鈕
    const playlistSources = $('#playlistSources');
    playlistSources.innerHTML = '';

    modalData.forEach((source, index) => {
        const btn = document.createElement('button');
        btn.className = 'source-btn';
        btn.textContent = source.flag;
        btn.dataset.index = index;
        btn.onclick = () => renderHistoryEpisodes(historyItem, modalData, index);
        playlistSources.appendChild(btn);
    });

    // 找到對應的播放源並自動選擇
    const targetSourceIndex = findTargetSourceIndex(historyItem, modalData);
    if (targetSourceIndex >= 0) {
        playlistSources.children[targetSourceIndex].click();
    } else if (modalData.length > 0) {
        playlistSources.firstElementChild.click();
    }
}

// 渲染歷史紀錄的劇集列表
function renderHistoryEpisodes(historyItem, modalData, sourceIndex) {
    // 更新按鈕狀態
    $$('.source-btn').forEach(b => b.classList.remove('active'));
    // 找到對應的按鈕並設置為active
    const targetBtn = document.querySelector(`[data-index="${sourceIndex}"]`);
    if (targetBtn) {
        targetBtn.classList.add('active');
    }

    const episodeList = $('#episodeList');
    episodeList.innerHTML = '';

    const currentSource = modalData[sourceIndex];
    if (currentSource && currentSource.episodes.length > 0) {
        currentSource.episodes.forEach((epi, epiIndex) => {
            const item = document.createElement('div');
            item.className = 'episode-item';
            item.textContent = epi.name;

            // 檢查是否為目標劇集
            const isTargetEpisode = epi.url === historyItem.episodeUrl;
            if (isTargetEpisode) {
                item.classList.add('target-episode');
            }

            item.onclick = () => {
                const videoInfo = {
                    videoId: historyItem.videoId,
                    videoName: historyItem.videoName,
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    siteId: historyItem.siteId,
                    siteName: historyItem.siteName,
                    currentTime: isTargetEpisode ? historyItem.currentTime : 0,
                    duration: historyItem.duration
                };

                playVideo(epi.url, item, videoInfo);

                // 如果是目標劇集且有播放進度，設置播放位置
                if (isTargetEpisode && historyItem.currentTime > 0) {
                    setTimeout(() => {
                        if (state.artplayer) {
                            state.artplayer.currentTime = historyItem.currentTime;
                        }
                    }, 1000);
                }
            };

            episodeList.appendChild(item);
        });

        // 自動播放第一個劇集
        const firstEpisode = episodeList.firstElementChild;
        if (firstEpisode) {
            firstEpisode.click();
        }
    } else {
        episodeList.innerHTML = '<p>此來源下沒有劇集。</p>';
    }
}

// 找到目標播放源的索引
function findTargetSourceIndex(historyItem, modalData) {
    for (let i = 0; i < modalData.length; i++) {
        const source = modalData[i];
        const hasTargetEpisode = source.episodes.some(epi => epi.url === historyItem.episodeUrl);
        if (hasTargetEpisode) {
            return i;
        }
    }
    return -1;
}

// 顯示歷史紀錄面板
export function showHistoryPanel() {
    const historyPanel = $('#historyPanel');
    const historyOverlay = $('#historyOverlay');
    if (historyPanel && historyOverlay) {
        historyOverlay.style.display = 'block';
        historyPanel.style.display = 'flex';
        renderWatchHistory();

        // 推入新的歷史狀態，以便返回鍵能正確關閉面板
        window.history.pushState({ panel: 'history' }, null, window.location.href);

        // 重新綁定清除按鈕事件
        const clearHistoryBtn = $('#clearHistoryBtn');
        if (clearHistoryBtn) {
            clearHistoryBtn.onclick = clearAllHistory;
        }

        const closeHistoryBtn = $('#closeHistoryBtn');
        if (closeHistoryBtn) {
            closeHistoryBtn.onclick = hideHistoryPanel;
        }

        // 防止滾動傳播到外部頁面
        const historyContainer = $('#watchHistoryContainer');
        if (historyContainer) {
            historyContainer.addEventListener('wheel', (e) => {
                e.stopPropagation();
            }, { passive: false });

            historyContainer.addEventListener('touchmove', (e) => {
                e.stopPropagation();
            }, { passive: false });
        }
    }
}

// 隱藏歷史紀錄面板
export function hideHistoryPanel() {
    const historyPanel = $('#historyPanel');
    const historyOverlay = $('#historyOverlay');
    if (historyPanel && historyOverlay) {
        // 立即隱藏覆蓋層，避免閃爍
        historyOverlay.style.display = 'none';

        // 添加關閉動畫類
        historyPanel.classList.add('closing');

        // 監聽動畫結束事件
        const handleAnimationEnd = () => {
            historyPanel.style.display = 'none';
            historyPanel.classList.remove('closing');
            historyPanel.removeEventListener('animationend', handleAnimationEnd);
        };

        historyPanel.addEventListener('animationend', handleAnimationEnd);

        // 如果當前歷史狀態是歷史面板，則返回上一頁
        if (window.history.state && window.history.state.panel === 'history') {
            window.history.back();
        }
    }
}

// 清除所有歷史紀錄
export function clearAllHistory() {
    showConfirm('確定要清除所有觀看歷史嗎？此操作無法復原。', () => {
        state.clearHistory();
        renderWatchHistory();
        showToast('已清除所有觀看歷史');
    }, '請確認', 'warning');
}
