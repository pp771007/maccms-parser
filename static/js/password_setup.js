document.addEventListener('DOMContentLoaded', function () {
    // 自動聚焦到第一個密碼輸入欄
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.focus();

        // 確保在移動設備上也能正確聚焦
        setTimeout(() => {
            passwordInput.focus();
        }, 100);
    }
});



document.getElementById('setup-form').addEventListener('submit', function (event) {
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const errorMessage = document.getElementById('error-message');

    errorMessage.textContent = ''; // Clear previous errors

    if (password.length < 6) {
        event.preventDefault();
        errorMessage.textContent = '密碼長度不能少於 6 個字元。';
        return;
    }

    if (password !== confirmPassword) {
        event.preventDefault(); // 阻止表單提交
        errorMessage.textContent = '兩次輸入的密碼不一致，請重新輸入。';
    }
}); 