import { broadcastProgress } from './state.js';

const PAGE_SIZE = 100;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return res.text();
}

function extractToken(html) {
  // script id="session" 방식
  const m1 = html.match(/<script[^>]+id="session"[^>]*>([^<]+)<\/script>/);
  if (m1) { try { const t = JSON.parse(m1[1])?.accessToken; if (t) return t; } catch {} }

  // __NEXT_DATA__ 방식
  const m2 = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (m2) {
    try {
      const d = JSON.parse(m2[1]);
      const t = d?.props?.pageProps?.accessToken || d?.props?.pageProps?.session?.accessToken;
      if (t) return t;
    } catch {}
  }

  // HTML 어딘가에 accessToken 값이 있는 경우
  const m3 = html.match(/"accessToken"\s*:\s*"([^"]{20,})"/);
  if (m3) return m3[1];

  return null;
}

async function getPublicToken(playlistId) {
  for (const url of [
    `https://open.spotify.com/playlist/${playlistId}`,
    `https://open.spotify.com/embed/playlist/${playlistId}`,
  ]) {
    const html = await fetchHtml(url);
    const token = extractToken(html);
    if (token) return token;
  }
  throw new Error('Spotify 세션 토큰을 찾지 못했습니다. 플레이리스트가 공개 상태인지 확인하세요.');
}

export async function fetchSpotifySongs(playlistUrl, shouldStop) {
  const playlistId = playlistUrl.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
  if (!playlistId) throw new Error('올바른 Spotify 플레이리스트 URL을 입력해주세요.');

  broadcastProgress({ step: 'Spotify 토큰 가져오는 중...' });
  const token   = await getPublicToken(playlistId);
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': UA };

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
