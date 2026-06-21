import { broadcastProgress } from './state.js';

const PAGE_SIZE = 100;

function spotifyTokenFn() {
  return new Promise(resolve => {
    const origFetch = window.fetch;
    let done = false;

    window.fetch = function(input, init, ...rest) {
      const url = (typeof input === 'string' ? input : input?.url) || '';
      if (!done && url.includes('api.spotify.com')) {
        const auth = (init?.headers?.Authorization || init?.headers?.authorization) ?? '';
        if (auth.startsWith('Bearer ')) {
          done = true;
          window.fetch = origFetch;
          resolve({ ok: true, data: auth.slice(7) });
        }
      }
      return origFetch.call(this, input, init, ...rest);
    };

    setTimeout(() => {
      if (!done) {
        window.fetch = origFetch;
        resolve({ ok: false, error: 'Spotify API 요청을 감지하지 못했습니다. Spotify에서 음악을 재생 중인지 확인하세요.' });
      }
    }, 10000);
  });
}

async function getToken(spotifyTabId) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('토큰 요청 시간 초과 — Spotify 탭을 확인하세요.')), 10000)
  );
  const exec = chrome.scripting.executeScript({
    target: { tabId: spotifyTabId }, world: 'MAIN', func: spotifyTokenFn, args: [],
  }).then(res => {
    const r = res[0]?.result;
    if (!r?.ok) throw new Error(r?.error || '토큰 획득 실패');
    return r.data;
  });
  return Promise.race([exec, timeout]);
}

export async function fetchSpotifySongs(playlistUrl, spotifyTabId, shouldStop) {
  const playlistId = playlistUrl.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
  if (!playlistId) throw new Error('올바른 Spotify 플레이리스트 URL을 입력해주세요.');

  broadcastProgress({ step: 'Spotify 토큰 가져오는 중...' });
  const token   = await getToken(spotifyTabId);
  const headers = { Authorization: `Bearer ${token}` };

  broadcastProgress({ step: '플레이리스트 정보 로딩 중...' });
  const infoRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.total`,
    { headers }
  );
  const info = await infoRes.json();
  if (!info.tracks?.total) throw new Error('플레이리스트를 가져올 수 없습니다. URL을 확인하세요.');

  const totalCount = info.tracks.total;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  broadcastProgress({ log: `총 ${totalCount}곡 (${totalPages}페이지)`, logType: 'info' });

  const songs = [];
  for (let page = 0; page < totalPages; page++) {
    if (shouldStop()) break;
    broadcastProgress({ step: `${page + 1}/${totalPages}페이지 로딩 중...` });
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&fields=items(track(name,artists(name)))`,
      { headers }
    );
    const data  = await res.json();
    const items = data.items
      ?.filter(item => item.track)
      .map(item => ({
        title:  item.track.name,
        artist: item.track.artists.map(a => a.name).join(', '),
      })) || [];
    songs.push(...items);
    broadcastProgress({ step: `${page + 1}/${totalPages}페이지: ${items.length}곡` });
  }

  return songs;
}
