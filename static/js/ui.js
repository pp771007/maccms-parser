import state from './state.js';
import { playVideo } from './player.js';
import { fetchVideoDetails, checkHistoryUpdates, fetchMultiSiteVideoList } from './api.js';
import { $, $$, matchEpisodeIndex } from './utils.js';
import { showModal, showConfirm, showToast } from './modal.js';
import historyManager from './historyStateManager.js';
import { armConfirmDelete } from './confirmDelete.js';
import { clearVideoParams } from './urlState.js';

// 續看意圖:從歷史 / 分享連結開片時,記住「要對齊到哪一集、從幾秒接續」。
// playActiveLine 首次播放時消化它;之後換線路 / 換站改用播放器當前秒數。null = 無(全新開片)。
let pendingResume = null; // { item: historyItem, seconds: number } | null

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

// ===== 播放器 modal:三層(站台 / 線路 / 劇集)=====
// 一部片可在多個「站台」播,每個站台底下有多條「線路」,每條線路有自己的「劇集」。三層各自獨立切換:
// 切站 / 切線路都帶著「同一集 + 目前秒數」續播;「🔍 其他站」只把更多站台加進站台列,不打斷正在播的。

// 同次開啟期間快取各站詳情(線路清單),切站切回來不必重抓。closeModal 清掉。
const detailsCache = new Map();
const detailsKey = (siteUrl, vodId) => `${siteUrl}||${vodId}`;
function cacheDetails(siteUrl, vodId, data) { detailsCache.set(detailsKey(siteUrl, vodId), data); }

// 把影片資訊正規化成「站台列的一個選項」
function siteOptionFrom({ siteUrl, siteName, siteId, vodId, videoName, videoPic }) {
    return { siteUrl, siteName, siteId, vodId, videoName: videoName || '', videoPic: videoPic || '' };
}

function makeChip(text, active) {
    const btn = document.createElement('button');
    btn.className = 'source-btn' + (active ? ' active' : '');
    btn.textContent = text;
    return btn;
}

function setSectionVisible(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
}

function activeEpisodes() {
    return state.modalData?.[state.currentSourceIndex]?.episodes || [];
}

// 所有開啟播放器的入口共用。siteOptions:站台列(至少 1 個);activeIdx:先播哪個站;resumeItem:續看點。
function openVideoModal({ siteOptions, activeIdx = 0, resumeItem = null }) {
    if (!siteOptions || siteOptions.length === 0) return;
    historyManager.add({
        id: 'videoModal',
        apply: () => {
            state.modalOpen = true;
            document.body.classList.add('modal-open');
            $('#videoModal').style.display = 'flex';
            $('#playlistSites').innerHTML = '';
            $('#playlistSources').innerHTML = '';
            $('#episodeList').innerHTML = '正在加載播放列表...';
            updateSourceCountDisplay();

            state.siteOptions = siteOptions;
            state.activeSiteIdx = Math.min(Math.max(activeIdx, 0), siteOptions.length - 1);
            state.crossSiteSearched = false;
            pendingResume = resumeItem ? { item: resumeItem, seconds: resumeItem.currentTime || 0 } : null;
            loadActiveSite();
        },
        revert: closeModal,
        context: { siteOptions, activeIdx },
    });
}

