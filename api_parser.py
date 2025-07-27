# api_parser.py
import requests
import json

def process_api_request(base_url, params, logger, ssl_verify=True, site_name=None):
    site_info = f"站點 [{site_name}] " if site_name else ""
    logger.info(f"{site_info}開始處理請求: {base_url} (Params: {params}, SSL Verify: {ssl_verify})")
    if not base_url.startswith('http'):
        base_url = 'http://' + base_url
    
    clean_base_url = base_url.rstrip('/')
    api_url = f"{clean_base_url}/api.php/provide/vod/"
    
    # 構建完整的請求URL用於日誌
    import urllib.parse
    full_url = f"{api_url}?{urllib.parse.urlencode(params)}"
    logger.info(f"{site_info}實際請求URL: {full_url}")
    
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        timeout_seconds = 10
        list_response = requests.get(api_url, headers=headers, params=params, timeout=timeout_seconds, verify=ssl_verify)
        
        # 檢查響應內容，如果是 "暂不支持搜索" 等特殊情況，直接返回錯誤
        response_text = list_response.text.strip()
        if response_text == "暂不支持搜索" or response_text == "不支持":
            logger.warning(f"{site_info}站台返回: {response_text}")
            return {'status': 'error', 'message': f"該站台暫不支持搜尋功能"}
        
        # 檢查HTTP狀態碼
        if list_response.status_code != 200:
            logger.error(f"{site_info}HTTP狀態碼錯誤: {list_response.status_code}")
            return {'status': 'error', 'message': f"站台返回HTTP {list_response.status_code} 錯誤"}
        
        list_data = list_response.json()

        if list_data.get('code') != 1:
            if 'wd' in params and list_data.get('total') == 0:
                 logger.info("搜索無結果。")
                 return {'status': 'success', 'page': 0, 'pagecount': 0, 'total': 0, 'list': [], 'class': list_data.get('class', [])}
            logger.error(f"API(列表)返回錯誤: {list_data.get('msg', '未知錯誤')}")
            return {'status': 'error', 'message': list_data.get('msg', 'API返回錯誤狀態碼')}

        videos = list_data.get('list', [])
        if not videos:
            return {'status': 'success', 'page': list_data.get('page'), 'pagecount': list_data.get('pagecount'), 'total': list_data.get('total'), 'list': [], 'class': list_data.get('class', [])}

        # 統一處理流程：無論是瀏覽還是搜尋，都透過第二次請求獲取最可靠的圖片路徑
        vod_ids = [str(video['vod_id']) for video in videos]
        ids_string = ','.join(vod_ids)
        detail_params = {'ac': 'videolist', 'ids': ids_string}
        detail_response = requests.get(api_url, headers=headers, params=detail_params, timeout=timeout_seconds, verify=ssl_verify)
        detail_response.raise_for_status()
        detail_data = detail_response.json()
        
        detail_videos_map = {}
        if detail_data.get('code') == 1:
            detail_videos_map = {str(v['vod_id']): v for v in detail_data.get('list', [])}

        for video in videos:
            vod_id_str = str(video['vod_id'])
            if vod_id_str in detail_videos_map:
                detail_video = detail_videos_map[vod_id_str]
                # 優先使用詳細資訊中的圖片，因為它更可靠
                pic_url = detail_video.get('vod_pic', '')
                if pic_url and not pic_url.startswith('http'):
                    video['vod_pic'] = f"{clean_base_url}/{pic_url.lstrip('/')}"
                else:
                    video['vod_pic'] = pic_url
            else:
                video['vod_pic'] = ''

        return {
            'status': 'success',
            'page': list_data.get('page'),
            'pagecount': list_data.get('pagecount'),
            'total': list_data.get('total'),
            'list': videos,
            'class': list_data.get('class', [])
        }

    except requests.exceptions.Timeout:
        logger.error(f"{site_info}網絡請求超時 (超過 {timeout_seconds} 秒): {full_url}")
        return {'status': 'error', 'message': f"連接目標站點超時，該站點可能已失效或網絡不佳。"}
    except requests.exceptions.RequestException as e:
        logger.error(f"{site_info}網絡請求失敗: {e} (URL: {full_url})")
        return {'status': 'error', 'message': f"網絡連接失敗，請檢查URL或您的網絡連接。"}
    except json.JSONDecodeError as e:
        # 獲取響應內容以便調試
        try:
            response_text = list_response.text if 'list_response' in locals() else "無法獲取響應內容"
            response_status = list_response.status_code if 'list_response' in locals() else "未知"
            
            # 記錄JSON解析失敗，顯示響應內容
            logger.error(f"{site_info}解析JSON失敗: 響應內容為 {response_text}")
            logger.error(f"{site_info}請求URL: {full_url}")
            logger.error(f"{site_info}響應狀態碼: {response_status}")
            
            # 提供更詳細的錯誤信息
            if response_text.strip() == "":
                error_msg = "API返回空響應，可能是站點已失效或API端點錯誤"
            elif response_text.startswith('<'):
                error_msg = "API返回HTML頁面而非JSON，可能是站點已失效或需要登錄"
            elif len(response_text) < 10:
                error_msg = f"API返回內容過短: '{response_text}'，可能是站點已失效"
            elif "暂不支持搜索" in response_text:
                error_msg = "該站台暫不支持搜尋功能"
            elif "不支持" in response_text:
                error_msg = "該站台不支持此功能"
            else:
                error_msg = f"API返回無效JSON格式，響應內容: {response_text[:100]}..."
                
            return {'status': 'error', 'message': error_msg}
        except Exception as debug_error:
            logger.error(f"{site_info}調試信息獲取失敗: {debug_error}")
            return {'status': 'error', 'message': f"返回的不是有效的JSON格式: {e}"}
    except Exception as e:
        logger.error(f"{site_info}發生未知錯誤: {e}")
        return {'status': 'error', 'message': f"發生未知錯誤: {e}"}


