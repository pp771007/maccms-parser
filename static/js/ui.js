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

    console.log('影片聚合結果:', {
        totalVideos: videos.length,
        groupedVideos: Object.entries(groupedVideos).map(([name, list]) => ({
            name,
            count: list.length,
            videos: list.map(v => ({ id: v.vod_id, from_site: v.from_site, from_site_id: v.from_site_id }))
        }))
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
            console.log('影片卡片點擊:', {
                videoName,
                videoListLength: videoList.length,
                videoList: videoList.map(v => ({ id: v.vod_id, from_site: v.from_site, from_site_id: v.from_site_id })),
                isMultiSiteSearch: state.searchSiteIds.length > 0
            });

            // 在多站點搜尋模式下，即使只有一個結果也使用 openMultiSourceModal
            // 這樣可以確保站台信息正確傳遞
            if (videoList.length > 1 || state.searchSiteIds.length > 0) {
                console.log('調用 openMultiSourceModal');
                openMultiSourceModal(videoName, videoList);
            } else {
                console.log('調用 openModal');
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

// 渲染搜尋關鍵字標籤
export function renderSearchTags() {
    const searchTagsContainer = $('#searchTagsContainer');
    if (!searchTagsContainer) return;

    if (!state.searchHistory || state.searchHistory.length === 0) {
        searchTagsContainer.innerHTML = '';
        return;
    }

    searchTagsContainer.innerHTML = '';

    // 創建標籤容器
    const tagsWrapper = document.createElement('div');
    tagsWrapper.className = 'search-tags-wrapper';

    // 添加標題
    const title = document.createElement('div');
    title.className = 'search-tags-title';
    title.textContent = '最近搜尋:';
    tagsWrapper.appendChild(title);

    // 創建標籤列表
    const tagsList = document.createElement('div');
    tagsList.className = 'search-tags-list';

    state.searchHistory.forEach((keyword, index) => {
        const tag = document.createElement('span');
        tag.className = 'search-tag';
        tag.textContent = keyword;
        tag.title = `點擊搜尋: ${keyword}`;

        // 點擊標籤進行搜尋
        tag.addEventListener('click', () => {
            $('#searchInput').value = keyword;
            // 觸發搜尋
            const searchBtn = $('#searchBtn');
            if (searchBtn) {
                searchBtn.click();
            }
        });

        // 添加刪除按鈕
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'search-tag-delete';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = '刪除此關鍵字';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 防止觸發標籤點擊事件
            state.searchHistory.splice(index, 1);
            state.saveSearchHistory();
            renderSearchTags();
        });

        tag.appendChild(deleteBtn);
        tagsList.appendChild(tag);
    });

    // 添加清除全部按鈕
    if (state.searchHistory.length > 1) {
        const clearAllBtn = document.createElement('span');
        clearAllBtn.className = 'search-tag-clear-all';
        clearAllBtn.textContent = '清除全部';
        clearAllBtn.title = '清除所有搜尋記錄';
        clearAllBtn.addEventListener('click', () => {
            state.clearSearchHistory();
            renderSearchTags();
        });
        tagsList.appendChild(clearAllBtn);
    }

    tagsWrapper.appendChild(tagsList);
    searchTagsContainer.appendChild(tagsWrapper);
}

export async function openModal(video) {
    console.log('openModal 開始，當前 multiSourceVideos:', state.multiSourceVideos);

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
        console.error('獲取播放列表失敗:', err);
        console.error('錯誤詳情:', {
            videoId: video.vod_id,
            videoName: video.vod_name,
            fromSiteId: video.from_site_id,
            currentSite: state.currentSite?.name,
            availableSites: state.sites.map(s => ({ id: s.id, name: s.name, url: s.url }))
        });

        let errorMessage = `獲取播放列表失敗: ${err.message}`;
        if (err.message.includes('網絡') || err.message.includes('連接')) {
            errorMessage += '\n\n可能的原因：\n• 站台已失效或無法訪問\n• 網絡連接問題\n• 站台API格式已變更';
        } else if (err.message.includes('JSON') || err.message.includes('格式')) {
            errorMessage += '\n\n可能的原因：\n• 站台API返回無效數據\n• 站台已失效或需要登錄\n• 站台API格式已變更';
        }

        $('#episodeList').innerHTML = `<p style="color:red;">${errorMessage}</p>`;
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
    // 初始化多來源的 modalData 存儲
    state.multiSourceModalData = {};

    console.log('openMultiSourceModal 設置 multiSourceVideos:', {
        videoName,
        videoListLength: videoList.length,
        multiSourceVideos: videoList.map(v => ({ id: v.vod_id, from_site: v.from_site, from_site_id: v.from_site_id })),
        stateMultiSourceVideos: state.multiSourceVideos
    });

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

                // 在多來源模式下，為每個來源分別存儲 modalData
                if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                    state.multiSourceModalData[index] = result.data;
                    state.modalData = result.data; // 設置當前來源的 modalData
                } else {
                    state.modalData = result.data;
                }

                state.currentSourceIndex = index;
                // 保存當前選擇的影片資訊
                state.currentVideo = video;

                console.log('多站點模式切換來源:', {
                    index,
                    video,
                    modalData: result.data,
                    modalDataLength: result.data?.length,
                    currentSourceIndex: state.currentSourceIndex,
                    multiSourceModalData: state.multiSourceModalData,
                    multiSourceVideos: state.multiSourceVideos?.map(v => ({ id: v.vod_id, from_site: v.from_site, from_site_id: v.from_site_id }))
                });

                // 檢查 modalData 是否有效
                if (!result.data || result.data.length === 0) {
                    console.error('modalData 為空或無效:', result);
                    $('#episodeList').innerHTML = '<p style="color:red;">獲取播放列表失敗：返回的數據為空</p>';
                    return;
                }

                // 使用renderPlaylist來顯示播放列表，傳遞正確的來源索引
                renderPlaylist(index);
            } catch (err) {
                console.error('多來源獲取播放列表失敗:', err);
                console.error('錯誤詳情:', {
                    videoId: video.vod_id,
                    videoName: video.vod_name,
                    fromSiteId: video.from_site_id,
                    fromSite: video.from_site,
                    currentSite: state.currentSite?.name,
                    availableSites: state.sites.map(s => ({ id: s.id, name: s.name, url: s.url }))
                });

                let errorMessage = `獲取播放列表失敗: ${err.message}`;
                if (err.message.includes('網絡') || err.message.includes('連接')) {
                    errorMessage += '\n\n可能的原因：\n• 站台已失效或無法訪問\n• 網絡連接問題\n• 站台API格式已變更';
                } else if (err.message.includes('JSON') || err.message.includes('格式')) {
                    errorMessage += '\n\n可能的原因：\n• 站台API返回無效數據\n• 站台已失效或需要登錄\n• 站台API格式已變更';
                }

                $('#episodeList').innerHTML = `<p style="color:red;">${errorMessage}</p>`;
            }
        };
        playlistSources.appendChild(btn);
    });

    // 自動選擇第一個來源
    if (videoList.length > 0) {
        // 確保 state.multiSourceVideos 已經設置後再點擊第一個來源
        console.log('準備自動點擊第一個來源，當前 multiSourceVideos:', state.multiSourceVideos);

        // 使用 requestAnimationFrame 確保 DOM 更新完成後再點擊
        requestAnimationFrame(() => {
            console.log('執行自動點擊，當前 multiSourceVideos:', state.multiSourceVideos);
            if (playlistSources.firstElementChild) {
                playlistSources.firstElementChild.click();
            }
        });
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
                // 改進站台信息獲取邏輯
                let siteId = null;
                let siteName = null;

                // 在多站點模式下，優先使用多來源影片的站台信息
                if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                    const currentVideo = state.multiSourceVideos[state.currentSourceIndex];
                    if (currentVideo) {
                        siteId = currentVideo.from_site_id;
                        siteName = currentVideo.from_site;
                    }
                }

                // 如果沒有多來源信息，使用當前站台
                if (!siteId && state.currentSite) {
                    siteId = state.currentSite.id;
                    siteName = state.currentSite.name;
                    console.log('renderEpisodesOnly 使用當前站台信息:', { siteId, siteName });
                }

                // 如果還是沒有，嘗試從站台列表中查找
                if (!siteId && state.sites.length > 0) {
                    const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
                    if (validSites.length > 0) {
                        siteId = validSites[0].id;
                        siteName = validSites[0].name;
                        console.log('renderEpisodesOnly 使用站台列表第一個站台:', { siteId, siteName });
                    }
                }

                const videoInfo = {
                    videoId: state.currentVideo?.vod_id || epi.vod_id,
                    videoName: $('#modalTitle').textContent,
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    siteId: siteId,
                    siteName: siteName || '未知站台'
                };

                console.log('renderEpisodesOnly 構造 videoInfo:', {
                    videoInfo,
                    currentSourceIndex: state.currentSourceIndex,
                    multiSourceVideos: state.multiSourceVideos?.map(v => ({ id: v.vod_id, from_site: v.from_site, from_site_id: v.from_site_id })),
                    currentSite: state.currentSite ? { id: state.currentSite.id, name: state.currentSite.name } : null,
                    availableSites: state.sites.length
                });

                playVideo(epi.url, item, videoInfo);
            };
            episodeList.appendChild(item);
        });

        // 只在首次載入時自動播放第一個劇集，切換資源時不自動播放
        const firstEpisode = episodeList.firstElementChild;
        if (firstEpisode && !state.artplayer) {
            // 使用相同的站台信息獲取邏輯
            let siteId = null;
            let siteName = null;

            // 在多站點模式下，優先使用多來源影片的站台信息
            if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                const currentVideo = state.multiSourceVideos[state.currentSourceIndex];
                console.log('renderEpisodesOnly 多站點模式獲取站台信息:', {
                    currentSourceIndex: state.currentSourceIndex,
                    currentVideo: currentVideo ? {
                        id: currentVideo.vod_id,
                        from_site: currentVideo.from_site,
                        from_site_id: currentVideo.from_site_id
                    } : null
                });
                if (currentVideo) {
                    siteId = currentVideo.from_site_id;
                    siteName = currentVideo.from_site;
                    console.log('renderEpisodesOnly 從多來源影片獲取站台信息:', { siteId, siteName });
                }
            }

            // 如果沒有多來源信息，使用當前站台
            if (!siteId && state.currentSite) {
                siteId = state.currentSite.id;
                siteName = state.currentSite.name;
                console.log('renderEpisodesOnly auto-play 使用當前站台信息:', { siteId, siteName });
            }

            // 如果還是沒有，嘗試從站台列表中查找
            if (!siteId && state.sites.length > 0) {
                const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
                if (validSites.length > 0) {
                    siteId = validSites[0].id;
                    siteName = validSites[0].name;
                    console.log('renderEpisodesOnly auto-play 使用站台列表第一個站台:', { siteId, siteName });
                }
            }

            const videoInfo = {
                videoId: state.currentVideo?.vod_id || currentSource.episodes[0]?.vod_id,
                videoName: $('#modalTitle').textContent,
                episodeName: currentSource.episodes[0].name,
                episodeUrl: currentSource.episodes[0].url,
                siteId: siteId,
                siteName: siteName || '未知站台'
            };
            console.log('renderEpisodesOnly auto-play videoInfo:', videoInfo);
            playVideo(currentSource.episodes[0].url, firstEpisode, videoInfo);
        }
    } else {
        episodeList.innerHTML = '<p>此來源下沒有劇集。</p>';
        if (state.artplayer) {
            // 保存進度後再銷毀
            state.saveCurrentProgress();
            state.artplayer.destroy();
            state.artplayer = null;
        }
    }
}

