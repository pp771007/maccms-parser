import state from './state.js';
import { $$ } from './utils.js';
import { showModal } from './modal.js';

export function playVideo(url, element, videoInfo = null) {
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
        fullscreenWeb: true,
        mini: true,
        autoplay: true,
        setting: true,
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
        screenshot: true,
        airplay: true,
        theme: '#23ade5',
        i18n: {
            'zh-tw': {
                Play: '播放',
                Pause: '暫停',
                Volume: '音量',
                Mute: '靜音',
                Unmute: '取消靜音',
                Setting: '設定',
                Settings: '設定',
                ShowSettingMenu: '顯示設定',
                ShowSetting: '顯示設定',
                WebFullScreen: '網頁全螢幕',
                ExitWebFullScreen: '退出網頁全螢幕',
                Fullscreen: '全螢幕',
                ExitFullscreen: '退出全螢幕',
                MiniPlayer: '迷你播放器',
                AirPlay: 'AirPlay 投放',
                Screenshot: '截圖',
                PIP: '子母畫面',
                PlayNext: '播放下一集',
                PlayPrev: '播放上一集',
                Next: '下一集',
                Previous: '上一集',
                Loop: '循環播放',
                Speed: '速度',
                AspectRatio: '比例',
                Default: '預設',
                Quality: '畫質',
                Download: '下載',
                LightOff: '關燈',
                LightOn: '開燈',
                Playlist: '播放列表',
                Subtitles: '字幕',
                NoSubtitles: '無字幕',
                Danmuku: '彈幕',
                NoDanmuku: '無彈幕',
                Send: '發送',
                Show: '顯示',
                Hide: '隱藏',
                Reset: '重設',
                Confirm: '確定',
                Cancel: '取消',
                Yes: '是',
                No: '否',
                Back: '返回',
                Forward: '前進',
                Open: '開啟',
                Close: '關閉',
                Loading: '載入中...',
                Error: '發生錯誤',
                // 你可以根據實際需求再補充更多
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

    // 檢查是否有歷史進度需要恢復
    const historyItem = state.watchHistory.find(item =>
        item.videoId === state.currentVideoInfo?.videoId &&
        item.episodeUrl === state.currentVideoInfo?.episodeUrl &&
        item.siteId === state.currentVideoInfo?.siteId
    );



    // 強制進度恢復檢查
    setTimeout(() => {
        if (historyItem && historyItem.currentTime && state.artplayer) {
            const currentTime = state.artplayer.currentTime;
            const targetTime = Math.min(historyItem.currentTime, state.artplayer.duration - 10);

            if (Math.abs(currentTime - targetTime) > 5) {
                state.artplayer.currentTime = targetTime;
            }
        }
    }, 3000); // 3秒後強制檢查

    // 更強制的進度恢復 - 在播放器完全載入後
    setTimeout(() => {
        if (historyItem && historyItem.currentTime && state.artplayer && state.artplayer.duration > 0) {
            const currentTime = state.artplayer.currentTime;
            const targetTime = Math.min(historyItem.currentTime, state.artplayer.duration - 10);

            // 如果當前時間接近0，強制跳轉
            if (currentTime < 5 && targetTime > 10) {
                state.artplayer.currentTime = targetTime;
            }
        }
    }, 5000); // 5秒後最終檢查

    // 影片載入完成後恢復進度
    state.artplayer.on('loadedmetadata', () => {
        if (historyItem && historyItem.currentTime && historyItem.duration) {
            // 確保影片已經載入完成
            setTimeout(() => {
                if (state.artplayer && state.artplayer.duration > 0) {
                    const targetTime = Math.min(historyItem.currentTime, state.artplayer.duration - 10);
                    if (targetTime > 0) {
                        state.artplayer.currentTime = targetTime;
                    }
                }
            }, 1000); // 延遲1秒確保影片完全載入
        }
    });

    // 影片可以播放時移除載入指示器
    state.artplayer.on('canplay', () => {
        // 移除載入指示器
        const container = document.getElementById('artplayer-container');
        const loadingDiv = container.querySelector('div[style*="載入中"]');
        if (loadingDiv) {
            loadingDiv.remove();
        }

        if (historyItem && historyItem.currentTime && !state.artplayer.paused) {
            // 如果影片正在播放但時間不對，重新設置
            const currentTime = state.artplayer.currentTime;
            const targetTime = Math.min(historyItem.currentTime, state.artplayer.duration - 10);

            if (Math.abs(currentTime - targetTime) > 5) { // 如果時間差異超過5秒
                state.artplayer.currentTime = targetTime;
            }
        }
    });

    // 處理載入錯誤
    state.artplayer.on('error', (error) => {
        console.error('播放器載入錯誤:', error);
        // 顯示錯誤信息
        const container = document.getElementById('artplayer-container');
        container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: white; font-size: 16px; text-align: center; padding: 20px;">載入失敗，請稍後重試<br><small>錯誤代碼: ' + (error?.code || 'unknown') + '</small></div>';
    });

    // 添加播放進度記錄事件
    let progressTimer = null;

    // 播放時開始記錄進度
    state.artplayer.on('play', () => {
        // 延遲檢查，確保影片已經開始播放
        setTimeout(() => {
            if (historyItem && historyItem.currentTime && state.artplayer) {
                const currentTime = state.artplayer.currentTime;
                const targetTime = Math.min(historyItem.currentTime, state.artplayer.duration - 10);

                // 如果當前時間與目標時間差異很大，重新設置
                if (Math.abs(currentTime - targetTime) > 10) {
                    state.artplayer.currentTime = targetTime;
                }
            }
        }, 2000); // 延遲2秒檢查

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
