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
                console.error('載入觀看歷史紀錄失敗:', e);
                this.watchHistory = [];
            }
        }
    },

    // 儲存觀看歷史紀錄
    saveWatchHistory() {
        localStorage.setItem('watchHistory', JSON.stringify(this.watchHistory));
    },

    // 添加觀看歷史紀錄
    addToHistory(videoInfo) {
        // 只用 videoId + siteId 當唯一鍵
        this.watchHistory = this.watchHistory.filter(item =>
            !(item.videoId === videoInfo.videoId && item.siteId === videoInfo.siteId)
        );
        // 添加新的紀錄到開頭
        this.watchHistory.unshift({
            ...videoInfo,
            timestamp: Date.now()
        });
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
            item.episodeUrl === episodeUrl &&
            item.siteId === siteId
        );

        if (historyItem) {
            historyItem.currentTime = currentTime;
            historyItem.duration = duration;
            historyItem.lastWatched = Date.now();
            this.saveWatchHistory();
        }
    },

    // 清除歷史紀錄
    clearHistory() {
        this.watchHistory = [];
        this.saveWatchHistory();
    }
};
