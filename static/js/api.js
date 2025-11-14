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
    try {
        const response = await fetch('/api/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, page, type_id: typeId, keyword: keyword })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('影片列表API響應錯誤:', {
                status: response.status,
                statusText: response.statusText,
                url: url,
                page: page,
                typeId: typeId,
                keyword: keyword,
                responseText: errorText
            });

            try {
                const errData = JSON.parse(errorText);
                if (errData.action) throw errData; // 拋出整個物件以進行重定向
                throw new Error(errData.message || '獲取影片列表失敗');
            } catch (parseError) {
                throw new Error(`API請求失敗 (${response.status}): ${response.statusText}`);
            }
        }

        const result = await response.json();
        if (result.status && result.status !== 'success') {
            console.error('影片列表API返回錯誤狀態:', {
                status: result.status,
                message: result.message,
                url: url,
                page: page,
                typeId: typeId,
                keyword: keyword
            });
            throw new Error(result.message || 'API返回錯誤狀態');
        }
        return result;
    } catch (error) {
        console.error('fetchVideoList 失敗:', {
            url: url,
            page: page,
            typeId: typeId,
            keyword: keyword,
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

export async function fetchVideoDetails(url, videoId) {
    try {
        const response = await fetch('/api/details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, id: videoId })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API響應錯誤:', {
                status: response.status,
                statusText: response.statusText,
                url: url,
                videoId: videoId,
                responseText: errorText
            });
            throw new Error(`API請求失敗 (${response.status}): ${response.statusText}`);
        }

        const result = await response.json();
        if (result.status !== 'success') {
            console.error('API返回錯誤狀態:', {
                status: result.status,
                message: result.message,
                url: url,
                videoId: videoId
            });
            throw new Error(result.message || 'API返回錯誤狀態');
        }
        return result;
    } catch (error) {
        console.error('fetchVideoDetails 失敗:', {
            url: url,
            videoId: videoId,
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
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

export async function checkHistoryUpdates(historyItems) {
    try {
        const response = await fetch('/api/history/check_updates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history_items: historyItems })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('檢查更新API響應錯誤:', {
                status: response.status,
                statusText: response.statusText,
                responseText: errorText
            });
            throw new Error(`檢查更新失敗 (${response.status}): ${response.statusText}`);
        }

        const result = await response.json();
        if (result.status !== 'success') {
            console.error('檢查更新API返回錯誤狀態:', result);
            throw new Error(result.message || '檢查更新失敗');
        }
        return result;
    } catch (error) {
        console.error('checkHistoryUpdates 失敗:', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}