// 載入「目前站台」的線路清單,渲染三層,並依續看意圖播放。
async function loadActiveSite() {
    const opt = state.siteOptions[state.activeSiteIdx];
    if (!opt) return;
    state.playbackSite = { id: opt.siteId, name: opt.siteName, url: opt.siteUrl };
    state.currentVideo = { vod_id: opt.vodId, vod_name: opt.videoName, vod_pic: opt.videoPic, from_site_id: opt.siteId };
    $('.title-text').textContent = opt.videoName || '';
    renderSiteRow();
    $('#playlistSources').innerHTML = '';
    $('#episodeList').innerHTML = '載入中...';

    let data = detailsCache.get(detailsKey(opt.siteUrl, opt.vodId));
    if (!data) {
        try {
            const result = await fetchVideoDetails(opt.siteUrl, opt.vodId);
            data = result.data || [];
            cacheDetails(opt.siteUrl, opt.vodId, data);
        } catch (err) {
            if (!state.modalOpen) return;
            $('#episodeList').innerHTML = `<p style="color:var(--danger-color)">載入失敗:${err.message}。可改選其他站台。</p>`;
            return;
        }
    }
    if (!state.modalOpen) return; // 載入途中被關了
    state.modalData = data;

    // 沒帶續看點(非切站帶過來的)→ 撈這個站台「最近看的那條線路」當續看點(各線路獨立,取最新)
    if (!pendingResume) {
        const cands = state.watchHistory.filter(i =>
            String(i.videoId) === String(opt.vodId) && i.siteUrl === opt.siteUrl && !i.deletedAt);
        const saved = cands.reduce((a, b) => (!a || (b.lastWatched || 0) > (a.lastWatched || 0)) ? b : a, null);
        if (saved && (saved.currentTime || 0) > 0) pendingResume = { item: saved, seconds: saved.currentTime };
    }

    // 選線路:有續看點就找它所在的線路;找不到(原線路掛了)或沒續看點 → 第一條有集數的線路
    const firstNonEmpty = data.findIndex(s => s.episodes && s.episodes.length > 0);
    let lineIdx = Math.max(0, firstNonEmpty);
    let lineMissing = false;
    if (pendingResume?.item) {
        const ti = findTargetSourceIndex(pendingResume.item, data);
        if (ti >= 0) lineIdx = ti; else lineMissing = true;
    }
    state.currentSourceIndex = lineIdx;
    renderSiteRow();
    renderLineRow();

    if (lineMissing && (pendingResume?.seconds || 0) > 0) {
        // 原本看的那條線路在這個站台已不存在:不自動改播別條(會把續看歸零),保留續看點,
        // 只渲染劇集讓使用者自己挑線路 / 集數(或切到別站),挑了會帶著集數 + 秒數續看。
        renderEpisodeRow();
        showToast('原本觀看的線路已失效,已保留進度。可改選其他線路或站台續看。', 'warning');
    } else {
        playActiveLine({ autoPlay: true });
    }
}

export async function openModal(video) {
    // 從清單 / 收藏點開的單一影片。站台:有 from_site_id 用它,否則用目前瀏覽的站台。
    let site;
    if (video.from_site_id) {
        site = state.sites.find(s => s.id === video.from_site_id);
        if (!site) { showModal('在站台列表中找不到對應站台。', 'error'); return; }
    } else if (state.currentSite) {
        site = state.currentSite;
    } else { showModal('無法確定要從哪個站台播放。', 'error'); return; }

    openVideoModal({
        siteOptions: [siteOptionFrom({
            siteUrl: site.url, siteName: site.name, siteId: site.id,
            vodId: video.vod_id, videoName: video.vod_name, videoPic: video.vod_pic,
        })],
    });
}

// 首頁清單點到「同一片名在多個站台都有」時用:把那些站台變成站台列。autoSelectIndex 先播哪個站。
export async function openMultiSourceModal(videoName, videoList, autoSelectIndex = 0) {
    const seen = new Set();
    const siteOptions = videoList.map(v => {
        const site = state.sites.find(s => s.id === v.from_site_id);
        if (!site || seen.has(site.url)) return null;
        seen.add(site.url);
        return siteOptionFrom({
            siteUrl: site.url, siteName: v.from_site || site.name, siteId: site.id,
            vodId: v.vod_id, videoName: v.vod_name || videoName, videoPic: v.vod_pic,
        });
    }).filter(Boolean);
    if (siteOptions.length === 0) { showModal('找不到可播放的站台。', 'error'); return; }
    openVideoModal({ siteOptions, activeIdx: autoSelectIndex });
}

// 站台列:目前片可播的各站台 + 「🔍 其他站」鈕(只搜尋、把更多站台加進這列,不打斷正在播的)。
function renderSiteRow() {
    const row = $('#playlistSites');
    row.innerHTML = '';
    state.siteOptions.forEach((opt, idx) => {
        const btn = makeChip(opt.siteName || `站台${idx + 1}`, idx === state.activeSiteIdx);
        btn.onclick = () => switchSite(idx);
        row.appendChild(btn);
    });
    if (!state.crossSiteSearched) {
        const btn = document.createElement('button');
        btn.className = 'source-btn cross-site-trigger';
        btn.textContent = '🔍 其他站';
        btn.onclick = () => searchOtherSites(btn);
        row.appendChild(btn);
    }
    setSectionVisible('sitesSection', true);
}

