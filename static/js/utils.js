export const $ = selector => document.querySelector(selector);
export const $$ = selector => document.querySelectorAll(selector);

// 從集名取出集號:「第14集」「14」「EP14」→ 14;取不到回 null
export function episodeNumberFromName(name) {
    const m = String(name || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

// 換線路 / 換站時對齊集數:先用集名裡的集號對(「第14集」→ 找對方的 14),
// 對不到再退回同一個集號(clamp 進範圍)。targetEpisodes 為空回 0。
export function matchEpisodeIndex(currentName, currentIdx, targetEpisodes) {
    if (!targetEpisodes || targetEpisodes.length === 0) return 0;
    const n = episodeNumberFromName(currentName);
    if (n !== null) {
        const byNum = targetEpisodes.findIndex(e => episodeNumberFromName(e.name) === n);
        if (byNum >= 0) return byNum;
    }
    return Math.min(Math.max(currentIdx, 0), targetEpisodes.length - 1);
}
