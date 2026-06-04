import state from './state.js';
import { playVideo } from './player.js';
import { fetchVideoDetails, checkHistoryUpdates, fetchMultiSiteVideoList } from './api.js';
import { $, $$, matchEpisodeIndex } from './utils.js';
import { showModal, showConfirm, showToast } from './modal.js';
import historyManager from './historyStateManager.js';
import { armConfirmDelete } from './confirmDelete.js';
import { clearVideoParams } from './urlState.js';

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

// 新增多來源影片的modal。autoSelectIndex:開啟後自動點哪一個來源(換站時帶入「目前所在站」的 index,
// 點它時因 artplayer 還在,renderPlaylist 會走切換分支對齊集數+續播)。
export async function openMultiSourceModal(videoName, videoList, autoSelectIndex = 0) {
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

    // 自動選擇來源(預設第一個;換站時帶入目前所在站的 index)。用 requestAnimationFrame 確保 DOM 更新後再點。
    if (videoList.length > 0) {
        requestAnimationFrame(() => {
            const idx = Math.min(Math.max(autoSelectIndex, 0), videoList.length - 1);
            const target = playlistSources.children[idx] || playlistSources.firstElementChild;
            if (target) target.click();
        });
    }
}

// 從目前播放情境推出「這集屬於哪個站台」:多來源用該來源的站台,否則用目前單站,
// 再不行退用第一個可用站台。回傳 { siteUrl, siteName }——歷史 / 收藏一律以 siteUrl 為識別,
// siteUrl 跟 siteName 綁同一個站台、永遠一致。
function resolvePlaybackSite(sourceIndex) {
    if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
        const v = state.multiSourceVideos[sourceIndex];
        const site = v && state.sites.find(s => s.id === v.from_site_id);
        if (site) return { siteUrl: site.url, siteName: v.from_site || site.name };
    }
    if (state.currentSite) return { siteUrl: state.currentSite.url, siteName: state.currentSite.name };
    const valid = state.sites.find(s => s && s.id && s.name && s.url);
    if (valid) return { siteUrl: valid.url, siteName: valid.name };
    return { siteUrl: '', siteName: '未知站台' };
}