// 線路列:目前站台底下的各條線路(同一部戲不同播放源)。只有 1 條就不顯示這列。
function renderLineRow() {
    const row = $('#playlistSources');
    row.innerHTML = '';
    const lines = state.modalData || [];
    lines.forEach((src, i) => {
        const btn = makeChip(src.flag || `線路${i + 1}`, i === state.currentSourceIndex);
        btn.onclick = () => switchLine(i);
        row.appendChild(btn);
    });
    setSectionVisible('sourcesSection', lines.length > 1);
}

// 劇集列:目前線路的集數。點某一集 = 從頭播該集。
function renderEpisodeRow() {
    const list = $('#episodeList');
    list.innerHTML = '';
    const eps = activeEpisodes();
    if (eps.length === 0) { list.innerHTML = '<p>此線路下沒有劇集。</p>'; return; }
    eps.forEach((epi, i) => {
        const el = document.createElement('div');
        el.className = 'episode-item' + (i === state.currentEpisodeIndex ? ' playing' : '');
        el.textContent = epi.name;
        el.onclick = () => {
            state.currentEpisodeIndex = i;
            pendingResume = null; // 手動點某集 = 從頭播該集
            markPlaying(i);
            playVideo(epi.url, el, buildInfo(epi));
        };
        list.appendChild(el);
    });
}

function markPlaying(i) {
    $$('#episodeList .episode-item').forEach((el, idx) => el.classList.toggle('playing', idx === i));
}

// 組一集的播放資訊(歷史 / 收藏 / 續播都靠這包):站台一律取自目前選中的站台選項(以 siteUrl 為識別)。
function buildInfo(epi) {
    const opt = state.siteOptions[state.activeSiteIdx] || {};
    return {
        videoId: opt.vodId,
        videoName: opt.videoName,
        episodeName: epi.name,
        episodeUrl: epi.url,
        siteUrl: opt.siteUrl,
        siteName: opt.siteName,
        videoPic: opt.videoPic || '',
        // 目前線路名,給歷史「各線路獨立進度」用(多線路續看)
        sourceFlag: state.modalData?.[state.currentSourceIndex]?.flag || '',
    };
}

// 播放「目前站台 + 目前線路」:渲染劇集,再依續看意圖(歷史 / 切站 / 切線路)對齊集數 + 帶秒數;
// 沒有續看意圖也沒在播 → 播第一集。autoPlay=false 只渲染不播(原線路掛了、保留進度時用)。
function playActiveLine({ autoPlay = true } = {}) {
    renderEpisodeRow();
    if (!autoPlay) return;
    const eps = activeEpisodes();
    if (eps.length === 0) return;

    const aligning = pendingResume && pendingResume.item;
    let idx, resumeSec;
    if (aligning) {
        idx = matchEpisodeIndex(
            pendingResume.item.episodeName || '',
            pendingResume.item.episodeIndex >= 0 ? pendingResume.item.episodeIndex : 0,
            eps,
        );
        resumeSec = pendingResume.seconds || 0;
        pendingResume = null; // 續看意圖已消化
    } else if (state.artplayer) {
        // 換線路 / 換站(已在播):對齊同一集 + 帶當前秒數
        idx = matchEpisodeIndex(state.currentVideoInfo?.episodeName || '', state.currentEpisodeIndex ?? 0, eps);
        resumeSec = state.artplayer.currentTime || 0;
    } else {
        idx = 0;
        resumeSec = 0;
    }
    state.currentEpisodeIndex = idx;
    markPlaying(idx);
    const epi = eps[idx];
    playVideo(epi.url, $$('#episodeList .episode-item')[idx], buildInfo(epi), resumeSec > 2 ? { currentTime: resumeSec } : null);
}

// 切站:換站台,帶著同一集 + 目前秒數(找不到原線路 / 集數時各自智慧對齊)。
function switchSite(idx) {
    if (idx === state.activeSiteIdx && state.artplayer) return;
    carryResumeFromPlayer();
    state.activeSiteIdx = idx;
    loadActiveSite();
}

// 切線路:這條線路自己看過 → 接它自己存的進度(集 + 秒);沒看過 → 帶著目前這集 + 秒數對齊。
function switchLine(i) {
    if (i === state.currentSourceIndex && state.artplayer) return;
    const targetFlag = state.modalData?.[i]?.flag || '';
    const opt = state.siteOptions[state.activeSiteIdx];
    // 這條線路自己的歷史那一筆(各線路獨立)
    const rec = opt && state.watchHistory.find(h =>
        String(h.videoId) === String(opt.vodId) && h.siteUrl === opt.siteUrl
        && (h.sourceFlag || '') === targetFlag && !h.deletedAt);
    if (rec && (rec.currentTime || 0) > 2) {
        pendingResume = {
            item: { episodeName: rec.episodeName || '', episodeIndex: rec.episodeIndex >= 0 ? rec.episodeIndex : 0, currentTime: rec.currentTime || 0 },
            seconds: rec.currentTime || 0,
        };
    } else {
        carryResumeFromPlayer();
    }
    state.currentSourceIndex = i;
    renderLineRow();
    playActiveLine({ autoPlay: true });
}

