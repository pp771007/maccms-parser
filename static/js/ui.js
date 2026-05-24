import state from './state.js';
import { playVideo } from './player.js';
import { fetchVideoDetails, checkHistoryUpdates } from './api.js';
import { $, $$ } from './utils.js';
import { showModal, showConfirm, showToast } from './modal.js';
import historyManager from './historyStateManager.js';

// 站台改成 kazi 風格的橫向 chip 列：一眼看到有哪些站、點一下就切。點擊由 index.js 的事件委派處理。
export function renderSites(sites) {
    const strip = $('#siteStrip');
    strip.innerHTML = '';
    sites.forEach(site => {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.dataset.siteId = site.id;
        if (state.currentSite && state.currentSite.id == site.id) chip.classList.add('active');

        const errors = site.consecutive_errors || 0;
        if (errors >= 1) {
            const dot = document.createElement('span');
            dot.className = 'chip-dot ' + (errors >= 2 ? 'down' : 'warn');
            dot.title = errors >= 2 ? '連續多次連線失敗' : '上次連線異常';
            chip.appendChild(dot);
        }
        const label = document.createElement('span');
        label.textContent = site.note ? `${site.name} (${site.note})` : site.name;
        chip.appendChild(label);
        strip.appendChild(chip);
    });
}

// 標出目前選到的站台 chip（切換站台時更新，不必整列重繪）
export function setActiveSiteChip(siteId) {
    $$('#siteStrip .chip').forEach(c => c.classList.toggle('active', c.dataset.siteId == siteId));
}

// 分類也改成橫向 chip 列；沒有分類（多站搜尋 / 搜尋結果）時整列隱藏。
export function renderCategories(categories) {
    const strip = $('#categoryStrip');
    const wrap = $('#categoryStripWrap');
    strip.innerHTML = '';
    const activeId = state.currentTypeId == null ? 'all' : String(state.currentTypeId);

    const makeChip = (typeId, name) => {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.dataset.typeId = typeId;
        if (String(typeId) === activeId) chip.classList.add('active');
        chip.textContent = name;
        return chip;
    };

    const hasCats = categories && categories.length > 0;
    if (hasCats) {
        strip.appendChild(makeChip('all', '全部'));
        categories.forEach(cat => strip.appendChild(makeChip(cat.type_id, cat.type_name)));
    }
    wrap.style.display = hasCats ? '' : 'none';
}

// 一頁顯示幾筆(聚合後)。kazi 雙層分頁:把「資料頁」切成數個「顯示頁」,前端翻顯示頁不打伺服器、頁面也短。
export const INNER_PAGE_SIZE = 24;

// 把同名影片聚合成一筆(多站搜尋時同片會來自多站),回傳保留順序的群組陣列。
export function aggregateVideos(videos) {
    const map = new Map();
    (videos || []).forEach(v => {
        const key = v.vod_name;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(v);
    });
    return Array.from(map.entries()).map(([name, list]) => ({ name, list }));
}

function buildVideoCard(name, videoList) {
    const card = document.createElement('div');
    card.className = 'video-card';
    const firstVideo = videoList[0];

    let finalImageUrl;
    if (firstVideo.vod_pic && firstVideo.vod_pic.trim()) {
        finalImageUrl = firstVideo.vod_pic;
    } else {
        const englishName = name.replace(/[^\w\s]/g, '').substring(0, 10);
        finalImageUrl = `https://placehold.co/300x400.png?text=${encodeURIComponent(englishName || 'No Image')}`;
    }

    let siteNamesHtml = '';
    if (videoList.length > 1) {
        const uniqueSites = [...new Set(videoList.map(v => v.from_site).filter(Boolean))];
        if (uniqueSites.length > 0) siteNamesHtml = `<div class="video-site-name">${uniqueSites.join(', ')}</div>`;
    } else if (firstVideo.from_site) {
        siteNamesHtml = `<div class="video-site-name">${firstVideo.from_site}</div>`;
    }

    const countBadge = videoList.length > 1 ? `<div class="video-count-badge">${videoList.length}</div>` : '';

    card.innerHTML = `
        <div class="video-pic-wrapper">
            <img class="video-pic" src="${finalImageUrl}" alt="${name}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/300x400.png?text=No+Image';">
            ${siteNamesHtml}
            ${countBadge}
        </div>
        <div class="video-info">
            <div class="video-title" title="${name}">${name}</div>
            <div class="video-note">${firstVideo.vod_remarks || ''}</div>
        </div>
    `;
    card.addEventListener('click', () => {
        // 多站搜尋下即使只有一個結果也用 multi-source,確保站台資訊正確傳遞
        if (videoList.length > 1 || state.searchSiteIds.length > 0) {
            openMultiSourceModal(name, videoList);
        } else {
            openModal(firstVideo);
        }
    });
    return card;
}

