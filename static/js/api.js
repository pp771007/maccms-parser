export async function fetchSites() {
    const response = await fetch('/api/sites');
    if (!response.ok) throw new Error('無法獲取站點列表');
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
        const errData = await response.json();
        throw new Error(errData.message || '多站點搜尋失敗');
    }
    return await response.json();
}

export async function fetchVideoList(url, page, typeId, keyword) {
    const response = await fetch('/api/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, page, type_id: typeId, keyword: keyword })
    });
    const result = await response.json();
    if (result.status !== 'success') {
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