// 正在播 → 把目前集數 + 秒數記成續看點(切站 / 切線路帶著走);
// 還沒播(例如原線路掛了、停在保留進度狀態)→ 保留既有的續看點,別覆蓋成 0。
function carryResumeFromPlayer() {
    if (!state.artplayer) return;
    const pos = state.artplayer.currentTime || 0;
    pendingResume = {
        item: {
            episodeName: state.currentVideoInfo?.episodeName || '',
            episodeIndex: state.currentEpisodeIndex ?? 0,
            currentTime: pos,
        },
        seconds: pos,
    };
}

// 用目前片名跨站搜同名片(精確同名),回傳其他站的影片清單(含 from_site_id)
async function findPeersOnOtherSites() {
    const name = state.siteOptions[state.activeSiteIdx]?.videoName || state.currentVideo?.vod_name;
    if (!name) return [];
    const ids = state.sites.filter(s => s.enabled !== false).map(s => s.id);
    try {
        const res = await fetchMultiSiteVideoList(ids, 1, name);
        return (res.list || []).filter(v => v.vod_name === name && v.from_site_id != null);
    } catch (e) {
        console.error('跨站搜尋同名片失敗:', e);
        return [];
    }
}

// 「🔍 其他站」:只去搜同名片、把找到的站台加進站台列,完全不動正在播的畫面 / 秒數。
async function searchOtherSites(btn) {
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.textContent = '搜尋中…';
    const peers = await findPeersOnOtherSites();
    if (!state.modalOpen) return;
    const existing = new Set(state.siteOptions.map(o => o.siteUrl));
    const added = [];
    for (const p of peers) {
        const site = state.sites.find(s => s.id === p.from_site_id);
        if (!site || existing.has(site.url)) continue;
        existing.add(site.url);
        added.push(siteOptionFrom({
            siteUrl: site.url, siteName: p.from_site || site.name, siteId: site.id,
            vodId: p.vod_id, videoName: p.vod_name, videoPic: p.vod_pic,
        }));
    }
    state.siteOptions = state.siteOptions.concat(added);
    state.crossSiteSearched = true; // 搜過就不再顯示「其他站」鈕
    renderSiteRow();
    showToast(added.length > 0 ? `已加入 ${added.length} 個其他站台` : '其他站找不到同名影片',
        added.length > 0 ? 'success' : 'info');
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
    state.currentSourceIndex = 0; // 重置線路索引
    state.currentVideo = null; // 重置當前影片資訊
    state.siteOptions = []; // 清空站台列
    state.activeSiteIdx = 0;
    state.crossSiteSearched = false;
    state.playbackSite = null; // 清掉播放站台,不影響背景瀏覽清單
    pendingResume = null; // 清掉未消化的續看意圖
    detailsCache.clear(); // 清掉本次開啟的詳情快取

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
                    ${item.sourceFlag ? `<span class="history-line" title="這筆是哪條線路的進度">線路:${item.sourceFlag}</span>` : ''}
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
            state.removeHistory(item.videoId, item.siteUrl, item.sourceFlag);  // 軟刪(標記墓碑,跟著同步)
            renderWatchHistory();
            showToast('已移除觀看紀錄');
        });

        historyContainer.appendChild(historyItem);
    });
}

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
        const data = result.data;
        if (!data || data.length === 0) { showModal('找不到這部影片的播放內容,可能已從站台移除。', 'warning'); return; }

        let target = item;
        if (next) {
            target = computeNextEpisodeItem(item, data);
            if (!target) { showToast('已經是最後一集了', 'info'); return; }
        }
        openUnifiedVideoModal({
            siteUrl,
            siteName: item.siteName,
            video: { vod_id: item.videoId, vod_name: item.videoName, vod_pic: item.videoPic },
            data,
            resumeItem: target,
        });
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
        const data = result.data;
        if (!data || data.length === 0) {
            showModal('找不到這部影片的播放內容,可能已從站台移除。', 'warning');
            return;
        }

        const safeSrc = (src >= 0 && src < data.length) ? src : 0;
        const epList = data[safeSrc].episodes || [];
        const safeEp = (ep >= 0 && ep < epList.length) ? ep : 0;
        const targetEp = epList[safeEp];

        // 網址只帶來源 / 集索引,沒帶秒數。秒數存在伺服器歷史裡(綁帳號、跨裝置)。
        // 各線路獨立 → 撈「這條線路(targetFlag)」那一筆,且續看點正是這一集時才接秒數。
        const targetFlag = data[safeSrc]?.flag || '';
        const saved = state.watchHistory.find(i =>
            String(i.videoId) === String(vodId) && i.siteUrl === siteUrl
            && (i.sourceFlag || '') === targetFlag && !i.deletedAt);
        const resumeSec = (saved && targetEp && episodeMatchesHistory(targetEp, saved)) ? (saved.currentTime || 0) : 0;

        openUnifiedVideoModal({
            siteUrl,
            video: { vod_id: vodId, vod_name: result.vod_name || '', vod_pic: result.vod_pic || '' },
            data,
            resumeItem: {
                videoId: vodId,
                episodeUrl: targetEp?.url || '',
                episodeName: targetEp?.name || '',
                episodeIndex: safeEp,
                currentTime: resumeSec,
            },
        });
    } catch (err) {
        console.error('從網址開片失敗:', err);
        showModal('開啟分享的影片失敗,站台可能已失效。', 'error');
    }
}