// 組一集的播放資訊(歷史 / 收藏 / 續播都靠這包):多來源模式片源資訊取該來源的影片,否則取單站的 currentVideo。
function buildVideoInfo(sourceIndex, epi) {
    const isMulti = state.multiSourceVideos && state.multiSourceVideos.length > 0;
    const srcVideo = (isMulti ? state.multiSourceVideos[sourceIndex] : state.currentVideo) || state.currentVideo;
    const { siteUrl, siteName } = resolvePlaybackSite(sourceIndex);
    return {
        videoId: srcVideo?.vod_id || state.currentVideo?.vod_id,
        videoName: srcVideo?.vod_name || state.currentVideo?.vod_name || $('#modalTitle').textContent,
        episodeName: epi.name,
        episodeUrl: epi.url,
        siteUrl,
        siteName,
        videoPic: srcVideo?.vod_pic || state.currentVideo?.vod_pic || '',
    };
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
                const { siteUrl, siteName } = resolvePlaybackSite(sourceIndex);

                // 獲取純影片名稱
                let pureVideoName = state.currentVideo?.vod_name;
                if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
                    const currentVideo = state.multiSourceVideos[sourceIndex];
                    if (currentVideo) {
                        pureVideoName = currentVideo.vod_name;
                    }
                }

                const videoInfo = {
                    videoId: state.currentVideo?.vod_id || epi.vod_id,
                    videoName: pureVideoName || $('#modalTitle').textContent,
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    siteUrl: siteUrl,
                    siteName: siteName
                };



                playVideo(epi.url, item, videoInfo);
            };
            episodeList.appendChild(item);
        });

        // 只在首次載入時自動播放第一個劇集，切換資源時不自動播放
        const firstEpisode = episodeList.firstElementChild;
        if (firstEpisode && !state.artplayer) {
            const { siteUrl, siteName } = resolvePlaybackSite(sourceIndex);

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
                siteUrl: siteUrl,
                siteName: siteName
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
    state.currentSourceIndex = sourceIndex; // 給網址同步用,記住目前在哪個來源

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
        // 單站開的片:補一顆「其他站」鈕,點了即時跨站搜同名片,可切到別站續播
        appendCrossSiteButton(playlistSources);
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

    // 多來源(跨站)模式:每個來源的 modalData 只放第一條線路 → 取 [0];
    // 單站模式:modalData 是該片各線路 → 依 sourceIndex 取該線路(換線路才會換到正確清單)。
    let currentSource;
    if (state.multiSourceVideos && state.multiSourceVideos.length > 0 && state.multiSourceModalData) {
        const dataForSource = state.multiSourceModalData[sourceIndex] || state.modalData;
        currentSource = dataForSource?.[0];
    } else {
        currentSource = state.modalData?.[sourceIndex];
    }

    if (currentSource && currentSource.episodes && currentSource.episodes.length > 0) {
        const eps = currentSource.episodes;
        eps.forEach((epi, epiIdx) => {
            const item = document.createElement('div');
            item.className = 'episode-item';
            item.textContent = epi.name;
            item.onclick = () => {
                state.currentEpisodeIndex = epiIdx;
                playVideo(epi.url, item, buildVideoInfo(sourceIndex, epi));
            };
            episodeList.appendChild(item);
        });

        if (!state.artplayer) {
            // 首次開啟:播第一集(若有觀看歷史,續播由 playVideo 內部依 watchHistory 處理)
            state.currentEpisodeIndex = 0;
            playVideo(eps[0].url, episodeList.firstElementChild, buildVideoInfo(sourceIndex, eps[0]));
        } else {
            // 切換來源 / 站台:對齊到同一集 + 帶當前秒數續播(不從頭、不必再手動點集)
            const resumeSec = state.artplayer.currentTime || 0;
            const targetIdx = matchEpisodeIndex(
                state.currentVideoInfo?.episodeName || '',
                state.currentEpisodeIndex ?? 0,
                eps,
            );
            state.currentEpisodeIndex = targetIdx;
            const targetEp = eps[targetIdx];
            playVideo(
                targetEp.url,
                episodeList.children[targetIdx],
                buildVideoInfo(sourceIndex, targetEp),
                { currentTime: resumeSec },
            );
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

// 用目前片名跨站搜同名片(精確同名、排除目前所在站),回傳可切換的其他站影片清單
async function findPeersOnOtherSites() {
    const name = state.currentVideo?.vod_name;
    if (!name) return [];
    const ids = state.sites.filter(s => s.enabled !== false).map(s => s.id);
    const currentSiteId = state.currentSite?.id;
    try {
        const res = await fetchMultiSiteVideoList(ids, 1, name);
        return (res.list || []).filter(v =>
            v.vod_name === name && v.from_site_id != null && v.from_site_id !== currentSiteId);
    } catch (e) {
        console.error('跨站搜尋同名片失敗:', e);
        return [];
    }
}

// 在來源列尾端加「其他站」鈕(單站開的片用)。點一下跨站搜同名片 → 轉成多來源模式(各站並列),
// 自動回到目前所在站(對齊集數+續播當前秒數),使用者再點別站即可切過去。
function appendCrossSiteButton(container) {
    const btn = document.createElement('button');
    btn.className = 'source-btn cross-site-trigger';
    btn.textContent = '🔍 其他站';
    btn.onclick = async () => {
        if (btn.dataset.busy === '1') return;
        btn.dataset.busy = '1';
        btn.textContent = '搜尋中…';
        const peers = await findPeersOnOtherSites();
        btn.dataset.busy = '0';
        if (peers.length === 0) {
            btn.textContent = '其他站無此片';
            btn.disabled = true;
            return;
        }
        // 目前這部片(目前站)放第一個,後面接其他站;自動選第一個(=目前站)續播,不中斷觀看
        const cur = {
            vod_id: state.currentVideo.vod_id,
            vod_name: state.currentVideo.vod_name,
            vod_pic: state.currentVideo.vod_pic,
            from_site_id: state.currentSite?.id,
            from_site: state.currentSite?.name || '目前站',
        };
        openMultiSourceModal(state.currentVideo.vod_name, [cur, ...peers], 0);
    };
    container.appendChild(btn);
}

export function closeModal() {
    // 標記 modal 已關 → 攔住還在載入詳情、之後才會建立的播放器(避免背景播放、沒地方關)
    state.modalOpen = false;
    clearVideoParams(); // 影片關了,網址不再指向某部片
    // 從導覽堆疊移除,避免殘留 id 害下次開不了(以關閉按鈕直接關時)
    historyManager.remove('videoModal');
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



// 把時間戳格式化成「剛剛 / X 分鐘前 / HH:MM」,給「最後同步」用
function formatSyncTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 10000) return '剛剛';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
    return new Date(ts).toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// 把秒數格式化成 mm:ss 或 hh:mm:ss(觀看歷史與收藏卡片共用)
function formatPlayTime(seconds) {
    if (!seconds || seconds <= 0) return '00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 新增歷史紀錄相關功能
export function renderWatchHistory() {
    const historyContainer = $('#watchHistoryContainer');
    if (!historyContainer) {
        return;
    }

    const syncedLabel = $('#historySyncedAt');
    if (syncedLabel) {
        syncedLabel.textContent = state.historySyncedAt
            ? `最後同步:${formatSyncTime(state.historySyncedAt)}` : '';
    }

    // 補齊缺少的站台名稱(以 siteUrl 對應本地站台;對不上就維持原樣,不影響顯示與播放)。
    // 不再因「本地沒有對應站台」清掉歷史——歷史以 siteUrl 為識別,跨裝置 / 跟 kazi 同步時
    // 本地站台清單常對不上,但只要 siteUrl 還在就是有效歷史,不該被誤刪。
    if (state.sites && state.sites.length > 0) {
        state.watchHistory.forEach(item => {
            if (!item.siteName || item.siteName === '未知站台') {
                const site = state.sites.find(s => s.url === item.siteUrl);
                if (site) item.siteName = site.name;
            }
        });
    }

    const activeList = state.activeHistory();
    if (activeList.length === 0) {
        historyContainer.innerHTML = `
            <p class="no-history">暫無觀看歷史</p>
        `;
        return;
    }

    historyContainer.innerHTML = '';

    activeList.forEach((item, index) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';

        // 計算播放進度百分比
        const progressPercent = item.duration > 0 ?
            Math.round((item.currentTime / item.duration) * 100) : 0;

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
                    <span class="history-site">${item.siteName || state.sites.find(s => s.url === item.siteUrl)?.name || '未知站台'}</span>
                    ${item.totalEpisodes ? `<span class="history-total-episodes" title="目前共有${item.totalEpisodes}集">共 ${item.totalEpisodes} 集</span>` : ''}
                    <span class="history-time">${formatDate(item.lastWatched || item.timestamp)}</span>
                </div>
                <div class="history-bottom">
                    <div class="history-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <div class="progress-text">${formatPlayTime(item.currentTime)} / ${formatPlayTime(item.duration)}</div>
                    </div>
                    <div class="history-actions-btns">
                        <button class="btn btn-secondary btn-sm next-ep-btn" title="播放下一集">下一集</button>
                        <button class="btn btn-primary btn-sm continue-btn" title="繼續觀看">繼續觀看</button>
                    </div>
                </div>
            </div>
        `;

        // 檢查是否有更新並添加標記
        const key = `${item.videoId}_${item.siteUrl}`;
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

        // 移除紀錄(兩段式:第一下變「確認」,再按一次才刪)
        armConfirmDelete(historyItem.querySelector('.remove-btn'), () => {
            state.removeHistory(item.videoId, item.siteUrl);  // 軟刪(標記墓碑,跟著同步)
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
    // 先收起歷史面板,否則它的層級會蓋在播放器上、看起來像沒收起來
    hideHistoryPanel();
    try {
        // 歷史以 siteUrl 為識別,直接用它打 API:即使本地沒把這個站台加進清單,
        // 只要原站還活著就能續看(跨裝置 / 跟 kazi 同步時,本地站台清單常對不上)。
        const siteUrl = item.siteUrl;
        if (!siteUrl || siteUrl.trim() === '') { showModal('這筆歷史沒有站台網址，無法播放', 'error'); return; }

        const result = await fetchVideoDetails(siteUrl, item.videoId);
        state.modalData = result.data;
        state.currentVideo = { vod_id: item.videoId, vod_name: item.videoName, vod_pic: item.videoPic };

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

// 從網址參數開片(分享 / 書籤):siteUrl + vod_id + 來源索引 + 集索引。
// 站台以 siteUrl 識別,直接拿 url 打 API,不要求該站在本地清單(跨裝置 / 跨 app 寫的歷史也能還原)。
// 把索引換算成該集的網址 / 集名後,重用「從歷史開片」流程(會自動選來源、自動播到該集)。
export async function openVideoFromUrl({ siteUrl, vodId, src, ep }) {
    if (!siteUrl) return;
    try {
        const result = await fetchVideoDetails(siteUrl, vodId);
        const modalData = result.data;
        if (!modalData || modalData.length === 0) {
            showModal('找不到這部影片的播放內容,可能已從站台移除。', 'warning');
            return;
        }

        // 顯示用站名:本地清單有這站就用清單的名字;沒有(跨裝置 / 跨 app 的歷史)就退用站台網域,
        // 網域取不到才用整串 url。siteUrl 由同步來的歷史帶入,可能非合法 url,故包 try。
        // 不改 state.currentSite:深連結是疊在背景清單之上,動了清單站台會跟網址 / chip 不一致。
        const localSite = state.sites.find(s => s.url === siteUrl);
        let siteName = localSite?.name;
        if (!siteName) {
            try { siteName = new URL(siteUrl).hostname; } catch { /* siteUrl 非合法 url */ }
            if (!siteName) siteName = siteUrl;
        }
        state.currentVideo = {
            vod_id: vodId,
            vod_name: result.vod_name || '',
            vod_pic: result.vod_pic || '',
            from_site_id: localSite?.id,
        };

        const safeSrc = (src >= 0 && src < modalData.length) ? src : 0;
        const epList = modalData[safeSrc].episodes || [];
        const safeEp = (ep >= 0 && ep < epList.length) ? ep : 0;
        const targetEp = epList[safeEp];

        // 網址只帶來源 / 集索引,沒帶秒數。秒數存在伺服器歷史裡(綁帳號、跨裝置),
        // 開片前去歷史撈同一部同一集的續看點,複製連結 / 換裝置才能接續上次看到的位置。
        const saved = state.watchHistory.find(i =>
            String(i.videoId) === String(vodId) && i.siteUrl === siteUrl && !i.deletedAt);
        const resumeFromSaved = saved && targetEp && episodeMatchesHistory(targetEp, saved);

        openHistoryVideoModal({
            videoId: vodId,
            videoName: result.vod_name || '',
            videoPic: result.vod_pic || '',
            siteUrl: siteUrl,
            siteName,
            sourceIndex: safeSrc,
            episodeIndex: safeEp,
            episodeUrl: targetEp?.url || '',
            episodeName: targetEp?.name || '',
            currentTime: resumeFromSaved ? (saved.currentTime || 0) : 0,
            duration: resumeFromSaved ? (saved.duration || 0) : 0,
        }, modalData);
    } catch (err) {
        console.error('從網址開片失敗:', err);
        showModal('開啟分享的影片失敗,站台可能已失效。', 'error');
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
            state.currentVideo = { vod_id: historyItem.videoId, vod_name: historyItem.videoName, vod_pic: historyItem.videoPic };

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
                // 原本看的來源 / 集數在站台已經不存在(來源掛掉)。
                // 有續看進度時不要自動改播別的來源第一集 —— 那會被當成換新集、把秒數歸零。
                // 改成保留進度、只渲染來源讓使用者自己挑;沒進度的(剛分享的新片)維持自動播。
                const hadProgress = historyItem.currentTime > 0;
                renderHistoryEpisodes(historyItem, modalData, 0, !hadProgress);
                if (hadProgress) {
                    showToast('原本觀看的來源已失效，已保留上次進度。請手動選擇其他來源或集數。', 'warning');
                }
            }
        },
        revert: closeModal,
        context: { historyItem, modalData }
    });
}

// 渲染歷史紀錄的劇集列表
function renderHistoryEpisodes(historyItem, modalData, sourceIndex, autoPlay = true) {
    state.currentSourceIndex = sourceIndex; // 給網址同步用,記住目前在哪個來源
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

            // 檢查是否為目標劇集(網址優先,跨 app 無網址時用集名)
            const isTargetEpisode = episodeMatchesHistory(epi, historyItem);
            if (isTargetEpisode) {
                item.classList.add('target-episode');
            }

            item.onclick = () => {
                state.currentEpisodeIndex = epiIndex; // 給網址同步用,記住目前在第幾集
                const videoInfo = {
                    videoId: historyItem.videoId,
                    videoName: historyItem.videoName,
                    // 帶上海報:第一次從網址 / 歷史開沒看過的片時,新建的歷史才不會變成無圖
                    videoPic: historyItem.videoPic || state.currentVideo?.vod_pic || '',
                    episodeName: epi.name,
                    episodeUrl: epi.url,
                    siteUrl: historyItem.siteUrl,
                    siteName: historyItem.siteName || state.sites.find(s => s.url === historyItem.siteUrl)?.name || '未知站台'
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
            if (episodeMatchesHistory(currentSource.episodes[i], historyItem)) {
                targetEpisode = episodeList.children[i];
                break;
            }
        }

        // 找到目標劇集就續看;沒找到時只有 autoPlay 才退而播第一集。
        // autoPlay=false 用在「原本看的來源已失效」:不自動改播別集,避免 addToHistory 洗掉續看秒數。
        const episodeToPlay = targetEpisode || (autoPlay ? episodeList.firstElementChild : null);
        if (episodeToPlay) {
            episodeToPlay.click();
        }
    } else {
        episodeList.innerHTML = '<p>此來源下沒有劇集。</p>';
    }
}

// 比對某集是否為歷史的續看點:優先用集網址(網頁寫的);沒有網址(kazi 跨 app 寫的)就用集名。
function episodeMatchesHistory(epi, historyItem) {
    if (historyItem.episodeUrl) return epi.url === historyItem.episodeUrl;
    return !!historyItem.episodeName && epi.name === historyItem.episodeName;
}

// 找到目標播放源的索引
function findTargetSourceIndex(historyItem, modalData) {
    for (let i = 0; i < modalData.length; i++) {
        if (modalData[i].episodes.some(epi => episodeMatchesHistory(epi, historyItem))) {
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
                // 每次開面板都重新跟伺服器抓一次,確保看到其他裝置(kazi)同步上來的最新資料
                await state.loadWatchHistory();
                renderWatchHistory();

                // 設置歷史記錄更新回調
                state.onHistoryUpdate = renderWatchHistory;
                // 清除/關閉按鈕的事件已在 index.js 綁定(清除是兩段式),這裡不再重綁,避免蓋掉

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

        // 清掉堆疊裡的 historyPanel(不論在第幾層),避免關閉後殘留害重開不了
        historyManager.remove('historyPanel');
    }
}

// 清除所有歷史紀錄
// 直接清除(確認交給按鈕的兩段式,見 index.js 對 #clearHistoryBtn 的綁定)
export function clearAllHistory() {
    state.clearHistory();
    renderWatchHistory();
    showToast('已清除所有觀看歷史');
}

/* ===== 收藏(共通格式,跟 kazi 共用)===== */

// 目前 modal 內影片的收藏項目(共通格式,鍵=videoId+siteUrl)
function currentFavItem() {
    const info = state.currentVideoInfo;
    const cv = state.currentVideo;
    const videoId = info?.videoId || cv?.vod_id;
    // 已播放的用 currentVideoInfo.siteUrl;還沒播放(從搜尋結果收藏)的用 from_site_id 查回 url
    const siteUrl = info?.siteUrl
        || (cv?.from_site_id != null ? state.sites.find(s => s.id === cv.from_site_id)?.url : null)
        || state.currentSite?.url
        || '';
    if (!videoId || !siteUrl) return null;
    return {
        videoId,
        siteUrl,
        siteName: state.sites.find(s => s.url === siteUrl)?.name || info?.siteName || '',
        videoName: cv?.vod_name || info?.videoName || '未知影片',
        videoPic: cv?.vod_pic || info?.videoPic || '',
        vodRemarks: cv?.vod_remarks || '',
    };
}

export function updateFavoriteButton() {
    const btn = $('#favoriteToggleBtn');
    if (!btn) return;
    const fav = currentFavItem();
    btn.classList.toggle('favorited', !!(fav && state.isFavorited(fav.videoId, fav.siteUrl)));
}

export function toggleCurrentFavorite() {
    const fav = currentFavItem();
    if (!fav) { showToast('還無法取得影片資訊,稍等播放開始再試', 'warning'); return; }
    const nowFav = state.toggleFavorite(fav);
    updateFavoriteButton();
    showToast(nowFav ? '已加入收藏 ⭐' : '已取消收藏', 'success');
}

export function showFavoritesPanel() {
    historyManager.add({
        id: 'favoritesPanel',
        apply: async () => {
            $('#favoritesOverlay').style.display = 'block';
            $('#favoritesPanel').style.display = 'flex';
            // 每次開面板都重新抓,確保看到其他裝置(kazi)同步上來的收藏
            await state.loadFavorites();
            renderFavorites();
            const c = $('#favoritesContainer');
            c.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
            c.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
        },
        revert: hideFavoritesPanel,
    });
}

export function hideFavoritesPanel() {
    const panel = $('#favoritesPanel');
    const overlay = $('#favoritesOverlay');
    if (!panel || !overlay) return;
    overlay.style.display = 'none';
    panel.classList.add('closing');
    const onEnd = () => {
        panel.style.display = 'none';
        panel.classList.remove('closing');
        panel.removeEventListener('animationend', onEnd);
    };
    panel.addEventListener('animationend', onEnd);
    historyManager.remove('favoritesPanel');
}

function renderFavorites() {
    const container = $('#favoritesContainer');
    container.innerHTML = '';
    const activeFavs = state.activeFavorites();
    if (activeFavs.length === 0) {
        container.innerHTML = '<p class="no-history">還沒有收藏 — 在播放頁點右上角的 ⭐ 加入</p>';
        return;
    }
    activeFavs.forEach(fav => {
        const card = document.createElement('div');
        card.className = 'history-item';
        const pic = fav.videoPic && fav.videoPic.trim()
            ? fav.videoPic
            : `https://placehold.co/300x400/666666/ffffff.png?text=${encodeURIComponent((fav.videoName || '').replace(/[^\w\s]/g, '').substring(0, 10) || 'No Image')}`;
        const site = state.sites.find(s => s.url === fav.siteUrl);
        const siteName = fav.siteName || site?.name || '未知站台';
        // 收藏與歷史共用 videoId+siteUrl 為鍵：看過的就帶出上次的集數+進度,點播放接著看
        const hist = state.watchHistory.find(h =>
            !h.deletedAt &&
            String(h.videoId) === String(fav.videoId) &&
            h.siteUrl === fav.siteUrl);
        const progressPercent = hist && hist.duration > 0
            ? Math.round((hist.currentTime / hist.duration) * 100) : 0;
        const progressBlock = hist ? `
                    <div class="history-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <div class="progress-text">${formatPlayTime(hist.currentTime)} / ${formatPlayTime(hist.duration)}</div>
                    </div>` : '';
        card.innerHTML = `
            <div class="history-pic-wrapper">
                <img class="history-pic" src="${pic}" alt="${fav.videoName}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/300x400/666666/ffffff.png?text=No+Image';">
            </div>
            <div class="history-content">
                <div class="history-header">
                    <div class="history-title" title="${fav.videoName}">${fav.videoName}</div>
                    <button class="btn btn-ghost btn-icon btn-sm unfav-btn" title="取消收藏">
                        <svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    </button>
                </div>
                <div class="history-details">
                    ${hist ? `<span class="history-episode">${hist.episodeName || '未知劇集'}</span>` : ''}
                    <span class="history-site">${siteName}</span>
                </div>
                <div class="history-bottom">
                    ${progressBlock}
                    <div class="history-actions-btns">
                        <button class="btn btn-primary btn-sm fav-play-btn">${hist ? '繼續觀看' : '播放'}</button>
                    </div>
                </div>
            </div>
        `;
        const open = () => {
            hideFavoritesPanel();
            if (hist) {
                playFromHistory(hist, false);
            } else {
                openModal({ vod_id: fav.videoId, vod_name: fav.videoName, vod_pic: fav.videoPic, from_site_id: site?.id });
            }
        };
        card.querySelector('.fav-play-btn').addEventListener('click', open);
        card.querySelector('.history-pic-wrapper').addEventListener('click', open);
        card.querySelector('.unfav-btn').addEventListener('click', () => {
            state.toggleFavorite(fav);
            renderFavorites();
            updateFavoriteButton();
            showToast('已取消收藏');
        });
        container.appendChild(card);
    });
}


// 檢查歷史記錄更新
async function performHistoryUpdateCheck() {
    if (state.activeHistory().length === 0) {
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
        const itemsToCheck = state.activeHistory().slice(0, 5).map(item => ({
            videoId: item.videoId,
            videoName: item.videoName,
            siteUrl: item.siteUrl,
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
                        item.siteUrl === checkResult.siteUrl
                    );

                    if (historyItem) {
                        // 更新總集數
                        if (checkResult.totalEpisodes !== undefined) {
                            historyItem.totalEpisodes = checkResult.totalEpisodes;
                            historyModified = true;
                        }

                        // 如果有更新，記錄更新信息
                        if (checkResult.hasUpdate) {
                            const key = `${checkResult.videoId}_${checkResult.siteUrl}`;
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