// 渲染「目前顯示頁」的影片(讀 state.aggregated + state.displayPage)
export function renderVideos() {
    const grid = $('#videoGrid');
    grid.innerHTML = '';
    const groups = state.aggregated || [];
    if (groups.length === 0) {
        grid.innerHTML = '<p style="text-align: center; grid-column: 1 / -1; padding: 20px;">沒有找到相關內容。</p>';
        return;
    }
    const start = (state.displayPage - 1) * INNER_PAGE_SIZE;
    groups.slice(start, start + INNER_PAGE_SIZE).forEach(g => grid.appendChild(buildVideoCard(g.name, g.list)));
}

// kazi 雙層分頁:顯示頁(內層,前端切片即時翻)+ 資料頁(外層,向伺服器抓)。
// 只有一頁不顯示;只有外層(無內層)時不加「資料頁」標籤 → 等同單層,跟瀏覽一致。
export function renderPager(h) {
    const pag = $('#pagination');
    pag.innerHTML = '';
    const twoLayer = state.innerPageCount > 1;

    const arrowBtn = (text, disabled, onClick) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.disabled = disabled;
        btn.classList.add('btn', 'btn-outline-info');
        if (!disabled) btn.addEventListener('click', onClick);
        return btn;
    };
    const infoSpan = (text) => {
        const s = document.createElement('span');
        s.textContent = text;
        return s;
    };

    if (twoLayer) {
        const row = document.createElement('div');
        row.className = 'pager-row';
        const label = document.createElement('span');
        label.className = 'pager-label';
        label.textContent = '顯示頁';
        row.appendChild(label);
        row.appendChild(arrowBtn('上一頁', state.displayPage <= 1, h.innerPrev));
        row.appendChild(infoSpan(`${state.displayPage} / ${state.innerPageCount}`));
        row.appendChild(arrowBtn('下一頁', state.displayPage >= state.innerPageCount, h.innerNext));
        pag.appendChild(row);
    }

    if (state.totalPages > 1) {
        const row = document.createElement('div');
        row.className = 'pager-row';
        if (twoLayer) {
            const label = document.createElement('span');
            label.className = 'pager-label';
            label.textContent = '資料頁';
            row.appendChild(label);
        }
        row.appendChild(arrowBtn('上一頁', state.currentPage <= 1, h.outerPrev));
        const input = document.createElement('input');
        input.type = 'number';
        input.min = 1;
        input.max = state.totalPages;
        input.value = state.currentPage;
        input.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const p = parseInt(e.target.value, 10);
                if (p >= 1 && p <= state.totalPages) h.outerJump(p);
                else showModal(`請輸入 1 到 ${state.totalPages} 之間的頁碼`, 'warning');
            }
        });
        row.appendChild(input);
        row.appendChild(infoSpan(`/ ${state.totalPages} 頁`));
        row.appendChild(arrowBtn('下一頁', state.currentPage >= state.totalPages, h.outerNext));
        pag.appendChild(row);
    }
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
    historyManager.add({
        id: 'videoModal',
        apply: async () => {
            state.modalOpen = true;
            document.body.classList.add('modal-open');
            $('.title-text').textContent = video.vod_name;
            $('#videoModal').style.display = 'flex';
            $('#playlistSources').innerHTML = '';
            $('#episodeList').innerHTML = '正在加載播放列表...';

            // 使用統一方法隱藏來源數量標籤（單站點模式）
            updateSourceCountDisplay();
        },
        revert: closeModal,
        context: video
    });

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
    historyManager.add({
        id: 'videoModal',
        apply: () => {
            state.modalOpen = true;
            document.body.classList.add('modal-open');
            $('.title-text').textContent = videoName;
            $('#videoModal').style.display = 'flex';
            $('#playlistSources').innerHTML = '';
            $('#episodeList').innerHTML = '請選擇來源...';

            // 使用統一方法顯示來源數量標籤（多來源模式）
            updateSourceCountDisplay(videoList);
        },
        revert: closeModal,
        context: { videoName, videoList }
    });

    // 創建來源選擇按鈕
    const playlistSources = $('#playlistSources');
    playlistSources.innerHTML = '';

    // 儲存影片列表到state中，方便切換
    state.multiSourceVideos = videoList;
    // 初始化多來源的 modalData 存儲
    state.multiSourceModalData = {};



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
        // 使用 requestAnimationFrame 確保 DOM 更新完成後再點擊
        requestAnimationFrame(() => {
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

                }

                // 如果還是沒有，嘗試從站台列表中查找
                if (!siteId && state.sites.length > 0) {
                    const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
                    if (validSites.length > 0) {
                        siteId = validSites[0].id;
                        siteName = validSites[0].name;

                    }
                }

                // 獲取純影片名稱
                let pureVideoName = state.currentVideo?.vod_name;
                if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                    const currentVideo = state.multiSourceVideos[state.currentSourceIndex];
                    if (currentVideo) {
                        pureVideoName = currentVideo.vod_name;
                    }
                }

                const videoInfo = {
                    videoId: state.currentVideo?.vod_id || epi.vod_id,
                    videoName: pureVideoName || $('#modalTitle').textContent,
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    siteId: siteId,
                    siteName: siteName || '未知站台'
                };



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

                if (currentVideo) {
                    siteId = currentVideo.from_site_id;
                    siteName = currentVideo.from_site;

                }
            }

            // 如果沒有多來源信息，使用當前站台
            if (!siteId && state.currentSite) {
                siteId = state.currentSite.id;
                siteName = state.currentSite.name;

            }

            // 如果還是沒有，嘗試從站台列表中查找
            if (!siteId && state.sites.length > 0) {
                const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
                if (validSites.length > 0) {
                    siteId = validSites[0].id;
                    siteName = validSites[0].name;

                }
            }

            // 獲取純影片名稱（不包含來源數量信息）
            let pureVideoName = $('#modalTitle').textContent;
            if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                // 如果是多來源模式，使用第一個影片的名稱
                pureVideoName = state.multiSourceVideos[0].vod_name;
            } else if (state.currentVideo) {
                // 如果是單一影片模式，使用當前影片的名稱
                pureVideoName = state.currentVideo.vod_name;
            }

            const videoInfo = {
                videoId: state.currentVideo?.vod_id || currentSource.episodes[0]?.vod_id,
                videoName: pureVideoName,
                episodeName: currentSource.episodes[0].name,
                episodeUrl: currentSource.episodes[0].url,
                siteId: siteId,
                siteName: siteName || '未知站台'
            };

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


    if (!state.modalData || state.modalData.length === 0) {
        $('#episodeList').innerHTML = '<p>沒有可用的播放源。</p>';
        return;
    }

    // 檢查是否為多來源模式
    const isMultiSourceMode = state.multiSourceVideos && state.multiSourceVideos.length > 0;


    // 如果 multiSourceVideos 是 undefined 但我們在模態框中，嘗試從 DOM 中獲取多來源信息
    if (!isMultiSourceMode && state.multiSourceVideos === undefined && $('#playlistSources').children.length > 1) {

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

                    if (currentVideo) {
                        siteId = currentVideo.from_site_id;
                        siteName = currentVideo.from_site;

                    }
                }

                // 如果沒有多來源信息，使用當前站台
                if (!siteId && state.currentSite) {
                    siteId = state.currentSite.id;
                    siteName = state.currentSite.name;

                }

                // 如果還是沒有，嘗試從站台列表中查找
                if (!siteId && state.sites.length > 0) {
                    const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
                    if (validSites.length > 0) {
                        siteId = validSites[0].id;
                        siteName = validSites[0].name;

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

                // 獲取影片圖片URL
                let videoPic = '';
                if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                    const currentVideo = state.multiSourceVideos[sourceIndex];
                    if (currentVideo && currentVideo.vod_pic) {
                        videoPic = currentVideo.vod_pic;
                    }
                } else if (state.currentVideo && state.currentVideo.vod_pic) {
                    videoPic = state.currentVideo.vod_pic;
                }

                // 獲取純影片名稱
                let pureVideoName = state.currentVideo?.vod_name;
                if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                    const currentVideo = state.multiSourceVideos[sourceIndex];
                    if (currentVideo) {
                        pureVideoName = currentVideo.vod_name;
                    }
                }

                const videoInfo = {
                    videoId: videoId,
                    videoName: pureVideoName || $('#modalTitle').textContent,
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    siteId: siteId,
                    siteName: siteName || '未知站台',
                    videoPic: videoPic
                };



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

            }

            // 如果還是沒有，嘗試從站台列表中查找
            if (!siteId && state.sites.length > 0) {
                const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
                if (validSites.length > 0) {
                    siteId = validSites[0].id;
                    siteName = validSites[0].name;

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

            // 獲取純影片名稱（不包含來源數量信息）
            let pureVideoName = $('#modalTitle').textContent;
            if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                // 如果是多來源模式，使用第一個影片的名稱
                pureVideoName = state.multiSourceVideos[0].vod_name;
            } else if (state.currentVideo) {
                // 如果是單一影片模式，使用當前影片的名稱
                pureVideoName = state.currentVideo.vod_name;
            }

            // 獲取影片圖片URL
            let videoPic = '';
            if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                const currentVideo = state.multiSourceVideos[sourceIndex];
                if (currentVideo && currentVideo.vod_pic) {
                    videoPic = currentVideo.vod_pic;
                }
            } else if (state.currentVideo && state.currentVideo.vod_pic) {
                videoPic = state.currentVideo.vod_pic;
            }

            const videoInfo = {
                videoId: videoId,
                videoName: pureVideoName,
                episodeName: currentSource.episodes[0].name,
                episodeUrl: currentSource.episodes[0].url,
                siteId: siteId,
                siteName: siteName || '未知站台',
                videoPic: videoPic
            };



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
    // 標記 modal 已關 → 攔住還在載入詳情、之後才會建立的播放器(避免背景播放、沒地方關)
    state.modalOpen = false;
    // 在關閉前保存當前進度
    state.saveCurrentProgress();

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

    // 使用統一方法清理來源數量標籤
    updateSourceCountDisplay();

    if (historyManager.getCurrentState()?.id === 'videoModal') {
        historyManager.back();
    }
}

