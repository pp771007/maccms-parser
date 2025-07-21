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
        flip: true,
        playbackRate: true,
        aspectRatio: true,
        screenshot: true,
        hotkey: false, // 在行動裝置上建議關閉
        airplay: true,
        theme: '#23ade5',
        i18n: {
            'zh-tw': window.zhTw,
        },
        lang: 'zh-tw',
        moreVideoAttr: {
            'playsinline': true,
            'webkit-playsinline': true,
        },
        settings: [
            {
                html: '速度',
                width: 150,
                tooltip: '0.75x',
                selector: [
                    { html: '0.5x', url: '0.5' },
                    { html: '0.75x', url: '0.75' },
                    { default: true, html: '正常', url: '1.0' },
                    { html: '1.25x', url: '1.25' },
                    { html: '1.5x', url: '1.5' },
                    { html: '2.0x', url: '2.0' },
                ],
                onSelect: function (item) {
                    state.artplayer.playbackRate = parseFloat(item.url);
                    return item.html;
                },
            },
        ],
    });
}
