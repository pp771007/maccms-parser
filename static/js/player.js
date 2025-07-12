import state from './state.js';
import { $$ } from './utils.js';

export function playVideo(url, element) {
    $$('.episode-item').forEach(el => el.classList.remove('playing'));
    if (element) element.classList.add('playing');

    if (state.dplayer) {
        state.dplayer.destroy();
    }
    state.dplayer = new DPlayer({
        container: document.getElementById('dplayer'),
        video: {
            url: url,
            type: url.includes('.m3u8') ? 'customHls' : 'auto',
            customType: {
                customHls: (video, player) => {
                    if (Hls.isSupported()) {
                        const hls = new Hls();
                        hls.loadSource(video.src);
                        hls.attachMedia(video);
                    } else {
                        alert('您的瀏覽器不支持HLS播放。');
                    }
                }
            }
        },
        autoplay: true,
        screenshot: true,
    });
}
