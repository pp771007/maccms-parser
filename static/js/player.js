import state from './state.js';
import { $$ } from './utils.js';
import { showModal } from './modal.js';

export function playVideo(url, element, videoInfo = null, historyItem = null) {
    $$('.episode-item').forEach(el => el.classList.remove('playing'));
    if (element) element.classList.add('playing');

    if (state.artplayer) {
        state.artplayer.destroy();
    }

    // 顯示載入指示器
    const container = document.getElementById('artplayer-container');
    container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: white; font-size: 16px; position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 1000; background: rgba(0,0,0,0.8);">載入中...</div>';

    // 如果有影片資訊，記錄到歷史紀錄
    if (videoInfo) {
        state.currentVideoInfo = videoInfo;
        state.addToHistory(videoInfo);
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

    // 檢測螢幕尺寸，判斷是否為小螢幕設備
    const isSmallScreen = window.innerWidth < 768;

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
        // 手機端優化設定
        fullscreenWeb: !isSmallScreen, // 小螢幕設備不顯示網路全螢幕
        fullscreen: true,
        mini: true,
        autoplay: shouldAutoplay, // 根據是否有歷史進度決定是否自動播放
        setting: true,
        // 添加自定義控制按鈕
        controls: [
            {
                position: 'left',
                html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
                tooltip: '往前10秒',
                click: function () {
                    this.currentTime = Math.max(0, this.currentTime - 10);
                },
            },
            {
                position: 'left',
                html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h-2v12h2V6zm-3.5 6l-8.5 6V6l8.5 6z"/></svg>',
                tooltip: '往後10秒',
                click: function () {
                    this.currentTime = Math.min(this.duration, this.currentTime + 10);
                },
            },
        ],
        settings: [
            {
                html: '速度',
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
                html: '比例',
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
        screenshot: !isSmallScreen, // 小螢幕設備不顯示截圖功能
        airplay: true,
        theme: '#23ade5',
        plugins: [
            artplayerPluginChromecast({
                // sdk: '', // The URL of the Cast SDK
                // mimeType: '', // The MIME type of the media
            }),
        ],
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
        gesture: true, // 啟用手勢操作
        hotkey: true, // 啟用鍵盤控制
    });

    // 添加自定義鍵盤控制
    document.addEventListener('keydown', (event) => {
        // 只有在播放器存在且焦點不在輸入框時才處理鍵盤事件
        if (!state.artplayer || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
            return;
        }

        switch (event.code) {
            case 'ArrowLeft':
                event.preventDefault();
                state.artplayer.currentTime = Math.max(0, state.artplayer.currentTime - 10);
                break;
            case 'ArrowRight':
                event.preventDefault();
                state.artplayer.currentTime = Math.min(state.artplayer.duration, state.artplayer.currentTime + 10);
                break;
            case 'Space':
                event.preventDefault();
                state.artplayer.toggle();
                break;
            case 'ArrowUp':
                event.preventDefault();
                state.artplayer.volume = Math.min(1, state.artplayer.volume + 0.1);
                break;
            case 'ArrowDown':
                event.preventDefault();
                state.artplayer.volume = Math.max(0, state.artplayer.volume - 0.1);
                break;
        }
    });

    // 處理歷史進度恢復
    // 只有當歷史進度大於2秒時才進行恢復，避免小進度造成的問題
    if (historyItemToUse && historyItemToUse.currentTime && historyItemToUse.currentTime > 2) {
        let progressRestored = false; // 標記是否已恢復進度
        let restoreAttempts = 0; // 恢復嘗試次數
        const maxRestoreAttempts = 3; // 最大嘗試次數

        // 使用多個事件來確保進度恢復
        const restoreProgress = () => {
            // 如果已經恢復過進度或超過最大嘗試次數，則不再嘗試
            if (progressRestored || restoreAttempts >= maxRestoreAttempts) {
                return;
            }

            if (state.artplayer && state.artplayer.duration > 0) {
                const targetTime = Math.min(historyItemToUse.currentTime, state.artplayer.duration - 10);
                if (targetTime > 0) {
                    restoreAttempts++;

                    // 先暫停播放
                    state.artplayer.pause();
                    // 跳到正確秒數
                    state.artplayer.currentTime = targetTime;

                    // 延遲一下再開始播放，讓用戶看到跳轉效果
                    setTimeout(() => {
                        if (state.artplayer) {
                            state.artplayer.play();
                            // 標記進度已恢復
                            progressRestored = true;
                        }
                    }, 800);
                }
            }
        };

        // 在影片載入完成後恢復進度
        state.artplayer.on('loadedmetadata', () => {
            setTimeout(restoreProgress, 500);
        });

        // 在影片可以播放時再次嘗試恢復進度
        state.artplayer.on('canplay', () => {
            // 移除載入指示器
            const container = document.getElementById('artplayer-container');
            const loadingDiv = container.querySelector('div[style*="載入中"]');
            if (loadingDiv) {
                loadingDiv.remove();
            }

            // 如果還沒有恢復進度且歷史進度大於2秒，再次嘗試
            if (!progressRestored && historyItemToUse.currentTime > 2) {
                setTimeout(restoreProgress, 300);
            }
        });

        // 在影片開始播放時檢查進度
        state.artplayer.on('play', () => {
            // 如果播放開始但時間不對且歷史進度大於2秒，重新設置
            if (!progressRestored && state.artplayer.currentTime < 2 && historyItemToUse.currentTime > 2) {
                setTimeout(restoreProgress, 200);
            }
        });

        // 強制檢查 - 在播放器創建後的一段時間內多次檢查
        let checkCount = 0;
        const maxChecks = 5; // 減少檢查次數
        const checkInterval = setInterval(() => {
            checkCount++;
            if (state.artplayer && state.artplayer.duration > 0 &&
                !progressRestored && state.artplayer.currentTime < 2 &&
                historyItemToUse.currentTime > 2) {
                restoreProgress();
            }
            if (checkCount >= maxChecks || progressRestored ||
                (state.artplayer && state.artplayer.currentTime > 2)) {
                clearInterval(checkInterval);
            }
        }, 1000);
    } else {
        // 沒有歷史進度時，正常自動播放
        state.artplayer.on('canplay', () => {
            // 移除載入指示器
            const container = document.getElementById('artplayer-container');
            const loadingDiv = container.querySelector('div[style*="載入中"]');
            if (loadingDiv) {
                loadingDiv.remove();
            }

            // 自動開始播放
            if (state.artplayer && !state.artplayer.paused) {
                state.artplayer.play();
            }
        });
    }

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

    // 播放結束時記錄進度並清理計時器
    state.artplayer.on('ended', () => {
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

        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    });

    // 播放器銷毀時記錄進度並清理計時器
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

        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    });

    // 頁面卸載前保存進度
    window.addEventListener('beforeunload', () => {
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

    // 頁面隱藏時保存進度（切換標籤頁或最小化）
    document.addEventListener('visibilitychange', () => {
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
    });
}
