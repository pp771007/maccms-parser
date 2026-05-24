"use strict";

import { $ } from './utils.js';
import { showModal, showToast } from './modal.js';
import { armConfirmDelete } from './confirmDelete.js';

document.addEventListener('DOMContentLoaded', () => {
    loadMembers();
    $('#addMemberBtn').addEventListener('click', addMember);
    $('#memberNickname').addEventListener('keyup', (e) => { if (e.key === 'Enter') addMember(); });
});

async function loadMembers() {
    const list = $('#memberList');
    try {
        const res = await fetch('/api/members');
        if (!res.ok) throw new Error();
        renderMembers(await res.json());
    } catch (e) {
        list.innerHTML = '<li class="empty-hint">載入失敗,請重新整理</li>';
    }
}

function renderMembers(members) {
    const list = $('#memberList');
    list.innerHTML = '';
    if (!members || members.length === 0) {
        list.innerHTML = '<li class="empty-hint">還沒有任何會員 — 在上面新增一個</li>';
        return;
    }
    members.forEach(m => {
        const li = document.createElement('li');
        li.className = 'member-item';

        const nick = document.createElement('span');
        nick.className = 'member-note';
        nick.textContent = m.nickname || '(無暱稱)';
        li.appendChild(nick);

        const del = document.createElement('button');
        del.className = 'btn btn-outline-danger btn-sm';
        del.textContent = '刪除';
        // 兩段式:第一下變「確認」,再按一次才刪
        armConfirmDelete(del, () => removeMember(m.id));
        li.appendChild(del);

        list.appendChild(li);
    });
}

async function addMember() {
    const password = $('#memberPassword').value.trim();
    const nickname = $('#memberNickname').value.trim();
    if (!password) {
        showModal('請輸入會員密碼', 'warning');
        return;
    }
    try {
        const res = await fetch('/api/members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, nickname }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showModal(data.message || '新增失敗', 'error');
            return;
        }
        $('#memberPassword').value = '';
        $('#memberNickname').value = '';
        showToast('已新增會員', 'success');
        loadMembers();
    } catch (e) {
        showModal('新增失敗,請稍後再試', 'error');
    }
}

async function removeMember(id) {
    // 確認交給按鈕的兩段式;刪會員會一併刪其觀看歷史(後端處理)
    try {
        const res = await fetch(`/api/members/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('已刪除會員', 'success');
            loadMembers();
        } else {
            showModal('刪除失敗', 'error');
        }
    } catch (e) {
        showModal('刪除失敗,請稍後再試', 'error');
    }
}