// 統一的播放器開啟流程(歷史 / 分享連結用),跟首頁 openModal 走同一套三層 modal。
// data:已抓好的詳情(線路清單),先塞進快取避免重抓。resumeItem:要續看的那一集(含 currentTime)。
function openUnifiedVideoModal({ siteUrl, video, siteName, data, resumeItem = null }) {
    // 顯示用站名:本地清單有這站就用清單名;沒有(跨裝置 / 跨 app 的歷史)退用站台網域,再不行用整串 url。
    const localSite = state.sites.find(s => s.url === siteUrl);
    let name = siteName || localSite?.name;
    if (!name) {
        try { name = new URL(siteUrl).hostname; } catch { /* siteUrl 非合法 url */ }
        if (!name) name = siteUrl;
    }
    if (data) cacheDetails(siteUrl, video.vod_id, data); // 已抓好的詳情先快取,loadActiveSite 就不重抓
    openVideoModal({
        siteOptions: [siteOptionFrom({
            siteUrl, siteName: name, siteId: localSite?.id,
            vodId: video.vod_id, videoName: video.vod_name, videoPic: video.vod_pic,
        })],
        resumeItem,
    });
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
        // 收藏顯示進度:歷史已拆成每線路一筆,取這部片這站台「最近看的那條線路」
        const hist = state.watchHistory
            .filter(h => !h.deletedAt && String(h.videoId) === String(fav.videoId) && h.siteUrl === fav.siteUrl)
            .reduce((a, b) => (!a || (b.lastWatched || 0) > (a.lastWatched || 0)) ? b : a, null);
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
                // 收藏以 siteUrl 為識別,直接用它開(站台不在本地清單也行,跨裝置 / kazi 同步的收藏一樣可播)
                openUnifiedVideoModal({
                    siteUrl: fav.siteUrl,
                    siteName: fav.siteName,
                    video: { vod_id: fav.videoId, vod_name: fav.videoName, vod_pic: fav.videoPic },
                    data: null,
                    resumeItem: null,
                });
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
        // 各線路獨立 → 同片同站可能多筆,檢查更新以「片+站」去重,避免重複送同一部片
        const seenVS = new Set();
        const itemsToCheck = state.activeHistory().filter(item => {
            const k = `${item.videoId}|${item.siteUrl}`;
            if (seenVS.has(k)) return false;
            seenVS.add(k);
            return true;
        }).slice(0, 5).map(item => ({
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
                    // 各線路獨立 → 同片同站可能多筆,全部一起更新總集數
                    const matches = state.watchHistory.filter(item =>
                        item.videoId === checkResult.videoId &&
                        item.siteUrl === checkResult.siteUrl
                    );

                    if (matches.length > 0) {
                        // 更新總集數
                        if (checkResult.totalEpisodes !== undefined) {
                            matches.forEach(m => { m.totalEpisodes = checkResult.totalEpisodes; });
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
