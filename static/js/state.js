export default {
    sites: [],
    currentSite: null,
    videos: [],
    categories: [],
    currentPage: 1,
    totalPages: 1,
    currentTypeId: null,
    currentKeyword: null,
    artplayer: null,
    modalData: null,
    searchSiteIds: [], // 多來源影片列表
    currentSourceIndex: 0, // 當前選擇的來源索引
    watchHistory: [], // 觀看歷史紀錄
    currentVideoInfo: null, // 當前播放的影片資訊
    currentVideo: null, // 當前選擇的影片資訊
    onHistoryUpdate: null, // 歷史記錄更新回調函數

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

    // 載入觀看歷史紀錄
    loadWatchHistory() {
        const saved = localStorage.getItem('watchHistory');
        if (saved) {
            try {
                this.watchHistory = JSON.parse(saved);
            } catch (e) {
                this.watchHistory = [];
            }
        } else {
            this.watchHistory = [];
        }
    },

    // 載入搜尋關鍵字歷史記錄
    loadSearchHistory() {
        const saved = localStorage.getItem('searchHistory');
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
        localStorage.setItem('searchHistory', JSON.stringify(this.searchHistory));
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

    // 儲存觀看歷史紀錄
    saveWatchHistory() {
        const dataToSave = JSON.stringify(this.watchHistory);
        localStorage.setItem('watchHistory', dataToSave);
    },

    // 添加觀看歷史紀錄
    addToHistory(videoInfo) {

        // 查找是否已存在同一部影片的記錄（使用 videoId + siteId）
        const existingIndex = this.watchHistory.findIndex(item =>
            item.videoId === videoInfo.videoId &&
            item.siteId === videoInfo.siteId
        );

        if (existingIndex !== -1) {
            // 如果存在，更新現有記錄
            const existingItem = this.watchHistory[existingIndex];
            const isNewEpisode = existingItem.episodeUrl !== videoInfo.episodeUrl;

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

        // 限制歷史紀錄數量（最多50條）
        if (this.watchHistory.length > 50) {
            this.watchHistory = this.watchHistory.slice(0, 50);
        }

        this.saveWatchHistory();
    },

    // 更新播放進度
    updateProgress(videoId, episodeUrl, siteId, currentTime, duration) {
        const historyItem = this.watchHistory.find(item =>
            item.videoId === videoId &&
            item.siteId === siteId
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
            this.saveWatchHistory();

            // 觸發歷史記錄更新回調
            if (this.onHistoryUpdate) {
                this.onHistoryUpdate();
            }
        }
    },

    // 清除歷史紀錄
    clearHistory() {
        this.watchHistory = [];
        this.saveWatchHistory();
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
                    this.currentVideoInfo.siteId,
                    currentTime,
                    duration
                );
            }
        }
    }
};
