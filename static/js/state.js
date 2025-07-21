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
    searchSiteIds: [],
    multiSourceVideos: [], // 多來源影片列表
    currentSourceIndex: 0, // 當前選擇的來源索引

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
    }
};
