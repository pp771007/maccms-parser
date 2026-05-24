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
        li.className = 'member-item-wrap';
        const nick = (m.nickname || '').replace(/"/g, '&quot;');
        li.innerHTML = `
            <div class="member-item">
                <span class="member-note">${m.nickname || '(無暱稱)'}</span>
                <div class="member-actions">
                    <button class="btn btn-secondary btn-sm edit-btn">編輯</button>
                    <button class="btn btn-outline-danger btn-sm del-btn">刪除</button>
                </div>
            </div>
            <div class="member-edit" style="display:none">
                <input type="text" class="edit-nickname" placeholder="暱稱" value="${nick}" autocomplete="off">
                <input type="text" class="edit-password" placeholder="新密碼(留空=不改)" autocomplete="off">
                <button class="btn btn-primary btn-sm save-edit">儲存</button>
            </div>`;
        const editForm = li.querySelector('.member-edit');
        li.querySelector('.edit-btn').addEventListener('click', () => {
            editForm.style.display = editForm.style.display === 'none' ? 'flex' : 'none';
        });
        li.querySelector('.save-edit').addEventListener('click', () => saveMember(m.id, li));
        armConfirmDelete(li.querySelector('.del-btn'), () => removeMember(m.id));
        list.appendChild(li);
    });
}

async function saveMember(id, li) {
    const nickname = li.querySelector('.edit-nickname').value.trim();
    const password = li.querySelector('.edit-password').value.trim();
    const body = { nickname };
    if (password) body.password = password;
    try {
        const res = await fetch(`/api/members/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showModal(data.message || '更新失敗', 'error'); return; }
        showToast('已更新會員', 'success');
        loadMembers();
    } catch (e) {
        showModal('更新失敗,請稍後再試', 'error');
    }
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
