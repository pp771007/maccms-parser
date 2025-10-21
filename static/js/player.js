import state from './state.js';
import { $$ } from './utils.js';
import { showModal } from './modal.js';

// 播放器配置常量
const PLAYER_CONFIG = {
    PROGRESS_SAVE_INTERVAL: 5000, // 進度保存間隔（毫秒）
    RESTORE_ATTEMPTS_MAX: 3, // 進度恢復最大嘗試次數
    RESTORE_CHECK_INTERVAL: 1000, // 進度恢復檢查間隔（毫秒）
    RESTORE_CHECK_MAX: 5, // 進度恢復檢查次數上限
    NEXT_EPISODE_DELAY: 1000, // 下一集切換延遲（毫秒）
    HISTORY_TIME_THRESHOLD: 2, // 歷史進度閾值（秒）
    JUMP_SECONDS: 10, // 鍵盤快進快退秒數
    VOLUME_STEP: 0.1, // 音量調整步長
    CLICK_THRESHOLD: 300, // 點擊事件閾值（毫秒）
    CONTINUOUS_CLICK_TIMEOUT: 500, // 連續點擊超時時間（毫秒）
    HINT_DISPLAY_TIME: 2000, // 提示顯示時間（毫秒）
};

// 播放器狀態管理類
class PlayerStateManager {
    constructor() {
        this.progressTimer = null;
        this.restoreTimer = null;
        this.isRestoring = false;
        this.restoreAttempts = 0;
    }

    startProgressTracking() {
        if (this.progressTimer) {
            clearInterval(this.progressTimer);
        }

        this.progressTimer = setInterval(() => {
            this.saveProgress();
        }, PLAYER_CONFIG.PROGRESS_SAVE_INTERVAL);
    }

    stopProgressTracking() {
        if (this.progressTimer) {
            clearInterval(this.progressTimer);
            this.progressTimer = null;
        }
        this.saveProgress(); // 停止時保存最終進度
    }

    saveProgress() {
        if (state.currentVideoInfo && state.artplayer) {
            const currentTime = state.artplayer.currentTime;
            const duration = state.artplayer.duration;
            if (currentTime > 0 && duration > 0) {
                state.updateProgress(
                    state.currentVideoInfo.videoId,
                    state.currentVideoInfo.episodeUrl,
                    state.currentVideoInfo.siteId,
                    currentTime,
                    duration
                );
            }
        }
    }

    startProgressRestore(historyItem) {
        if (!historyItem || !historyItem.currentTime || historyItem.currentTime <= PLAYER_CONFIG.HISTORY_TIME_THRESHOLD) {
            return;
        }

        this.isRestoring = false;
        this.restoreAttempts = 0;

        const restoreProgress = () => {
            if (this.isRestoring || this.restoreAttempts >= PLAYER_CONFIG.RESTORE_ATTEMPTS_MAX) {
                return;
            }

            if (state.artplayer && state.artplayer.duration > 0) {
                const targetTime = Math.min(historyItem.currentTime, state.artplayer.duration - 10);
                if (targetTime > 0) {
                    this.restoreAttempts++;
                    this.performRestore(targetTime);
                }
            }
        };

        // 多重事件監聽確保恢復成功
        state.artplayer.on('loadedmetadata', () => setTimeout(restoreProgress, 500));
        state.artplayer.on('canplay', () => {
            if (!this.isRestoring && historyItem.currentTime > PLAYER_CONFIG.HISTORY_TIME_THRESHOLD) {
                setTimeout(restoreProgress, 300);
            }
        });

        // 定時檢查機制
        let checkCount = 0;
        this.restoreTimer = setInterval(() => {
            checkCount++;
            if (state.artplayer && state.artplayer.duration > 0 &&
                !this.isRestoring && state.artplayer.currentTime < PLAYER_CONFIG.HISTORY_TIME_THRESHOLD &&
                historyItem.currentTime > PLAYER_CONFIG.HISTORY_TIME_THRESHOLD) {
                restoreProgress();
            }
            if (checkCount >= PLAYER_CONFIG.RESTORE_CHECK_MAX || this.isRestoring ||
                (state.artplayer && state.artplayer.currentTime > PLAYER_CONFIG.HISTORY_TIME_THRESHOLD)) {
                clearInterval(this.restoreTimer);
            }
        }, PLAYER_CONFIG.RESTORE_CHECK_INTERVAL);
    }

