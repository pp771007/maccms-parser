// modal.js - 通用彈窗元件
const modalRootId = 'customModal';

function ensureModalRoot() {
  let modal = document.getElementById(modalRootId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalRootId;
    document.body.appendChild(modal);
  }
  return modal;
}

function showModal(message, type = 'info', title = '') {
  const modal = ensureModalRoot();
  modal.innerHTML = `
    <div class="modal-dialog modal-${type}">
      <div class="modal-title">${title || modalTitleByType(type)}</div>
      <div class="modal-message">${message}</div>
      <div class="modal-btns">
        <button class="modal-btn ok">確定</button>
      </div>
    </div>
  `;
  modal.classList.add('active');
  modal.querySelector('.ok').onclick = () => {
    modal.classList.remove('active');
  };
}

function showConfirm(message, onConfirm, title = '請確認', type = 'warning') {
  const modal = ensureModalRoot();
  modal.innerHTML = `
    <div class="modal-dialog modal-${type}">
      <div class="modal-title">${title}</div>
      <div class="modal-message">${message}</div>
      <div class="modal-btns">
        <button class="modal-btn ok">確定</button>
        <button class="modal-btn cancel">取消</button>
      </div>
    </div>
  `;
  modal.classList.add('active');
  modal.querySelector('.ok').onclick = () => {
    modal.classList.remove('active');
    if (onConfirm) onConfirm();
  };
  modal.querySelector('.cancel').onclick = () => {
    modal.classList.remove('active');
  };
}

function showToast(message, type = 'success', duration = 2200) {
  let toast = document.createElement('div');
  toast.className = `custom-toast toast-${type}`;
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.add('show'); }, 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

function modalTitleByType(type) {
  switch (type) {
    case 'success': return '成功';
    case 'error': return '錯誤';
    case 'warning': return '提醒';
    default: return '訊息';
  }
}

export { showModal, showConfirm, showToast }; 