def get_details_from_api(base_url, vod_id, logger, ssl_verify=True, site_name=None):
    site_info = f"站點 [{site_name}] " if site_name else ""
    logger.info(f"{site_info}準備獲取影片ID {vod_id} 的詳細播放列表... (SSL Verify: {ssl_verify})")
    
    if not base_url.startswith('http'):
        base_url = 'http://' + base_url
    clean_base_url = base_url.rstrip('/')
    api_url = f"{clean_base_url}/api.php/provide/vod/"
    detail_params = {'ac': 'videolist', 'ids': str(vod_id)}
    
    # 構建完整的請求URL用於日誌
    import urllib.parse
    full_url = f"{api_url}?{urllib.parse.urlencode(detail_params)}"
    logger.info(f"{site_info}實際請求URL: {full_url}")
    
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        timeout_seconds = 10
        response = requests.get(api_url, headers=headers, params=detail_params, timeout=timeout_seconds, verify=ssl_verify)
        
        # 檢查響應內容，如果是特殊情況，直接返回錯誤
        response_text = response.text.strip()
        if response_text == "暂不支持搜索" or response_text == "不支持":
            logger.warning(f"{site_info}站台返回: {response_text}")
            return {'status': 'error', 'message': f"該站台暫不支持此功能"}
        
        # 檢查HTTP狀態碼
        if response.status_code != 200:
            logger.error(f"{site_info}HTTP狀態碼錯誤: {response.status_code}")
            return {'status': 'error', 'message': f"站台返回HTTP {response.status_code} 錯誤"}
        
        result_data = response.json()

        if 'list' in result_data and isinstance(result_data['list'], list) and result_data['list']:
            item = result_data['list'][0]
            dl = []
            play_from = item.get('vod_play_from', '').split('$$$')
            play_url = item.get('vod_play_url', '').split('$$$')
            
            for i, source_name in enumerate(play_from):
                source = {'flag': source_name, 'episodes': []}
                if i < len(play_url):
                    episodes_raw = play_url[i].strip().split('#')
                    for epi in episodes_raw:
                        parts = epi.split('$')
                        if len(parts) == 2:
                            source['episodes'].append({'name': parts[0], 'url': parts[1]})
                dl.append(source)
                
            logger.info(f"成功解析影片ID {vod_id} 的播放列表。")
            return {'status': 'success', 'data': dl}
        else:
            logger.error(f"{site_info}詳情API返回的JSON格式不符合預期，缺少有效的 'list' 數據。收到的數據: {result_data}")
            raise ValueError("詳情API未返回有效的 'list' 數據")
            
    except requests.exceptions.Timeout:
        logger.error(f"{site_info}獲取詳情時超時 (超過 {timeout_seconds} 秒): {full_url}")
        return {'status': 'error', 'message': f"獲取詳情時連接超時。"}
    except requests.exceptions.RequestException as e:
        logger.error(f"{site_info}獲取詳情時網絡請求失敗: {e} (URL: {full_url})")
        return {'status': 'error', 'message': f"獲取詳情時網絡連接失敗，請檢查站點是否可用。"}
    except json.JSONDecodeError as e:
        # 獲取響應內容以便調試
        try:
            response_text = response.text if 'response' in locals() else "無法獲取響應內容"
            response_status = response.status_code if 'response' in locals() else "未知"
            
            # 記錄JSON解析失敗，顯示響應內容
            logger.error(f"{site_info}解析JSON失敗: 響應內容為 {response_text}")
            logger.error(f"{site_info}請求URL: {full_url}")
            logger.error(f"{site_info}響應狀態碼: {response_status}")
            
            # 提供更詳細的錯誤信息
            if response_text.strip() == "":
                error_msg = "詳情API返回空響應，可能是站點已失效或API端點錯誤"
            elif response_text.startswith('<'):
                error_msg = "詳情API返回HTML頁面而非JSON，可能是站點已失效或需要登錄"
            elif len(response_text) < 10:
                error_msg = f"詳情API返回內容過短: '{response_text}'，可能是站點已失效"
            elif "暂不支持搜索" in response_text:
                error_msg = "該站台暫不支持此功能"
            elif "不支持" in response_text:
                error_msg = "該站台不支持此功能"
            else:
                error_msg = f"詳情API返回無效JSON格式，響應內容: {response_text[:100]}..."
                
            return {'status': 'error', 'message': error_msg}
        except Exception as debug_error:
            logger.error(f"{site_info}詳情API調試信息獲取失敗: {debug_error}")
            return {'status': 'error', 'message': f"詳情API返回無效JSON格式: {e}"}
    except Exception as e:
        logger.error(f"{site_info}獲取影片ID {vod_id} 的詳情時出錯: {e}")
        return {'status': 'error', 'message': f'獲取詳情失敗: {e}'}
