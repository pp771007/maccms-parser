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
});