    performRestore(targetTime) {
        if (state.artplayer) {
            state.artplayer.pause();
            state.artplayer.currentTime = targetTime;

            setTimeout(() => {
                if (state.artplayer) {
                    state.artplayer.play();
                    this.isRestoring = true;
                }
            }, 800);
        }
    }

    cleanup() {
        this.stopProgressTracking();
        if (this.restoreTimer) {
            clearInterval(this.restoreTimer);
            this.restoreTimer = null;
        }
        this.isRestoring = false;
        this.restoreAttempts = 0;
    }
}

// 鍵盤控制管理類
class KeyboardController {
    constructor(artplayer) {
        this.artplayer = artplayer;
        this.handler = null;
        this.init();
    }

    init() {
        this.handler = (event) => {
            if (!state.artplayer || this.isInputFocused()) {
                return;
            }

            switch (event.code) {
                case 'ArrowLeft':
                    event.preventDefault();
                    this.seekRelative(-PLAYER_CONFIG.JUMP_SECONDS);
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    this.seekRelative(PLAYER_CONFIG.JUMP_SECONDS);
                    break;
                case 'Space':
                    event.preventDefault();
                    this.artplayer.toggle();
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    this.adjustVolume(PLAYER_CONFIG.VOLUME_STEP);
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    this.adjustVolume(-PLAYER_CONFIG.VOLUME_STEP);
                    break;
            }
        };

        document.keyboardHandler = this.handler;
        document.addEventListener('keydown', this.handler);
    }

    isInputFocused() {
        return document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';
    }

    seekRelative(seconds) {
        if (this.artplayer) {
            const newTime = Math.max(0, Math.min(this.artplayer.duration, this.artplayer.currentTime + seconds));
            this.artplayer.currentTime = newTime;
        }
    }

    adjustVolume(delta) {
        if (this.artplayer) {
            this.artplayer.volume = Math.max(0, Math.min(1, this.artplayer.volume + delta));
        }
    }

    destroy() {
        if (this.handler && document.keyboardHandler === this.handler) {
            document.removeEventListener('keydown', this.handler);
            document.keyboardHandler = null;
        }
    }
}

// 點擊控制器管理類（優化版）
class ClickController {
    constructor(playerContainer, artplayer) {
        this.playerContainer = playerContainer;
        this.artplayer = artplayer;
        this.handlers = {};
        this.timers = {};
        this.state = {
            clickCount: 0,
            lastClickTime: 0,
            isContinuousMode: false,
            continuousDirection: null,
            continuousCount: 0,
            startTime: 0
        };
        this.init();
    }

    init() {
        // 綁定處理器方法
        this.handlers.click = this.handleClick.bind(this);
        this.handlers.doubleClick = this.handleDoubleClick.bind(this);
        this.handlers.continuousClick = this.handleContinuousClick.bind(this);

        // 添加事件監聽器
        this.playerContainer.addEventListener('click', this.handlers.click, true);
        this.playerContainer.addEventListener('dblclick', this.handlers.doubleClick, true);
    }

