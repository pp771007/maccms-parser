"use strict";

// 兩段式刪除,對齊 kazi 的 ConfirmDeleteButton:
// 第一下 → 按鈕變「確認」(紅底);3 秒內沒再按會自動還原;第二下才真的執行 onConfirm。
// 防遙控器 / 誤觸刪到重要資料。用在:站台刪除、會員刪除、單筆/全部觀看歷史刪除。
export function armConfirmDelete(button, onConfirm, { confirmText = '確認', timeout = 3000 } = {}) {
    if (!button || button.dataset.confirmBound) return;
    button.dataset.confirmBound = '1';

    let armed = false;
    let timer = null;
    const originalHTML = button.innerHTML;

    const reset = () => {
        armed = false;
        button.innerHTML = originalHTML;
        button.classList.remove('confirm-armed');
        if (timer) { clearTimeout(timer); timer = null; }
    };

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!armed) {
            armed = true;
            button.textContent = confirmText;
            button.classList.add('confirm-armed');
            timer = setTimeout(reset, timeout);
        } else {
            reset();
            onConfirm();
        }
    });
}