function renderPlaylist(sourceIndex = 0) {
    console.log('renderPlaylist 開始執行:', {
        sourceIndex,
        modalData: state.modalData,
        multiSourceVideos: state.multiSourceVideos,
        currentSourceIndex: state.currentSourceIndex
    });

    if (!state.modalData || state.modalData.length === 0) {
        $('#episodeList').innerHTML = '<p>沒有可用的播放源。</p>';
        return;
    }

    // 檢查是否為多來源模式
    const isMultiSourceMode = state.multiSourceVideos && state.multiSourceVideos.length > 0;
    console.log('多來源模式檢查:', { isMultiSourceMode, multiSourceVideosLength: state.multiSourceVideos?.length });

    // 如果 multiSourceVideos 是 undefined 但我們在模態框中，嘗試從 DOM 中獲取多來源信息
    if (!isMultiSourceMode && state.multiSourceVideos === undefined && $('#playlistSources').children.length > 1) {
        console.log('檢測到多來源模式但 multiSourceVideos 未設置，嘗試從 DOM 恢復');
        // 這裡可以嘗試從其他地方恢復多來源信息
    }

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
    } else {
        // 在多來源模式下，確保當前選擇的來源按鈕是激活狀態
        $$('.source-btn').forEach((btn, index) => {
            if (index === sourceIndex) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    const episodeList = $('#episodeList');
    episodeList.innerHTML = '';

    // 在多來源模式下，使用對應來源的 modalData
    let modalDataToUse = state.modalData;
    if (state.multiSourceVideos && state.multiSourceVideos.length > 0 && state.multiSourceModalData) {
        modalDataToUse = state.multiSourceModalData[sourceIndex] || state.modalData;
    }

    console.log('renderPlaylist 檢查 modalData:', {
        sourceIndex,
        modalDataLength: modalDataToUse?.length,
        modalData: modalDataToUse,
        currentSource: modalDataToUse?.[0], // 在多來源模式下，每個來源的 modalData 只有一個元素
        multiSourceModalData: state.multiSourceModalData
    });

    const currentSource = modalDataToUse?.[0]; // 在多來源模式下，每個來源的 modalData 只有一個元素
    if (currentSource && currentSource.episodes && currentSource.episodes.length > 0) {
        currentSource.episodes.forEach(epi => {
            const item = document.createElement('div');
            item.className = 'episode-item';
            item.textContent = epi.name;
            item.onclick = () => {
                // 改進站台信息獲取邏輯
                let siteId = null;
                let siteName = null;

                // 在多站點模式下，優先使用多來源影片的站台信息
                if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                    // 使用傳入的 sourceIndex 而不是 state.currentSourceIndex
                    const currentVideo = state.multiSourceVideos[sourceIndex];
                    console.log('多站點模式獲取站台信息:', {
                        sourceIndex,
                        currentVideo: currentVideo ? {
                            id: currentVideo.vod_id,
                            from_site: currentVideo.from_site,
                            from_site_id: currentVideo.from_site_id
                        } : null,
                        allMultiSourceVideos: state.multiSourceVideos.map(v => ({
                            id: v.vod_id,
                            from_site: v.from_site,
                            from_site_id: v.from_site_id
                        }))
                    });
                    if (currentVideo) {
                        siteId = currentVideo.from_site_id;
                        siteName = currentVideo.from_site;
                        console.log('從多來源影片獲取站台信息:', { siteId, siteName });
                    }
                }

                // 如果沒有多來源信息，使用當前站台
                if (!siteId && state.currentSite) {
                    siteId = state.currentSite.id;
                    siteName = state.currentSite.name;
                    console.log('renderPlaylist 使用當前站台信息:', { siteId, siteName });
                }

                // 如果還是沒有，嘗試從站台列表中查找
                if (!siteId && state.sites.length > 0) {
                    const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
                    if (validSites.length > 0) {
                        siteId = validSites[0].id;
                        siteName = validSites[0].name;
                        console.log('renderPlaylist 使用站台列表第一個站台:', { siteId, siteName });
                    }
                }

                // 在多站點模式下，優先使用多來源影片的影片ID
                let videoId = state.currentVideo?.vod_id;
                if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                    const currentVideo = state.multiSourceVideos[sourceIndex];
                    if (currentVideo) {
                        videoId = currentVideo.vod_id;
                    }
                }

                const videoInfo = {
                    videoId: videoId,
                    videoName: $('#modalTitle').textContent,
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    siteId: siteId,
                    siteName: siteName || '未知站台'
                };

                console.log('renderPlaylist videoInfo:', {
                    videoInfo,
                    sourceIndex,
                    currentSourceIndex: state.currentSourceIndex,
                    currentVideo: state.currentVideo ? { id: state.currentVideo.vod_id, from_site: state.currentVideo.from_site, from_site_id: state.currentVideo.from_site_id } : null,
                    multiSourceVideos: state.multiSourceVideos?.map(v => ({ id: v.vod_id, from_site: v.from_site, from_site_id: v.from_site_id }))
                });

                playVideo(epi.url, item, videoInfo);
            };
            episodeList.appendChild(item);
        });

        // 只在首次載入時自動播放第一個劇集，切換資源時不自動播放
        const firstEpisode = episodeList.firstElementChild;
        if (firstEpisode && !state.artplayer) {
            // 使用相同的站台信息獲取邏輯
            let siteId = null;
            let siteName = null;

            // 在多站點模式下，優先使用多來源影片的站台信息
            if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                // 使用傳入的 sourceIndex 而不是 state.currentSourceIndex
                const currentVideo = state.multiSourceVideos[sourceIndex];
                if (currentVideo) {
                    siteId = currentVideo.from_site_id;
                    siteName = currentVideo.from_site;
                }
            }

            // 如果沒有多來源信息，使用當前站台
            if (!siteId && state.currentSite) {
                siteId = state.currentSite.id;
                siteName = state.currentSite.name;
                console.log('renderPlaylist auto-play 使用當前站台信息:', { siteId, siteName });
            }

            // 如果還是沒有，嘗試從站台列表中查找
            if (!siteId && state.sites.length > 0) {
                const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
                if (validSites.length > 0) {
                    siteId = validSites[0].id;
                    siteName = validSites[0].name;
                    console.log('renderPlaylist auto-play 使用站台列表第一個站台:', { siteId, siteName });
                }
            }

            // 在多站點模式下，優先使用多來源影片的影片ID
            let videoId = state.currentVideo?.vod_id;
            if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                const currentVideo = state.multiSourceVideos[sourceIndex];
                if (currentVideo) {
                    videoId = currentVideo.vod_id;
                }
            }

            const videoInfo = {
                videoId: videoId,
                videoName: $('#modalTitle').textContent,
                episodeName: currentSource.episodes[0].name,
                episodeUrl: currentSource.episodes[0].url,
                siteId: siteId,
                siteName: siteName || '未知站台'
            };

            console.log('renderPlaylist auto-play videoInfo:', {
                videoInfo,
                sourceIndex,
                currentSourceIndex: state.currentSourceIndex,
                currentVideo: state.currentVideo ? { id: state.currentVideo.vod_id, from_site: state.currentVideo.from_site, from_site_id: state.currentVideo.from_site_id } : null,
                multiSourceVideos: state.multiSourceVideos?.map(v => ({ id: v.vod_id, from_site: v.from_site, from_site_id: v.from_site_id }))
            });

            playVideo(currentSource.episodes[0].url, firstEpisode, videoInfo);
        }
    } else {
        episodeList.innerHTML = '<p>此來源下沒有劇集。</p>';
        if (state.artplayer) {
            // 保存進度後再銷毀
            state.saveCurrentProgress();
            state.artplayer.destroy();
            state.artplayer = null;
        }
    }
}