    handleClick(event) {
        if (this.isControlElement(event.target)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const now = Date.now();
        const timeDiff = now - this.state.lastClickTime;

        if (this.timers.click) {
            clearTimeout(this.timers.click);
        }

        if (timeDiff > PLAYER_CONFIG.CLICK_THRESHOLD) {
            this.state.clickCount = 1;
        } else {
            this.state.clickCount++;
        }

        this.state.lastClickTime = now;

        this.timers.click = setTimeout(() => {
            if (this.state.clickCount === 1) {
                this.togglePlayPause();
            } else if (this.state.clickCount >= 2) {
                this.startContinuousMode(event, this.state.clickCount);
            }
            this.state.clickCount = 0;
        }, PLAYER_CONFIG.CLICK_THRESHOLD);
    }

    handleDoubleClick(event) {
        if (this.isControlElement(event.target)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }

    handleContinuousClick(event) {
        if (this.isControlElement(event.target)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.state.continuousCount++;
        this.executeTimeJump();

        if (this.timers.continuous) {
            clearTimeout(this.timers.continuous);
        }

        this.timers.continuous = setTimeout(() => {
            this.stopContinuousMode();
        }, PLAYER_CONFIG.CONTINUOUS_CLICK_TIMEOUT);
    }

    isControlElement(target) {
        return target.closest('.art-controls') || target.closest('.art-control') || target.closest('.art-settings');
    }

    togglePlayPause() {
        if (this.artplayer) {
            this.artplayer.toggle();
        }
    }

    startContinuousMode(event, initialCount = 1) {
        if (this.state.isContinuousMode) return;

        const rect = this.playerContainer.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const direction = clickX < rect.width / 2 ? 'left' : 'right';

        this.state.isContinuousMode = true;
        this.state.continuousDirection = direction;
        this.state.continuousCount = initialCount;
        this.state.startTime = this.artplayer.currentTime;

        this.executeTimeJump();

        this.timers.continuous = setTimeout(() => {
            this.stopContinuousMode();
        }, PLAYER_CONFIG.CONTINUOUS_CLICK_TIMEOUT);

        this.playerContainer.addEventListener('click', this.handlers.continuousClick, true);
    }

    stopContinuousMode() {
        if (!this.state.isContinuousMode) return;

        this.state.isContinuousMode = false;
        this.state.continuousDirection = null;
        this.state.continuousCount = 0;
        this.state.startTime = 0;

        if (this.timers.continuous) {
            clearTimeout(this.timers.continuous);
            this.timers.continuous = null;
        }

        this.playerContainer.removeEventListener('click', this.handlers.continuousClick, true);
    }

    executeTimeJump() {
        if (!this.artplayer || !this.state.isContinuousMode) return;

        const totalJumpSeconds = (this.state.continuousCount - 1) * PLAYER_CONFIG.JUMP_SECONDS;
        let newTime;

        if (this.state.continuousDirection === 'left') {
            newTime = Math.max(0, this.state.startTime - totalJumpSeconds);
            this.showHint(`後退 ${totalJumpSeconds} 秒`, 'left');
        } else {
            newTime = Math.min(this.artplayer.duration, this.state.startTime + totalJumpSeconds);
            this.showHint(`前進 ${totalJumpSeconds} 秒`, 'right');
        }

        if (newTime !== this.artplayer.currentTime) {
            this.artplayer.currentTime = newTime;
        }
    }

    showHint(text, position) {
        this.removeExistingHints();

        const hint = document.createElement('div');
        hint.className = 'time-change-hint';
        hint.textContent = text;
        hint.style.cssText = `
            position: absolute;
            top: 50%;
            ${position === 'left' ? 'left: 20px;' : 'right: 20px;'}
            transform: translateY(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 14px;
            z-index: 10000;
            pointer-events: none;
            transition: opacity 0.3s ease;
        `;

        this.playerContainer.appendChild(hint);

        setTimeout(() => {
            hint.style.opacity = '0';
            setTimeout(() => {
                if (hint.parentNode) {
                    hint.parentNode.removeChild(hint);
                }
            }, 300);
        }, PLAYER_CONFIG.HINT_DISPLAY_TIME);
    }

    removeExistingHints() {
        const existingHints = this.playerContainer.querySelectorAll('.time-change-hint');
        existingHints.forEach(hint => hint.remove());
    }

    destroy() {
        // 清理所有計時器
        Object.values(this.timers).forEach(timer => {
            if (timer) clearTimeout(timer);
        });

        // 移除所有事件監聽器
        Object.values(this.handlers).forEach(handler => {
            this.playerContainer.removeEventListener('click', handler, true);
            this.playerContainer.removeEventListener('dblclick', handler, true);
        });

        this.removeExistingHints();
        this.timers = {};
        this.handlers = {};
    }
}

export function playVideo(url, element, videoInfo = null, historyItem = null) {
    $$('.episode-item').forEach(el => el.classList.remove('playing'));
    if (element) element.classList.add('playing');

    // 清理舊的播放器實例和相關資源
    if (state.artplayer) {
        // 清理舊的點擊控制器
        if (state.artplayer.clickController) {
            state.artplayer.clickController.destroy();
        }

        // 清理舊的事件監聽器和計時器
        cleanupPlayerResources();

        // 銷毀舊的播放器實例
        state.artplayer.destroy();
        state.artplayer = null;
    }

    // 顯示載入指示器
    const container = document.getElementById('artplayer-container');
    container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: white; font-size: 16px; position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 1000; background: rgba(0,0,0,0.8);">載入中...</div>';

    // 如果有影片資訊，記錄到歷史紀錄
    if (videoInfo) {
        state.currentVideoInfo = videoInfo;
        state.addToHistory(videoInfo);

        // 檢查 currentVideo 是否需要從 multiSourceVideos 中更新
        if (state.multiSourceVideos && state.multiSourceVideos.length > 0) {
            const videoFromSource = state.multiSourceVideos[state.currentSourceIndex];
            if (videoFromSource && videoFromSource.vod_id === videoInfo.videoId) {
                state.currentVideo = videoFromSource;
            }
        }

        console.log('播放影片資訊:', {
            videoInfo,
            currentVideo: state.currentVideo,
            modalData: state.modalData,
            multiSourceData: state.multiSourceModalData,
            currentSourceIndex: state.currentSourceIndex
        });

        // 確保 currentVideo 中包含完整的影片資訊，包括劇集列表
        if (!state.currentVideo || state.currentVideo.vod_id !== videoInfo.videoId) {
            // 從 modalData 中找到當前播放的影片資訊
            let episodes = [];
            if (state.modalData && state.modalData.length > 0) {
                // 檢查 modalData 的結構
                if (Array.isArray(state.modalData[0].episodes)) {
                    episodes = state.modalData[0].episodes;
                } else if (Array.isArray(state.modalData[0]?.episodes)) {
                    episodes = state.modalData[0].episodes;
                }
                console.log('找到劇集列表:', {
                    hasModalData: !!state.modalData,
                    modalDataLength: state.modalData.length,
                    firstItem: state.modalData[0],
                    episodesFound: episodes.length
                });
            }

            // 更新 currentVideo，保持現有屬性
            state.currentVideo = {
                ...(state.currentVideo || {}),  // 保留現有屬性
                vod_id: videoInfo.videoId,
                vod_name: videoInfo.videoName,
                episodes: episodes
            };
            console.log('更新後的 currentVideo:', state.currentVideo);
        }
    }

    // 檢查是否有歷史進度需要恢復
    const historyItemToUse = historyItem || state.watchHistory.find(item =>
        item.videoId === state.currentVideoInfo?.videoId &&
        item.episodeUrl === state.currentVideoInfo?.episodeUrl &&
        item.siteId === state.currentVideoInfo?.siteId
    );

    // 決定是否自動播放
    // 只有當歷史進度大於2秒時才不自動播放，避免小進度造成的問題
    const shouldAutoplay = !(historyItemToUse && historyItemToUse.currentTime && historyItemToUse.currentTime > 2);

    state.artplayer = new Artplayer({
        container: '#artplayer-container',
        url: url,
        type: url.includes('.m3u8') ? 'customHls' : 'auto',
        customType: {
            customHls: function (video, url) {
                if (Hls.isSupported()) {
                    const hls = new Hls();
                    hls.loadSource(url);
                    hls.attachMedia(video);
                } else {
                    showModal('您的瀏覽器不支持HLS播放。', 'error');
                }
            },
        },
        fullscreenWeb: window.innerWidth >= 500,
        fullscreen: true,
        mini: true,
        autoplay: shouldAutoplay, // 根據是否有歷史進度決定是否自動播放
        setting: true,
        // 移除自定義控制按鈕，因為現在有雙擊左右側功能
        controls: [],
        settings: [
            {
                width: 150,
                html: '網頁全螢幕',
                tooltip: '網頁全螢幕',
                switch: true,
                onSwitch: function (item) {
                    const player = state.artplayer;
                    player.fullscreenWeb = !player.fullscreenWeb;
                    return player.fullscreenWeb ? '網頁全螢幕開啟' : '網頁全螢幕關閉';
                },
            },
            {
                width: 150,
                html: '全螢幕',
                tooltip: '全螢幕',
                switch: true,
                onSwitch: function (item) {
                    const player = state.artplayer;
                    player.fullscreen = !player.fullscreen;
                    return player.fullscreen ? '全螢幕開啟' : '全螢幕關閉';
                },
            },
            {
                width: 150,
                html: '截圖',
                tooltip: '截圖',
                switch: true,
                onSwitch: function (item) {
                    const player = state.artplayer;
                    player.screenshot();
                    return '截圖完成';
                },
            },
            {
                width: 150,
                html: '投影投放',
                tooltip: '投影投放',
                switch: true,
                onSwitch: function (item) {
                    const player = state.artplayer;
                    player.airplay();
                    return '開啟投影投放';
                },
            },
            {
                width: 150,
                html: 'Chromecast',
                tooltip: 'Chromecast 投放',
                switch: true,
                onSwitch: function (item) {
                    const player = state.artplayer;

                    // 載入 Chromecast SDK（如果還沒載入）
                    if (!window.chrome || !window.chrome.cast) {
                        // 動態載入 Chromecast SDK
                        return new Promise((resolve, reject) => {
                            const script = document.createElement('script');
                            script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
                            script.onload = () => {
                                window.__onGCastApiAvailable = function (isAvailable) {
                                    if (isAvailable) {
                                        window.cast.framework.CastContext.getInstance().setOptions({
                                            receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                                            autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
                                        });

                                        // 嘗試連接到 Chromecast
                                        connectToChromecast(player);
                                        resolve('SDK 已載入，連線中...');
                                    } else {
                                        player.notice.show = 'Chromecast 無法使用';
                                        resolve('Chromecast 無法使用');
                                    }
                                };
                            };
                            script.onerror = () => {
                                player.notice.show = '載入 Chromecast SDK 失敗';
                                resolve('載入失敗');
                            };
                            document.body.appendChild(script);
                        });
                    } else {
                        // SDK 已經載入，直接連接到 Chromecast
                        connectToChromecast(player);
                        return '連接到 Chromecast';
                    }

                    function connectToChromecast(player) {
                        const castContext = window.cast.framework.CastContext.getInstance();

                        // 檢查是否有現有的投放會話
                        const currentSession = castContext.getCurrentSession();

                        if (currentSession) {
                            // 如果有現有的會話，直接載入媒體
                            loadMediaToChromecast(currentSession, player.url);
                            player.notice.show = '媒體已載入到 Chromecast';
                        } else {
                            // 請求新的投放會話
                            castContext.requestSession()
                                .then(function (session) {
                                    loadMediaToChromecast(session, player.url);
                                    player.notice.show = '已連接到 Chromecast';
                                })
                                .catch(function (error) {
                                    player.notice.show = '連接到 Chromecast 失敗';
                                    console.error('Chromecast 連線失敗:', error);
                                });
                        }
                    }

                    function loadMediaToChromecast(session, url) {
                        try {
                            // 判斷媒體類型
                            const mimeType = getMimeType(url);
                            const mediaInfo = new window.chrome.cast.media.MediaInfo(url, mimeType);
                            const request = new window.chrome.cast.media.LoadRequest(mediaInfo);

                            session.loadMedia(request)
                                .then(function () {
                                    console.log('媒體已成功載入到 Chromecast');
                                })
                                .catch(function (error) {
                                    console.error('載入媒體到 Chromecast 失敗:', error);
                                    player.notice.show = '載入媒體失敗';
                                });
                        } catch (error) {
                            console.error('準備 Chromecast 媒體時發生錯誤:', error);
                            player.notice.show = '準備媒體時發生錯誤';
                        }
                    }

                    function getMimeType(url) {
                        const extension = url.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
                        const mimeTypes = {
                            'mp4': 'video/mp4',
                            'webm': 'video/webm',
                            'ogg': 'video/ogg',
                            'ogv': 'video/ogg',
                            'mp3': 'audio/mp3',
                            'wav': 'audio/wav',
                            'flv': 'video/x-flv',
                            'mov': 'video/quicktime',
                            'avi': 'video/x-msvideo',
                            'wmv': 'video/x-ms-wmv',
                            'mpd': 'application/dash+xml',
                            'm3u8': 'application/x-mpegURL'
                        };
                        return mimeTypes[extension] || 'application/octet-stream';
                    }

                    return '處理中...';
                },
            },
            {
                html: '播放速度',
                width: 150,
                tooltip: '正常',
                selector: [
                    { html: '0.5倍', url: '0.5' },
                    { html: '0.75倍', url: '0.75' },
                    { default: true, html: '正常', url: '1.0' },
                    { html: '1.25倍', url: '1.25' },
                    { html: '1.5倍', url: '1.5' },
                    { html: '2倍', url: '2.0' },
                ],
                onSelect: function (item) {
                    this.playbackRate = parseFloat(item.url);
                    return item.html;
                },
            },
            {
                html: '畫面比例',
                selector: [
                    { html: '原始比例', url: 'default' },
                    { html: '16:9', url: '16:9' },
                    { html: '4:3', url: '4:3' },
                    { html: '填滿', url: 'fill' },
                ],
                onSelect: function (item) {
                    this.aspectRatio = item.url;
                    return item.html;
                },
            },
        ],
        airplay: true,
        theme: '#23ade5',
        plugins: [],
        i18n: {
            'zh-tw': {
                "Video Info": "統計資訊",
                Close: "關閉",
                "Video Load Failed": "載入失敗",
                Volume: "音量",
                Play: "播放",
                Pause: "暫停",
                Rate: "速度",
                Mute: "靜音",
                "Video Flip": "畫面翻轉",
                Horizontal: "水平",
                Vertical: "垂直",
                Reconnect: "重新連接",
                "Show Setting": "顯示設定",
                "Hide Setting": "隱藏設定",
                Screenshot: "截圖",
                "Play Speed": "播放速度",
                "Aspect Ratio": "畫面比例",
                Default: "預設",
                Normal: "正常",
                Open: "開啟",
                "Switch Video": "切換",
                "Switch Subtitle": "切換字幕",
                Fullscreen: "全螢幕",
                "Exit Fullscreen": "退出全螢幕",
                "Web Fullscreen": "網頁全螢幕",
                "Exit Web Fullscreen": "退出網頁全螢幕",
                "Mini Player": "迷你播放器",
                "PIP Mode": "開啟畫中畫",
                "Exit PIP Mode": "退出畫中畫",
                "PIP Not Supported": "不支援畫中畫",
                "Fullscreen Not Supported": "不支援全螢幕",
                "Subtitle Offset": "字幕偏移",
                "Last Seen": "上次看到",
                "Jump Play": "跳轉播放",
                AirPlay: "隔空播放",
                "AirPlay Not Available": "隔空播放不可用"
            },
        },
        lang: 'zh-tw',
        moreVideoAttr: {
            'playsinline': true,
            'webkit-playsinline': true,
        },
        gesture: false, // 停用內建手勢操作，避免與自定義雙擊功能衝突
        hotkey: true, // 啟用鍵盤控制
        autoOrientation: true, //啟用自動轉向
    });

    // 初始化鍵盤控制器
    const keyboardController = new KeyboardController(state.artplayer);

    // 初始化優化的點擊控制器
    const playerContainer = document.getElementById('artplayer-container');
    const clickController = new ClickController(playerContainer, state.artplayer);

    // 將點擊控制器保存到播放器實例中，以便後續清理
    state.artplayer.clickController = clickController;

    // 添加播放器事件監聽器用於除錯
    state.artplayer.on('ready', () => {
        console.log('播放器初始化完成');
    });

    state.artplayer.on('play', () => {
        console.log('開始播放');
    });

    state.artplayer.on('pause', () => {
        console.log('暫停播放');
    });

    state.artplayer.on('ended', () => {
        console.log('播放結束(ended事件)');
    });

    state.artplayer.on('video:ended', () => {
        console.log('影片播放結束(video:ended事件)');
    });

    state.artplayer.on('complete', () => {
        console.log('播放完成(complete事件)');
    });

    // 監聽時間更新
    state.artplayer.on('timeupdate', () => {
        const currentTime = state.artplayer.currentTime;
        const duration = state.artplayer.duration;
        // 當播放進度接近結尾時（最後3秒）
        if (duration - currentTime <= 3) {
            console.log('接近影片結尾:', {
                currentTime,
                duration,
                remaining: duration - currentTime
            });
        }
    });

    // 初始化狀態管理器並處理歷史進度恢復
    const stateManager = new PlayerStateManager();
    stateManager.startProgressRestore(historyItemToUse);

    // 當影片可以播放時移除載入指示器並開始播放
    state.artplayer.on('canplay', () => {
        // 移除載入指示器
        const container = document.getElementById('artplayer-container');
        const loadingDiv = container.querySelector('div[style*="載入中"]');
        if (loadingDiv) {
            loadingDiv.remove();
        }

        // 如果沒有歷史進度且應該自動播放，則開始播放
        if (!historyItemToUse || !historyItemToUse.currentTime || historyItemToUse.currentTime <= PLAYER_CONFIG.HISTORY_TIME_THRESHOLD) {
            if (state.artplayer && !state.artplayer.paused) {
                state.artplayer.play();
            }
        }
    });

    // 處理載入錯誤
    state.artplayer.on('error', (error) => {
        // 顯示錯誤信息
        const container = document.getElementById('artplayer-container');
        container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: white; font-size: 16px; text-align: center; padding: 20px;">載入失敗，請稍後重試<br><small>錯誤代碼: ' + (error?.code || 'unknown') + '</small></div>';
    });

    // 添加播放進度記錄事件
    let progressTimer = null;

    // 播放時開始記錄進度
    state.artplayer.on('play', () => {
        // 開始記錄進度
        if (progressTimer) clearInterval(progressTimer);
        progressTimer = setInterval(() => {
            if (state.currentVideoInfo && state.artplayer) {
                const currentTime = state.artplayer.currentTime;
                const duration = state.artplayer.duration;
                if (currentTime > 0 && duration > 0) {
                    state.updateProgress(
                        state.currentVideoInfo.videoId,
                        state.currentVideoInfo.episodeUrl,
                        state.currentVideoInfo.siteId,
                        currentTime,
                        duration
                    );
                }
            }
        }, 5000); // 每5秒記錄一次進度
    });

    // 暫停時記錄進度
    state.artplayer.on('pause', () => {
        if (state.currentVideoInfo && state.artplayer) {
            const currentTime = state.artplayer.currentTime;
            const duration = state.artplayer.duration;
            if (currentTime > 0 && duration > 0) {
                state.updateProgress(
                    state.currentVideoInfo.videoId,
                    state.currentVideoInfo.episodeUrl,
                    state.currentVideoInfo.siteId,
                    currentTime,
                    duration
                );
            }
        }
    });

    // 播放結束時記錄進度、清理計時器並自動播放下一集
    state.artplayer.on('video:ended', () => {
        console.log('影片播放結束事件觸發');

        // 記錄最終進度
        if (state.currentVideoInfo && state.artplayer) {
            const currentTime = state.artplayer.duration; // 使用影片總長度作為最終時間
            const duration = state.artplayer.duration;
            if (duration > 0) {
                console.log('記錄最終播放進度:', {
                    currentTime,
                    duration
                });
                state.updateProgress(
                    state.currentVideoInfo.videoId,
                    state.currentVideoInfo.episodeUrl,
                    state.currentVideoInfo.siteId,
                    currentTime,
                    duration
                );
            }
        }

        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
            console.log('清理進度記錄計時器');
        }

        // 自動播放下一集
        console.log('準備切換到下一集...');
        if (state.autoPlayNext()) {
            console.log('autoPlayNext 返回 true，準備播放下一集');

            // 延遲一下再載入新集數，讓用戶有時間看到播放結束
            setTimeout(async () => {
                // 取得下一集的 URL
                const nextEpisodeUrl = state.currentVideoInfo.episodeUrl;
                console.log('下一集 URL:', nextEpisodeUrl);

                if (nextEpisodeUrl) {
                    // 找到對應的元素（如果有的話）
                    const episodeElements = document.querySelectorAll('.episode-item');
                    let nextEpisodeElement = null;

                    // 尋找下一集的元素
                    const currentSource = state.modalData[0];
                    if (currentSource && currentSource.episodes) {
                        const currentIndex = currentSource.episodes.findIndex(episode => episode.url === nextEpisodeUrl);

                        if (currentIndex !== -1) {
                            // 找到對應的元素
                            nextEpisodeElement = episodeElements[currentIndex];
                        }
                    }

                    // 移除所有 playing 類別並設置新的 playing 元素
                    episodeElements.forEach(item => {
                        item.classList.remove('playing');
                    });

                    if (nextEpisodeElement) {
                        nextEpisodeElement.classList.add('playing');
                        // 確保下一集按鈕在視圖中
                        nextEpisodeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }

                    console.log('找到下一集元素:', {
                        hasElement: !!nextEpisodeElement,
                        url: nextEpisodeUrl,
                        elementText: nextEpisodeElement?.textContent
                    });

                    // 保留全螢幕狀態，直接切換影片來源
                    console.log('開始播放下一集（保留全螢幕狀態）');

                    try {
                        // 保存當前的播放器狀態
                        const currentFullscreen = state.artplayer.fullscreen;
                        const currentFullscreenWeb = state.artplayer.fullscreenWeb;
                        const currentVolume = state.artplayer.volume;
                        const currentMuted = state.artplayer.muted;

                        // 設置標誌，表示我們正在進行自動切換
                        state.artplayer.isAutoSwitching = true;

                        // 監聽載入完成事件
                        const onVideoLoad = async () => {
                            console.log('下一集載入完成，恢復播放狀態');

                            // 恢復播放器狀態
                            if (currentMuted) {
                                state.artplayer.muted = true;
                            } else {
                                state.artplayer.volume = currentVolume;
                            }

                            // 清除標誌
                            state.artplayer.isAutoSwitching = false;

                            // 開始播放下一集
                            await state.artplayer.play();

                            console.log('成功切換到下一集並保留全螢幕狀態');
                        };

                        // 監聽錯誤事件
                        const onVideoError = (error) => {
                            console.error('切換下一集時發生錯誤:', error);
                            state.artplayer.isAutoSwitching = false;
                            // 如果直接切換失敗，回退到傳統方法
                            playVideo(nextEpisodeUrl, nextEpisodeElement, state.currentVideoInfo);
                        };

                        // 添加一次性事件監聽器
                        state.artplayer.once('video:canplay', onVideoLoad);
                        state.artplayer.once('video:error', onVideoError);

                        // 切換到下一集的 URL（這會觸發載入）
                        state.artplayer.url = nextEpisodeUrl;

                    } catch (error) {
                        console.error('設置下一集URL時發生錯誤，嘗試使用傳統方法:', error);
                        state.artplayer.isAutoSwitching = false;
                        // 如果直接切換失敗，回退到傳統方法
                        console.log('回退到傳統方法播放下一集');
                        playVideo(nextEpisodeUrl, nextEpisodeElement, state.currentVideoInfo);
                    }
                } else {
                    console.error('無法獲取下一集 URL');
                }
            }, 1000);
        } else {
            console.log('autoPlayNext 返回 false，不執行自動播放');
        }
    });

    // 播放器銷毀時記錄進度並清理所有資源
    state.artplayer.on('destroy', () => {
        // 記錄最終進度
        if (state.currentVideoInfo && state.artplayer) {
            const currentTime = state.artplayer.currentTime;
            const duration = state.artplayer.duration;
            if (currentTime > 0 && duration > 0) {
                state.updateProgress(
                    state.currentVideoInfo.videoId,
                    state.currentVideoInfo.episodeUrl,
                    state.currentVideoInfo.siteId,
                    currentTime,
                    duration
                );
            }
        }

        // 清理狀態管理器
        if (stateManager) {
            stateManager.cleanup();
        }

        // 清理鍵盤控制器
        if (keyboardController) {
            keyboardController.destroy();
        }

        // 清理點擊控制器
        if (clickController) {
            clickController.destroy();
        }

        // 清理進度記錄計時器
        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }

        // 清理全域資源
        cleanupPlayerResources();

        console.log('播放器資源清理完成');
    });

    // 頁面卸載前保存進度
    const beforeUnloadHandler = () => {
        if (state.currentVideoInfo && state.artplayer) {
            const currentTime = state.artplayer.currentTime;
            const duration = state.artplayer.duration;
            if (currentTime > 0 && duration > 0) {
                state.updateProgress(
                    state.currentVideoInfo.videoId,
                    state.currentVideoInfo.episodeUrl,
                    state.currentVideoInfo.siteId,
                    currentTime,
                    duration
                );
            }
        }
    };

    // 頁面隱藏時保存進度（切換標籤頁或最小化）
    const visibilityChangeHandler = () => {
        if (document.hidden && state.currentVideoInfo && state.artplayer) {
            const currentTime = state.artplayer.currentTime;
            const duration = state.artplayer.duration;
            if (currentTime > 0 && duration > 0) {
                state.updateProgress(
                    state.currentVideoInfo.videoId,
                    state.currentVideoInfo.episodeUrl,
                    state.currentVideoInfo.siteId,
                    currentTime,
                    duration
                );
            }
        }
    };

    // 儲存事件處理器引用以便後續清理
    window.beforeUnloadHandler = beforeUnloadHandler;
    document.visibilityChangeHandler = visibilityChangeHandler;

    window.addEventListener('beforeunload', beforeUnloadHandler);
    document.addEventListener('visibilitychange', visibilityChangeHandler);
}

// 資源清理函數，用於清理播放器相關的資源和事件監聽器
function cleanupPlayerResources() {
    // 清理鍵盤事件監聽器
    const keyboardHandler = document.keyboardHandler;
    if (keyboardHandler) {
        document.removeEventListener('keydown', keyboardHandler);
        document.keyboardHandler = null;
    }

    // 清理頁面事件監聽器
    const beforeUnloadHandler = window.beforeUnloadHandler;
    if (beforeUnloadHandler) {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
        window.beforeUnloadHandler = null;
    }

    const visibilityChangeHandler = document.visibilityChangeHandler;
    if (visibilityChangeHandler) {
        document.removeEventListener('visibilitychange', visibilityChangeHandler);
        document.visibilityChangeHandler = null;
    }

    // 清理全域計時器（如果有的話）
    if (window.playerTimers) {
        window.playerTimers.forEach(timer => {
            if (timer) {
                clearInterval(timer);
                clearTimeout(timer);
            }
        });
        window.playerTimers = [];
    }

    // 清理可能的記憶體洩漏元素
    const timeChangeHints = document.querySelectorAll('.time-change-hint');
    timeChangeHints.forEach(hint => {
        if (hint && hint.parentNode) {
            hint.parentNode.removeChild(hint);
        }
    });

    console.log('播放器資源清理完成');
}
