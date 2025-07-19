// PWA 返回處理變數
let backPressCount = 0;
let backPressTimer = null;

document.addEventListener('DOMContentLoaded', function () {
    // 自動聚焦到密碼輸入欄
    const passwordInput = document.getElementById('passwordInput');
    if (passwordInput) {
        passwordInput.focus();

        // 確保在移動設備上也能正確聚焦
        setTimeout(() => {
            passwordInput.focus();
        }, 100);
    }

    // 設置 PWA 返回處理
    setupPWAExitHandler();
});

function setupPWAExitHandler() {
    // 阻止登入頁面的返回行為
    window.history.pushState(null, null, window.location.href);

    // 監聽瀏覽器的返回按鈕事件
    window.addEventListener('popstate', (e) => {
        e.preventDefault();

        // 在PWA模式下，直接返回主頁面
        if (window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true) {

            // 清除任何現有的計時器
            if (backPressTimer) {
                clearTimeout(backPressTimer);
            }

            // 設置標記，表示從其他頁面返回
            sessionStorage.setItem('fromOtherPage', 'true');

            // 重置返回計數器並返回主頁面
            backPressCount = 0;
            window.location.href = '/';
        } else {
            // 非PWA模式，重新推入狀態以防止返回
            window.history.pushState(null, null, window.location.href);
        }
    });
} 