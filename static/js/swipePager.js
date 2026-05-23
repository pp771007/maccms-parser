"use strict";

// 手機左右滑換頁(借用 kazi 的經驗,少走彎路):
// - 在 touchSlop 內先判斷主軸:水平占多數才攔(垂直就放手讓頁面正常上下捲)。
// - 換頁方向看「累積位移落在哪側」,不是單次移動方向 → 結尾回甩一點不會翻錯邊。
// - 雙門檻遲滯:過 COMMIT 上膛(提示變亮),回到 DISARM 內才解除 → 回甩一點點不取消。
// - 夾位移依 offset 落在哪側決定上限,沒得換的方向只給小幅 peek(避免 kazi 踩過的「拉過頭回一點就掉」)。
// - 只攔觸控;桌機滑鼠不會觸發 touch 事件。掛在影片區(.content-area),站台/分類 chip 列在它外面 → 天然不衝突。
// 左滑(內容往左)= 下一頁;右滑 = 上一頁。

const SLOP = 10;        // px,判定主軸方向的門檻
const COMMIT = 64;      // px(位移),過這距離才換頁
const DISARM = 28;      // px,上膛後回到這距離內才解除(遲滯)
const RESIST = 0.55;    // 阻尼:內容跟手位移比例
const MAX_DRAG = 0.4;   // 能換的方向最多拖視窗寬的比例
const PEEK = 22;        // 不能換的方向只給這麼一點 peek

export function attachSwipePager(surface, target, opts) {
    const { canPrev, canNext, onPrev, onNext } = opts;

    let startX = 0, startY = 0, dx = 0, dy = 0;
    let decided = false, horizontal = false, dragging = false, armed = 0;
    let hint = null;

    function ensureHint() {
        if (hint) return hint;
        hint = document.createElement('div');
        hint.className = 'swipe-hint';
        surface.appendChild(hint);
        return hint;
    }

    function showHint() {
        ensureHint();
    }

    function updateHint(off) {
        if (!hint) return;
        if (off < -1 && canNext()) {
            hint.textContent = '下一頁 →';
            hint.style.right = '16px';
            hint.style.left = 'auto';
            hint.style.display = 'block';
            hint.classList.toggle('ready', armed < 0);
        } else if (off > 1 && canPrev()) {
            hint.textContent = '← 上一頁';
            hint.style.left = '16px';
            hint.style.right = 'auto';
            hint.style.display = 'block';
            hint.classList.toggle('ready', armed > 0);
        } else {
            hint.style.display = 'none';
        }
    }

    function hideHint() {
        if (hint) hint.style.display = 'none';
    }

    function setOffset(off, animate) {
        target.style.transition = animate ? 'transform 0.2s ease' : 'none';
        target.style.transform = off ? `translateX(${off}px)` : '';
    }

    surface.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { dragging = false; return; }
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY;
        dx = dy = 0; decided = false; horizontal = false; dragging = true; armed = 0;
    }, { passive: true });

    surface.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        const t = e.touches[0];
        dx = t.clientX - startX;
        dy = t.clientY - startY;

        if (!decided) {
            if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
            decided = true;
            horizontal = Math.abs(dx) >= Math.abs(dy);
            // 沒有可換的頁就不接管(維持正常捲動)
            if (horizontal && canPrev() === false && canNext() === false) {
                horizontal = false;
                dragging = false;
                return;
            }
            if (horizontal) showHint();
        }
        if (!horizontal) return;  // 垂直手勢 → 放手讓頁面捲動

        e.preventDefault();  // 接管水平手勢,阻止頁面左右晃/捲動

        const w = surface.clientWidth || 1;
        let off = dx * RESIST;
        const goingNext = off < 0;
        const allowed = goingNext ? canNext() : canPrev();
        const limit = allowed ? w * MAX_DRAG : PEEK;
        off = Math.max(-limit, Math.min(limit, off));
        setOffset(off, false);

        if (off <= -COMMIT && canNext()) armed = -1;
        else if (off >= COMMIT && canPrev()) armed = 1;
        else if (Math.abs(off) < DISARM) armed = 0;
        updateHint(off);
    }, { passive: false });

    function finish() {
        if (decided && horizontal) {
            if (armed < 0 && canNext()) onNext();
            else if (armed > 0 && canPrev()) onPrev();
            setOffset(0, true);
        }
        dragging = false;
        hideHint();
    }

    surface.addEventListener('touchend', finish);
    surface.addEventListener('touchcancel', finish);
}