export function closeModal() {
    // 在關閉前保存當前進度
    state.saveCurrentProgress();

    console.log('closeModal 清空 multiSourceVideos:', state.multiSourceVideos);

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
    state.multiSourceModalData = {}; // 清理多來源 modalData
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
    if (!historyContainer) {
        console.error('找不到歷史紀錄容器元素');
        return;
    }

    console.log('渲染歷史紀錄 - 當前歷史紀錄數量:', state.watchHistory.length);
    console.log('當前歷史紀錄:', state.watchHistory);

    // 清理無效的歷史紀錄（站台不存在的記錄）
    if (state.sites && state.sites.length > 0) {
        const originalLength = state.watchHistory.length;
        state.watchHistory = state.watchHistory.filter(item => {
            // 保留有站台名稱的記錄，或者站台ID在當前站台列表中的記錄
            // 或者有站台ID但站台名稱為null的記錄（可能是舊的歷史紀錄格式）
            const hasValidSite = item.siteName ||
                state.sites.some(s => s.id === item.siteId || s.name === item.siteName) ||
                (item.siteId && item.siteName === null); // 允許siteName為null但有siteId的記錄

            if (!hasValidSite) {
                console.log('清理無效歷史紀錄:', item);
            }

            return hasValidSite;
        });
        if (originalLength !== state.watchHistory.length) {
            console.log('清理了', originalLength - state.watchHistory.length, '條無效歷史紀錄');
            state.saveWatchHistory();
        }

        // 修復歷史紀錄中的站台信息
        state.watchHistory.forEach(item => {
            if (!item.siteName || item.siteName === '未知站台') {
                // 嘗試根據 siteId 找到對應的站台名稱
                const site = state.sites.find(s => s.id === item.siteId);
                if (site) {
                    item.siteName = site.name;
                    console.log('修復歷史紀錄站台信息:', {
                        videoId: item.videoId,
                        oldSiteName: '未知站台',
                        newSiteName: site.name,
                        siteId: item.siteId
                    });
                }
            }
        });

        // 標記無效的歷史紀錄（站台已不存在）
        const invalidHistoryItems = [];
        state.watchHistory.forEach((item, index) => {
            const site = state.sites.find(s => s.id === item.siteId);
            if (!site) {
                invalidHistoryItems.push({
                    index,
                    item,
                    reason: '站台已不存在'
                });
            }
        });

        if (invalidHistoryItems.length > 0) {
            console.log('發現無效歷史紀錄:', invalidHistoryItems);
        }
    }

    if (state.watchHistory.length === 0) {
        console.log('歷史紀錄為空，顯示「暫無觀看歷史」');
        historyContainer.innerHTML = `
            <p class="no-history">暫無觀看歷史</p>
            <div style="text-align: center; margin-top: 20px;">
                <button onclick="window.addTestHistory()" style="background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                    添加測試歷史紀錄
                </button>
            </div>
        `;
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
                <div class="history-site">${item.siteName || (item.siteId ? (state.sites.find(s => s.id === item.siteId)?.name || state.sites.find(s => s.name === item.siteName)?.name || '未知站台') : (state.sites.find(s => s.name === item.siteName)?.name || '未知站台'))}</div>
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
                // 獲取站台資訊 - 改進邏輯以處理站台ID不匹配的情況
                let site = state.sites.find(s => s.id === item.siteId);

                // 如果找不到對應的站台，嘗試使用站台名稱查找
                if (!site && item.siteName) {
                    site = state.sites.find(s => s.name === item.siteName);
                }

                // 如果還是找不到，嘗試使用第一個可用的站台
                if (!site && state.sites.length > 0) {
                    // 過濾掉無效的站台
                    const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
                    if (validSites.length > 0) {
                        site = validSites[0];
                        console.warn(`找不到歷史紀錄中的站台 (ID: ${item.siteId}, Name: ${item.siteName})，使用第一個可用站台: ${site.name}`);
                        console.log('當前可用站台列表:', validSites.map(s => ({ id: s.id, name: s.name, url: s.url })));
                    }
                }

                if (!site) {
                    showModal('找不到可用的站台資訊，請檢查站台設定', 'error');
                    return;
                }

                // 檢查站台是否仍然有效
                if (!site.url || site.url.trim() === '') {
                    showModal(`站台 "${site.name}" 的URL無效，請檢查站台設定`, 'error');
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
                console.error('歷史紀錄載入影片失敗:', err);
                console.error('錯誤詳情:', {
                    videoId: item.videoId,
                    videoName: item.videoName,
                    siteId: item.siteId,
                    siteName: item.siteName,
                    availableSites: state.sites.map(s => ({ id: s.id, name: s.name, url: s.url }))
                });

                let errorMessage = `無法載入影片: ${err.message}`;
                if (err.message.includes('網絡') || err.message.includes('連接')) {
                    errorMessage += '\n\n可能的原因：\n• 站台已失效或無法訪問\n• 網絡連接問題\n• 站台API格式已變更';
                } else if (err.message.includes('JSON') || err.message.includes('格式')) {
                    errorMessage += '\n\n可能的原因：\n• 站台API返回無效數據\n• 站台已失效或需要登錄\n• 站台API格式已變更';
                } else if (err.message.includes('未返回有效的') || err.message.includes('List')) {
                    errorMessage += '\n\n可能的原因：\n• 影片已從站台移除\n• 站台API格式已變更\n• 站台需要登錄或已失效\n\n建議：\n• 嘗試其他站台搜尋相同影片\n• 或從歷史紀錄中移除此項目';

                    // 提供選項讓用戶嘗試在其他站台搜尋
                    const searchInOtherSites = confirm(`${errorMessage}\n\n是否要在其他站台搜尋 "${item.videoName}"？`);
                    if (searchInOtherSites) {
                        // 關閉歷史面板
                        hideHistoryPanel();
                        // 填入搜尋關鍵字
                        $('#searchInput').value = item.videoName;
                        // 觸發搜尋
                        const searchBtn = $('#searchBtn');
                        if (searchBtn) {
                            searchBtn.click();
                        }
                    }
                    return;
                }

                showModal(errorMessage, 'error');
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
                    siteName: historyItem.siteName || (historyItem.siteId ? state.sites.find(s => s.id === historyItem.siteId)?.name : '未知站台')
                };

                // 如果是目標劇集且有播放進度，傳遞 historyItem 給 playVideo
                console.log('播放劇集:', {
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    isTargetEpisode,
                    historyItemEpisodeUrl: historyItem.episodeUrl,
                    historyItemCurrentTime: historyItem.currentTime,
                    willPassHistoryItem: isTargetEpisode && historyItem.currentTime > 0
                });

                if (isTargetEpisode && historyItem.currentTime > 0) {
                    console.log('傳遞 historyItem 給 playVideo');
                    playVideo(epi.url, item, videoInfo, historyItem);
                } else {
                    console.log('不傳遞 historyItem 給 playVideo');
                    playVideo(epi.url, item, videoInfo);
                }
            };

            episodeList.appendChild(item);
        });

        // 自動播放目標劇集或第一個劇集
        let targetEpisode = null;

        // 查找目標劇集
        for (let i = 0; i < currentSource.episodes.length; i++) {
            if (currentSource.episodes[i].url === historyItem.episodeUrl) {
                targetEpisode = episodeList.children[i];
                break;
            }
        }

        // 如果找到目標劇集，播放目標劇集；否則播放第一個劇集
        const episodeToPlay = targetEpisode || episodeList.firstElementChild;
        if (episodeToPlay) {
            episodeToPlay.click();
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

        // 設置歷史記錄更新回調
        state.onHistoryUpdate = renderWatchHistory;

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
        // 清除歷史記錄更新回調
        state.onHistoryUpdate = null;

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

// 添加測試歷史紀錄（僅用於調試）
export function addTestHistory() {
    if (state.sites.length === 0) {
        showToast('請先載入站台列表', 'warning');
        return;
    }

    const testSite = state.sites[0];
    const testHistory = {
        videoId: 'test_video_001',
        videoName: '測試影片 - 刁蛮小医仙',
        episodeName: '第1集',
        episodeUrl: 'https://example.com/test_episode_1.mp4',
        siteId: testSite.id,
        siteName: testSite.name,
        currentTime: 300, // 5分鐘
        duration: 3600,   // 1小時
        lastWatched: Date.now() - 3600000 // 1小時前
    };

    state.addToHistory(testHistory);
    renderWatchHistory();
    showToast('已添加測試歷史紀錄', 'success');
    console.log('添加測試歷史紀錄:', testHistory);
}