export function openSiteSelectionModal() {
    historyManager.add({
        id: 'siteSelectionModal',
        apply: () => {
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
                let displayName = site.note ? `${site.name} (${site.note})` : site.name;
                const errors = site.consecutive_errors || 0;
                if (errors >= 2) {
                    displayName = `🔴 ${displayName}`;
                } else if (errors === 1) {
                    displayName = `🟡 ${displayName}`;
                }
                label.append(` ${displayName}`);
                list.appendChild(label);
            });
            $('#siteSelectionModal').style.display = 'flex';
        },
        revert: closeSiteSelectionModal
    });
}

export function closeSiteSelectionModal() {
    $('#siteSelectionModal').style.display = 'none';
    if (historyManager.getCurrentState()?.id === 'siteSelectionModal') {
        historyManager.back();
    }
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

// 統一管理來源數量標籤顯示狀態的方法
export function updateSourceCountDisplay(videoList) {
    const sourceCountElement = $('#sourceCount');
    if (!sourceCountElement) return;

    if (videoList && videoList.length > 1) {
        // 多來源模式：顯示來源數量
        sourceCountElement.textContent = `(${videoList.length} 個來源)`;
        sourceCountElement.style.display = 'inline-block';
    } else {
        // 單來源模式：隱藏來源數量
        sourceCountElement.style.display = 'none';
        sourceCountElement.textContent = '';
    }
}

export function showLoader(show) { $('#loader').style.display = show ? 'flex' : 'none'; }
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
        return;
    }

    // 清理無效的歷史紀錄（站台不存在的記錄）
    if (state.sites && state.sites.length > 0) {
        const originalLength = state.watchHistory.length;
        state.watchHistory = state.watchHistory.filter(item => {
            // 保留有站台名稱的記錄，或者站台ID在當前站台列表中的記錄
            // 或者有站台ID但站台名稱為null的記錄（可能是舊的歷史紀錄格式）
            const hasValidSite = item.siteName ||
                state.sites.some(s => s.id === item.siteId || s.name === item.siteName) ||
                (item.siteId && item.siteName === null); // 允許siteName為null但有siteId的記錄



            return hasValidSite;
        });
        if (originalLength !== state.watchHistory.length) {

            state.saveWatchHistory();
        }

        // 修復歷史紀錄中的站台信息
        state.watchHistory.forEach(item => {
            if (!item.siteName || item.siteName === '未知站台') {
                // 嘗試根據 siteId 找到對應的站台名稱
                const site = state.sites.find(s => s.id === item.siteId);
                if (site) {
                    item.siteName = site.name;

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


    }

    if (state.watchHistory.length === 0) {
        historyContainer.innerHTML = `
            <p class="no-history">暫無觀看歷史</p>
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

        // 處理圖片URL
        let finalImageUrl;
        if (item.videoPic && item.videoPic.trim()) {
            finalImageUrl = item.videoPic;
        } else {
            // 嘗試從影片名稱生成一個更相關的佔位圖片
            const englishName = item.videoName.replace(/[^\w\s]/g, '').substring(0, 10);
            const placeholderText = encodeURIComponent(englishName || 'No Image');
            finalImageUrl = `https://placehold.co/300x400/666666/ffffff.png?text=${placeholderText}`;
        }

        historyItem.innerHTML = `
            <div class="history-pic-wrapper">
                <img class="history-pic" src="${finalImageUrl}" alt="${item.videoName}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/300x400/666666/ffffff.png?text=No+Image';">
            </div>
            <div class="history-content">
                <div class="history-header">
                    <div class="history-title" title="${item.videoName}">${item.videoName}</div>
                    <button class="btn btn-danger btn-sm remove-btn" title="移除紀錄">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                </div>
                <div class="history-details">
                    <span class="history-episode">${item.episodeName || '未知劇集'}</span>
                    <span class="history-site">${item.siteName || (item.siteId ? (state.sites.find(s => s.id === item.siteId)?.name || state.sites.find(s => s.name === item.siteName)?.name || '未知站台') : (state.sites.find(s => s.name === item.siteName)?.name || '未知站台'))}</span>
                    ${item.totalEpisodes ? `<span class="history-total-episodes" title="目前共有${item.totalEpisodes}集">共 ${item.totalEpisodes} 集</span>` : ''}
                    <span class="history-time">${formatDate(item.lastWatched || item.timestamp)}</span>
                </div>
                <div class="history-bottom">
                    <div class="history-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <div class="progress-text">${formatTime(item.currentTime)} / ${formatTime(item.duration)}</div>
                    </div>
                    <div class="history-actions-btns">
                        <button class="btn btn-secondary btn-sm next-ep-btn" title="播放下一集">下一集</button>
                        <button class="btn btn-primary btn-sm continue-btn" title="繼續觀看">繼續觀看</button>
                    </div>
                </div>
            </div>
        `;

        // 檢查是否有更新並添加標記
        const key = `${item.videoId}_${item.siteId}`;
        if (state.historyUpdateInfo[key]?.hasUpdate) {
            const updateBadge = document.createElement('div');
            updateBadge.className = 'update-badge';
            updateBadge.innerHTML = `NEW`;
            updateBadge.title = `新增 ${state.historyUpdateInfo[key].newEpisodesCount} 集`;
            historyItem.querySelector('.history-pic-wrapper').appendChild(updateBadge);
            historyItem.classList.add('has-update');
        }


        // 繼續觀看 / 下一集
        historyItem.querySelector('.continue-btn').addEventListener('click', () => playFromHistory(item, false));
        historyItem.querySelector('.next-ep-btn').addEventListener('click', () => playFromHistory(item, true));

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
// 從同一個來源的劇集清單找「下一集」,回傳一個指向下一集、進度歸零的 historyItem;沒有下一集回 null。
function computeNextEpisodeItem(item, modalData) {
    const srcIdx = findTargetSourceIndex(item, modalData);
    const source = srcIdx >= 0 ? modalData[srcIdx] : (modalData[0] || null);
    if (!source || !source.episodes) return null;
    const idx = source.episodes.findIndex(e => e.url === item.episodeUrl);
    if (idx < 0 || idx + 1 >= source.episodes.length) return null;
    const next = source.episodes[idx + 1];
    return { ...item, episodeName: next.name, episodeUrl: next.url, currentTime: 0, duration: 0 };
}

// 從觀看歷史播放。next=false → 繼續看(原集數+進度);next=true → 直接播下一集(從頭)。
async function playFromHistory(item, next) {
    try {
        // 找站台(ID → 名稱 → 第一個可用)
        let site = state.sites.find(s => s.id === item.siteId);
        if (!site && item.siteName) site = state.sites.find(s => s.name === item.siteName);
        if (!site && state.sites.length > 0) {
            const validSites = state.sites.filter(s => s && s.id && s.name && s.url);
            if (validSites.length > 0) site = validSites[0];
        }
        if (!site) { showModal('找不到可用的站台資訊，請檢查站台設定', 'error'); return; }
        if (!site.url || site.url.trim() === '') { showModal(`站台 "${site.name}" 的URL無效，請檢查站台設定`, 'error'); return; }

        const result = await fetchVideoDetails(site.url, item.videoId);
        state.modalData = result.data;
        state.currentVideo = { vod_id: item.videoId, vod_name: item.videoName };

        let target = item;
        if (next) {
            target = computeNextEpisodeItem(item, result.data);
            if (!target) { showToast('已經是最後一集了', 'info'); return; }
        }
        openHistoryVideoModal(target, result.data);
    } catch (err) {
        console.error('歷史紀錄載入影片失敗:', err);
        let errorMessage = `無法載入影片: ${err.message}`;
        if (err.message.includes('網絡') || err.message.includes('連接')) {
            errorMessage += '\n\n可能的原因：\n• 站台已失效或無法訪問\n• 網絡連接問題\n• 站台API格式已變更';
        } else if (err.message.includes('JSON') || err.message.includes('格式')) {
            errorMessage += '\n\n可能的原因：\n• 站台API返回無效數據\n• 站台已失效或需要登錄\n• 站台API格式已變更';
        } else if (err.message.includes('未返回有效的') || err.message.includes('List')) {
            const searchInOtherSites = confirm(`無法載入影片(可能已從站台移除或站台失效)。\n\n是否要在其他站台搜尋 "${item.videoName}"？`);
            if (searchInOtherSites) {
                hideHistoryPanel();
                $('#searchInput').value = item.videoName;
                $('#searchBtn')?.click();
            }
            return;
        }
        showModal(errorMessage, 'error');
    }
}

export function openHistoryVideoModal(historyItem, modalData) {
    historyManager.add({
        id: 'videoModal',
        apply: () => {
            state.modalOpen = true;
            document.body.classList.add('modal-open');
            $('.title-text').textContent = historyItem.videoName;
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
        },
        revert: closeModal,
        context: { historyItem, modalData }
    });
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
                if (isTargetEpisode && historyItem.currentTime > 0) {
                    playVideo(epi.url, item, videoInfo, historyItem);
                } else {
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
    historyManager.add({
        id: 'historyPanel',
        apply: async () => {
            const historyPanel = $('#historyPanel');
            const historyOverlay = $('#historyOverlay');
            if (historyPanel && historyOverlay) {
                historyOverlay.style.display = 'block';
                historyPanel.style.display = 'flex';
                renderWatchHistory();

                // 設置歷史記錄更新回調
                state.onHistoryUpdate = renderWatchHistory;

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

                // 檢查是否需要檢查更新（10分鐘內不重複檢查）
                if (state.shouldCheckHistoryUpdates()) {
                    await performHistoryUpdateCheck();
                }
            }
        },
        revert: hideHistoryPanel
    });
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

        if (historyManager.getCurrentState()?.id === 'historyPanel') {
            historyManager.back();
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

// 檢查歷史記錄更新
async function performHistoryUpdateCheck() {
    if (!state.watchHistory || state.watchHistory.length === 0) {
        return;
    }

    // 清除舊的更新信息
    state.clearHistoryUpdateInfo();

    // 顯示檢查提示
    const checkingToast = document.createElement('div');
    checkingToast.className = 'checking-updates-toast';
    checkingToast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <div class="spinner"></div>
            <span>正在檢查更新...</span>
        </div>
    `;
    checkingToast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
    document.body.appendChild(checkingToast);

    try {
        // 準備前5個歷史記錄的數據（後端會再次限制最多10個）
        const itemsToCheck = state.watchHistory.slice(0, 5).map(item => ({
            videoId: item.videoId,
            videoName: item.videoName,
            siteId: item.siteId,
            siteName: item.siteName,
            totalEpisodes: item.totalEpisodes || 0
        }));

        // 調用後端API批量檢查
        const result = await checkHistoryUpdates(itemsToCheck);
        
        let updatedCount = 0;
        let historyModified = false;

        // 處理檢查結果
        if (result.results && Array.isArray(result.results)) {
            result.results.forEach(checkResult => {
                if (checkResult.status === 'success') {
                    // 找到對應的歷史記錄項目
                    const historyItem = state.watchHistory.find(item => 
                        item.videoId === checkResult.videoId && 
                        item.siteId === checkResult.siteId
                    );

                    if (historyItem) {
                        // 更新總集數
                        if (checkResult.totalEpisodes !== undefined) {
                            historyItem.totalEpisodes = checkResult.totalEpisodes;
                            historyModified = true;
                        }

                        // 如果有更新，記錄更新信息
                        if (checkResult.hasUpdate) {
                            const key = `${checkResult.videoId}_${checkResult.siteId}`;
                            state.historyUpdateInfo[key] = {
                                hasUpdate: true,
                                newEpisodesCount: checkResult.newEpisodesCount
                            };
                            updatedCount++;
                        }
                    }
                }
            });
        }

        // 批量保存歷史記錄（只在有修改時保存一次）
        if (historyModified) {
            state.saveWatchHistory();
        }

        // 更新最後檢查時間
        state.updateLastCheckTime();

        // 移除檢查提示
        document.body.removeChild(checkingToast);

        // 顯示結果
        const summary = result.summary || { updated: updatedCount, failed: 0 };
        
        if (summary.updated > 0) {
            showToast(`發現 ${summary.updated} 部影片有更新！`, 'success');
            // 重新渲染歷史記錄以顯示更新標記
            renderWatchHistory();
        } else if (summary.total > 0) {
            showToast('已檢查更新，暫無新內容', 'info');
        }
        
        // 如果有檢查失敗的項目，顯示警告
        if (summary.failed > 0) {
            // 延遲顯示失敗提示，避免覆蓋成功訊息
            setTimeout(() => {
                showToast(`${summary.failed} 部影片檢查失敗，可能是站台暫時無法連接`, 'warning');
            }, summary.updated > 0 ? 2000 : 500);
        }
    } catch (err) {
        console.error('檢查更新失敗:', err);
        // 移除檢查提示
        if (document.body.contains(checkingToast)) {
            document.body.removeChild(checkingToast);
        }
        showToast('檢查更新失敗，請稍後再試', 'error');
    }
}
