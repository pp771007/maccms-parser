"use strict";

import { $ } from './utils.js';
import { showModal, showToast } from './modal.js';

document.addEventListener('DOMContentLoaded', () => {
    loadAccount();
    $('#saveNicknameBtn').addEventListener('click', saveNickname);
    $('#changePwBtn').addEventListener('click', changePassword);
});

async function loadAccount() {
    try {
        const res = await fetch('/api/account');
        if (!res.ok) throw new Error();
        const data = await res.json();
        $('#nickname').value = data.nickname || '';
        $('#accountRole').textContent = data.role === 'admin' ? '身分:管理員' : '身分:會員';
    } catch (e) {
        $('#accountRole').textContent = '載入失敗,請重新整理';
    }
}

async function patchAccount(body, okMsg) {
    try {
        const res = await fetch('/api/account', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showModal(data.message || '操作失敗', 'error');
            return false;
        }
        showToast(okMsg, 'success');
        return true;
    } catch (e) {
        showModal('操作失敗,請稍後再試', 'error');
        return false;
    }
}

async function saveNickname() {
    const nickname = $('#nickname').value.trim();
    await patchAccount({ nickname }, '暱稱已更新');
}

async function changePassword() {
    const currentPassword = $('#currentPw').value;
    const newPassword = $('#newPw').value.trim();
    if (!currentPassword) { showModal('請輸入目前密碼', 'warning'); return; }
    if (newPassword.length < 4) { showModal('新密碼至少 4 個字元', 'warning'); return; }
    const ok = await patchAccount({ currentPassword, newPassword }, '密碼已變更');
    if (ok) { $('#currentPw').value = ''; $('#newPw').value = ''; }
}
