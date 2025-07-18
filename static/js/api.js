export async function fetchSites(context = '') {
    const url = context ? `/api/sites?context=${context}` : '/api/sites';
    const response = await fetch(url);
    if (!response.ok) {
        try {
            const errData = await response.json();
            // 將後端傳來的整個錯誤物件拋出，以便上層處理
            throw errData;
        } catch (e) {
            // 如果解析 JSON 失敗，或後端未回傳 JSON，則拋出通用錯誤
            throw new Error(`無法載入站點列表: ${response.statusText}`);
        }
    }
    return await response.json();
}

export async function postNewSite(name, url) {
    const response = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url })
    });
    if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || '新增失敗');
    }
    return await response.json();
}

export async function updateSite(siteId, data) {
    const response = await fetch(`/api/sites/${siteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || '更新失敗');
    }
    return await response.json();
}

export async function deleteSite(siteId) {
    const response = await fetch(`/api/sites/${siteId}`, {
        method: 'DELETE'
    });
    if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || '刪除失敗');
    }
    return await response.json();
}

export async function moveSite(siteId, direction) {
    const response = await fetch(`/api/sites/${siteId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction })
    });
    if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || '移動失敗');
    }
    return await response.json();
}

export async function fetchMultiSiteVideoList(siteIds, page, keyword) {
    const response = await fetch('/api/multi_site_search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_ids: siteIds, page, keyword })
    });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: '多站點搜尋失敗' }));
        if (errData.action) throw errData; // 拋出整個物件以進行重定向
        throw new Error(errData.message);
    }
    return await response.json();
}

export async function fetchVideoList(url, page, typeId, keyword) {
    const response = await fetch('/api/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, page, type_id: typeId, keyword: keyword })
    });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: '獲取影片列表失敗' }));
        if (errData.action) throw errData; // 拋出整個物件以進行重定向
        throw new Error(errData.message);
    }
    const result = await response.json();
    if (result.status && result.status !== 'success') {
        throw new Error(result.message);
    }
    return result;
}

export async function fetchVideoDetails(url, videoId) {
    const response = await fetch('/api/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, id: videoId })
    });
    const result = await response.json();
    if (result.status !== 'success') {
        throw new Error(result.message);
    }
    return result;
}

export async function checkSitesNow(includeDisabled = false) {
    const response = await fetch('/api/sites/check_now', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ include_disabled: includeDisabled })
    });
    if (!response.ok) {
        throw new Error('檢查站點失敗');
    }
    return response.json();
}

export async function checkSingleSite(siteId) {
    const response = await fetch(`/api/sites/${siteId}/check`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    });
    if (!response.ok) {
        throw new Error('檢查站點失敗');
    }
    return response.json();
}
