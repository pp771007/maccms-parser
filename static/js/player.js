import state from './state.js';
import { $$ } from './utils.js';

export function playVideo(url, element) {
    $$('.episode-item').forEach(el => el.classList.remove('playing'));
    if (element) element.classList.add('playing');

    if (state.artplayer) {
        state.artplayer.destroy();
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
                    alert('您的瀏覽器不支持HLS播放。');
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
        hotkey: false, // 在行動裝置上建議關閉
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
    });
}
