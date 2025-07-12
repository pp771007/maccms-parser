import state from './state.js';
import { playVideo } from './player.js';
import { fetchVideoDetails } from './api.js';
import { $, $$ } from './utils.js';

export function renderSites(sites) {
    const selector = $('#siteSelector');
    const currentVal = selector.value;
    selector.innerHTML = '<option value="">-- 請選擇一個站點 --</option>';
    sites.forEach(site => {
        selector.innerHTML += `<option value="${site.id}">${site.name}</option>`;
    });
    if (sites.some(s => s.id == currentVal)) {
        selector.value = currentVal;
    }
}

export function renderCategories(categories) {
    const nav = $('#category-nav');
    nav.innerHTML = `<span class="category-tag" data-id="">全部</span>`;
    if (categories && categories.length > 0) {
        categories.forEach(cat => {
            nav.innerHTML += `<span class="category-tag" data-id="${cat.type_id}">${cat.type_name}</span>`;
        });
    }
}

export function renderVideos(videos) {
    const grid = $('#videoGrid');
    grid.innerHTML = '';
    if (!videos || videos.length === 0) {
        grid.innerHTML = '<p style="text-align: center; grid-column: 1 / -1; padding: 20px;">沒有找到相關內容。</p>';
        return;
    }
    videos.forEach((video) => {
        const card = document.createElement('div');
        card.className = 'video-card';
        const placeholderText = encodeURIComponent(video.vod_name.substring(0, 10));
        const placeholderUrl = `https://via.placeholder.com/300x400.png?text=${placeholderText}`;
        const finalImageUrl = video.vod_pic ? video.vod_pic : placeholderUrl;
        card.innerHTML = `
            <div class="video-pic-wrapper">
                <img class="video-pic" src="${finalImageUrl}" alt="${video.vod_name}" loading="lazy" onerror="this.onerror=null;this.src='${placeholderUrl}';">
            </div>
            <div class="video-info">
                <div class="video-title" title="${video.vod_name}">${video.vod_name}</div>
                <div class="video-note">${video.vod_remarks || ''}</div>
            </div>
        `;
        card.addEventListener('click', () => openModal(video));
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

export function updateActiveCategory(currentTypeId) {
    $$('.category-tag').forEach(tag => {
        const id = tag.dataset.id === "" ? null : tag.dataset.id;
        tag.classList.toggle('active', id == currentTypeId);
    });
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
        const result = await fetchVideoDetails(state.currentSite.url, video.vod_id);
        state.modalData = result.data;
        renderPlaylist();
    } catch (err) {
        $('#episodeList').innerHTML = `<p style="color:red;">獲取播放列表失敗: ${err.message}</p>`;
    }
}

function renderPlaylist(sourceIndex = 0) {
    if (!state.modalData || state.modalData.length === 0) {
        $('#episodeList').innerHTML = '<p>沒有可用的播放源。</p>';
        return;
    }

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
