// 搜尋紀錄存 localStorage,但 localStorage 是整站共用、跟登入帳號無關。
// 不按帳號分 key 的話,換帳號後前一個帳號的搜尋 tag 會殘留。用 account_id 當後綴隔離。
const SEARCH_HISTORY_KEY_PREFIX = 'searchHistory:';
const LEGACY_SEARCH_HISTORY_KEY = 'searchHistory'; // 舊版未分帳號的 key,載入時清掉避免殘留

function searchHistoryKey() {
    const meta = document.querySelector('meta[name="account-id"]');
    const acct = (meta && meta.content) || 'anon';
    return SEARCH_HISTORY_KEY_PREFIX + acct;
}

export default {
    sites: [],
    currentSite: null,
    videos: [],
    categories: [],
    currentPage: 1,       // 資料頁(外層,向伺服器抓)
    totalPages: 1,
    aggregated: [],       // 聚合後的影片群組(整個資料頁)
    displayPage: 1,       // 顯示頁(內層,前端切片)
    innerPageCount: 1,    // 這個資料頁切成幾個顯示頁
    _pendingDisplayLast: false, // 往前跨資料頁時,下一次 render 停在最後一個顯示頁
    currentTypeId: null,
    currentKeyword: null,
    artplayer: null,
    modalOpen: false, // 播放器 modal 是否開著;關掉後攔住「載入詳情時就關了、之後才建播放器」造成的背景播放
    modalData: null,
    searchSiteIds: [], // 多來源影片列表
    currentSourceIndex: 0, // 當前選擇的來源索引
    currentEpisodeIndex: 0, // 當前播放第幾集(換線路/換站對齊集數時當 fallback)
    watchHistory: [], // 觀看歷史紀錄(綁帳號、存伺服器端)
    historySyncedAt: 0,        // 最後一次從伺服器抓歷史的時間(顯示「最後同步」)
    _historyDirty: false,      // 記憶體有變動、尚未寫回伺服器
    _historyFlushTimer: null,  // 寫回伺服器的 debounce 計時器
    favorites: [],    // 收藏(共通格式,鍵=videoId+siteUrl,跟 kazi 共用)
    currentVideoInfo: null, // 當前播放的影片資訊
    currentVideo: null, // 當前選擇的影片資訊
    onHistoryUpdate: null, // 歷史記錄更新回調函數
    onPlaybackChange: null, // 播放開始時的回調(更新收藏星號)
    historyUpdateInfo: {}, // 存儲歷史記錄的更新信息 {videoId_siteUrl: {hasUpdate: bool, newEpisodesCount: number}}

    // 檢查是否需要檢查歷史記錄更新（10分鐘內不重複檢查）
    shouldCheckHistoryUpdates() {
        const lastCheck = localStorage.getItem('lastHistoryUpdateCheck');
        if (!lastCheck) return true;
        
        const lastCheckTime = parseInt(lastCheck);
        const now = Date.now();
        const tenMinutes = 10 * 60 * 1000; // 10分鐘
        
        return (now - lastCheckTime) > tenMinutes;
    },

    // 更新最後檢查時間
    updateLastCheckTime() {
        localStorage.setItem('lastHistoryUpdateCheck', Date.now().toString());
    },

    // 清除歷史記錄更新信息
    clearHistoryUpdateInfo() {
        this.historyUpdateInfo = {};
    },

    // 從localStorage載入多選站台設定
    loadMultiSiteSelection() {
        const saved = localStorage.getItem('multiSiteSelection');
        if (saved) {
            try {
                this.searchSiteIds = JSON.parse(saved);
            } catch (e) {
                console.error('載入多選站台設定失敗:', e);
                this.searchSiteIds = [];
            }
        }
    },

    // 儲存多選站台設定到localStorage
    saveMultiSiteSelection() {
        localStorage.setItem('multiSiteSelection', JSON.stringify(this.searchSiteIds));
    },

    // ---- 共通歷史格式(與 kazi 共用):鍵=videoId+siteUrl;續看錨點用 episodeName(兩邊都存)----
    // 網頁內部沿用原本的欄位,只在「跟伺服器來回」時轉換。
    _historyToCanonical(item) {
        return {
            videoId: item.videoId,
            siteUrl: item.siteUrl || '',
            siteName: item.siteName || '',
            videoName: item.videoName || '',
            videoPic: item.videoPic || '',
            episodeName: item.episodeName || '',
            episodeUrl: item.episodeUrl || '',   // 網頁有;kazi 寫的可能是空
            sourceIndex: item.sourceIndex || 0,
            episodeIndex: typeof item.episodeIndex === 'number' ? item.episodeIndex : -1,
            positionSec: item.currentTime || 0,
            durationSec: item.duration || 0,
            totalEpisodes: item.totalEpisodes || 0,
            updatedAt: item.lastWatched || item.timestamp || Date.now(),
            deletedAt: item.deletedAt || 0,
        };
    },

    _historyFromCanonical(c) {
        return {
            videoId: c.videoId,
            siteUrl: c.siteUrl || '',
            siteName: c.siteName || '',
            videoName: c.videoName || '',
            videoPic: c.videoPic || '',
            episodeName: c.episodeName || '',
            episodeUrl: c.episodeUrl || '',
            sourceIndex: c.sourceIndex || 0,
            episodeIndex: typeof c.episodeIndex === 'number' ? c.episodeIndex : -1,
            currentTime: c.positionSec || 0,
            duration: c.durationSec || 0,
            totalEpisodes: c.totalEpisodes || 0,
            lastWatched: c.updatedAt || Date.now(),
            timestamp: c.updatedAt || Date.now(),
            deletedAt: c.deletedAt || 0,
        };
    },

    // 載入觀看歷史紀錄(從伺服器讀共通格式,綁帳號、跨裝置/跨 app 同步)。每次開頁只讀一次。
    async loadWatchHistory() {
        try {
            const res = await fetch('/api/history');
            const data = res.ok ? await res.json() : [];
            const list = Array.isArray(data) ? data.map(c => this._historyFromCanonical(c)) : [];
            // 保留墓碑(deletedAt>0)一起存,下次寫回時帶上去讓刪除跨裝置生效;但超過 TTL 的墓碑清掉
            this.watchHistory = this._pruneTombstones(list);
            this.historySyncedAt = Date.now();
        } catch (e) {
            this.watchHistory = [];
        }
    },

    // 丟掉超過 30 天的墓碑(其他裝置早該同步到刪除了),避免清單無限長大
    _pruneTombstones(list) {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        return list.filter(i => !i.deletedAt || i.deletedAt > cutoff);
    },

    // 只給 UI 看的「未刪」歷史
    activeHistory() {
        return this.watchHistory.filter(i => !i.deletedAt);
    },

    // 載入搜尋關鍵字歷史記錄
    loadSearchHistory() {
        localStorage.removeItem(LEGACY_SEARCH_HISTORY_KEY);
        const saved = localStorage.getItem(searchHistoryKey());
        if (saved) {
            try {
                this.searchHistory = JSON.parse(saved);
            } catch (e) {
                console.error('載入搜尋歷史記錄失敗:', e);
                this.searchHistory = [];
            }
        } else {
            this.searchHistory = [];
        }
    },

    // 儲存搜尋關鍵字歷史記錄
    saveSearchHistory() {
        localStorage.setItem(searchHistoryKey(), JSON.stringify(this.searchHistory));
    },

    // 添加搜尋關鍵字到歷史記錄
    addSearchKeyword(keyword) {
        if (!keyword || keyword.trim() === '') return;

        const trimmedKeyword = keyword.trim();

        // 移除重複的關鍵字
        this.searchHistory = this.searchHistory.filter(item => item !== trimmedKeyword);

        // 添加到開頭
        this.searchHistory.unshift(trimmedKeyword);

        // 限制數量（最多20個）
        if (this.searchHistory.length > 20) {
            this.searchHistory = this.searchHistory.slice(0, 20);
        }

        this.saveSearchHistory();
    },

    // 清除搜尋關鍵字歷史記錄
    clearSearchHistory() {
        this.searchHistory = [];
        this.saveSearchHistory();
    },

    // 標記有變動 + 防抖寫回伺服器(把連續變動合併成一次寫入,少打伺服器)。
    // 用在「離散事件」:新增/換集、清除、刪一筆。播放中的進度 tick 不走這裡(見 updateProgress)。
    saveWatchHistory() {
        this._historyDirty = true;
        if (this._historyFlushTimer) clearTimeout(this._historyFlushTimer);
        this._historyFlushTimer = setTimeout(() => this.flushWatchHistory(), 2500);
    },

    // 真正寫回伺服器,只有 dirty 時才打。供 debounce / 關閉播放器 / 每分鐘保險 / 關分頁 呼叫。
    flushWatchHistory() {
        if (this._historyFlushTimer) {
            clearTimeout(this._historyFlushTimer);
            this._historyFlushTimer = null;
        }
        if (!this._historyDirty) return;
        this._historyDirty = false;
        fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.watchHistory.map(it => this._historyToCanonical(it))),
        }).catch(() => { this._historyDirty = true; });
    },

    // ---- 收藏(共通格式,鍵=videoId+siteUrl,跟 kazi 同一支 /api/favorites)----
    async loadFavorites() {
        try {
            const res = await fetch('/api/favorites');
            const data = res.ok ? await res.json() : [];
            // 保留墓碑一起存(同步用),超過 TTL 的清掉
            this.favorites = this._pruneTombstones(Array.isArray(data) ? data : []);
        } catch (e) {
            this.favorites = [];
        }
    },

    saveFavorites() {
        // 收藏變動不頻繁,整包寫回即可(含墓碑)
        fetch('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.favorites),
        }).catch(() => {});
    },

    // 只給 UI 看的「未刪」收藏
    activeFavorites() {
        return this.favorites.filter(f => !f.deletedAt);
    },

    isFavorited(videoId, siteUrl) {
        return this.favorites.some(f => String(f.videoId) === String(videoId) && f.siteUrl === siteUrl && !f.deletedAt);
    },

    // 切換收藏;回傳切換後是否為已收藏
    toggleFavorite(fav) {
        const idx = this.favorites.findIndex(f => String(f.videoId) === String(fav.videoId) && f.siteUrl === fav.siteUrl);
        if (idx >= 0 && !this.favorites[idx].deletedAt) {
            // 取消收藏 = 標記墓碑(留著跟著同步),而非直接移除
            this.favorites[idx].deletedAt = Date.now();
            this.saveFavorites();
            return false;
        }
        // 收藏:新的、或把舊墓碑用一筆全新的蓋過去(復活)
        if (idx >= 0) this.favorites.splice(idx, 1);
        this.favorites.unshift({ ...fav, addedAt: Date.now(), deletedAt: 0 });
        this.saveFavorites();
        return true;
    },

    // 添加觀看歷史紀錄
    addToHistory(videoInfo) {

        // 查找是否已存在同一部影片的記錄（鍵=videoId+siteUrl，跟收藏 / kazi 同步一致）
        const existingIndex = this.watchHistory.findIndex(item =>
            item.videoId === videoInfo.videoId &&
            item.siteUrl === videoInfo.siteUrl
        );

        if (existingIndex !== -1) {
            // 如果存在，更新現有記錄
            const existingItem = this.watchHistory[existingIndex];
            const isNewEpisode = existingItem.episodeUrl !== videoInfo.episodeUrl;

            existingItem.deletedAt = 0; // 又看了 → 若之前刪過,復活成正常(時間戳會比舊墓碑新)
            existingItem.videoName = videoInfo.videoName; // 確保影片名稱被更新
            existingItem.episodeName = videoInfo.episodeName;
            existingItem.episodeUrl = videoInfo.episodeUrl;

            // 更新圖片URL（如果新的有圖片而舊的沒有，或者新的圖片不同）
            if (videoInfo.videoPic && (!existingItem.videoPic || existingItem.videoPic !== videoInfo.videoPic)) {
                existingItem.videoPic = videoInfo.videoPic;
            }

            // 只有當播放新集數時才重置進度
            if (isNewEpisode) {
                existingItem.currentTime = 0;
                existingItem.duration = 0;
            }

            existingItem.lastWatched = Date.now();
            existingItem.timestamp = Date.now(); // 更新時間戳，讓它排在最前面

            // 將更新後的記錄移到開頭
            this.watchHistory.splice(existingIndex, 1);
            this.watchHistory.unshift(existingItem);

        } else {
            // 如果不存在，添加新記錄
            this.watchHistory.unshift({
                ...videoInfo,
                timestamp: Date.now()
            });
        }

        // 限制「未刪」最多 200 筆(跟 kazi 一致;墓碑另外保留,給同步用)
        const active = this.watchHistory.filter(i => !i.deletedAt).slice(0, 200);
        const tombs = this.watchHistory.filter(i => i.deletedAt);
        this.watchHistory = active.concat(tombs);

        this.saveWatchHistory();
    },

    // 軟刪一筆觀看歷史(標記 deletedAt,留著跟著同步,而非直接移除)
    removeHistory(videoId, siteUrl) {
        const item = this.watchHistory.find(i => i.videoId === videoId && i.siteUrl === siteUrl);
        if (item) {
            item.deletedAt = Date.now();
            // 刪除立即上傳,不等 2.5 秒 debounce,否則另一台馬上同步會抓到舊資料(刪了還在)
            this._historyDirty = true;
            this.flushWatchHistory();
        }
    },

    // 更新播放進度
    updateProgress(videoId, episodeUrl, siteUrl, currentTime, duration) {
        const historyItem = this.watchHistory.find(item =>
            item.videoId === videoId &&
            item.siteUrl === siteUrl
        );

        if (historyItem) {
            // 更新集數信息（如果不同）
            if (historyItem.episodeUrl !== episodeUrl) {
                historyItem.episodeName = ''; // 會在 addToHistory 中更新
                historyItem.episodeUrl = episodeUrl;
            }

            historyItem.currentTime = currentTime;
            historyItem.duration = duration;
            historyItem.lastWatched = Date.now();
            // 進度每幾秒更新一次:只標記 dirty、更新記憶體,不立即打伺服器。
            // 實際寫回交給「關閉播放器 / 每分鐘保險 / 關分頁」,避免播放中狂寫。
            this._historyDirty = true;

            // 觸發歷史記錄更新回調
            if (this.onHistoryUpdate) {
                this.onHistoryUpdate();
            }
        }
    },

    // 清除歷史紀錄:把目前所有「未刪」的標記成墓碑(這樣「清除全部」也會同步出去)
    clearHistory() {
        const now = Date.now();
        this.watchHistory.forEach(i => { if (!i.deletedAt) i.deletedAt = now; });
        // 清空立即上傳,理由同 removeHistory
        this._historyDirty = true;
        this.flushWatchHistory();
    },

    // 保存當前播放進度（用於播放器銷毀時）
    saveCurrentProgress() {
        if (this.artplayer && this.currentVideoInfo) {
            const currentTime = this.artplayer.currentTime;
            const duration = this.artplayer.duration;
            if (currentTime > 0 && duration > 0) {
                this.updateProgress(
                    this.currentVideoInfo.videoId,
                    this.currentVideoInfo.episodeUrl,
                    this.currentVideoInfo.siteUrl,
                    currentTime,
                    duration
                );
                // 關閉播放器時把最後進度立刻寫回(這是最重要的「續看點」時機)
                this.flushWatchHistory();
            }
        }
    },

    // 自動播放下一集
    autoPlayNext() {
        console.log('嘗試自動播放下一集...');

        // 獲取當前的播放列表
        let currentPlaylist = null;

        // 在多來源模式下
        if (this.multiSourceModalData && Object.keys(this.multiSourceModalData).length > 0) {
            console.log('處於多來源模式，使用 multiSourceModalData');
            // 使用當前來源的播放列表
            const sourceData = this.multiSourceModalData[this.currentSourceIndex];
            if (sourceData && sourceData.length > 0 && sourceData[0].episodes) {
                currentPlaylist = sourceData[0].episodes;
            }
        }
        // 在單一來源模式下
        else if (this.modalData && this.modalData.length > 0 && this.modalData[0].episodes) {
            console.log('處於單一來源模式，使用 modalData');
            currentPlaylist = this.modalData[0].episodes;
        }

        console.log('播放列表狀態:', {
            hasPlaylist: !!currentPlaylist,
            playlistLength: currentPlaylist?.length || 0,
            currentEpisodeUrl: this.currentVideoInfo?.episodeUrl
        });

        if (!currentPlaylist || currentPlaylist.length === 0) {
            console.log('無法自動播放: 找不到有效的播放列表');
            return false;
        }

        // 找到當前集數的索引
        const currentIndex = currentPlaylist.findIndex(episode =>
            episode.url === this.currentVideoInfo.episodeUrl
        );

        console.log('當前播放資訊:', {
            currentEpisodeUrl: this.currentVideoInfo.episodeUrl,
            currentIndex: currentIndex,
            totalEpisodes: currentPlaylist.length
        });

        // 如果找到當前集數且不是最後一集
        if (currentIndex !== -1 && currentIndex < currentPlaylist.length - 1) {
            // 獲取下一集資訊
            const nextEpisode = currentPlaylist[currentIndex + 1];
            console.log('找到下一集:', {
                nextEpisodeName: nextEpisode.name,
                nextEpisodeUrl: nextEpisode.url,
                currentVideoInfo: this.currentVideoInfo
            });

            // 保存當前影片資訊的完整副本
            const updatedVideoInfo = {
                ...this.currentVideoInfo,
                episodeName: nextEpisode.name,
                episodeUrl: nextEpisode.url
            };

            // 更新當前播放資訊
            this.currentVideoInfo = updatedVideoInfo;

            // 添加到歷史記錄
            this.addToHistory(this.currentVideoInfo);
            console.log('已更新播放資訊並添加到歷史記錄');

            return true;
        }

        console.log('無法自動播放: 當前是最後一集或找不到當前集數');
        return false;
    }
};
