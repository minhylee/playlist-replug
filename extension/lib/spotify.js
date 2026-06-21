import { broadcastProgress } from './state.js';

const PAGE_SIZE = 100;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SPOTIFY_CLIENT_ID = 'd8a5ed958d274c2e8ee717e6a4b0971d';

async function getAnonymousToken() {
  const res = await fetch('https://clienttoken.spotify.com/v1/clienttoken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_data: {
        client_version: '1.0.0',
        client_id: SPOTIFY_CLIENT_ID,
        js_sdk_data: { device_brand: 'Apple', device_model: 'macos', os: 'macos', os_version: '10.15.7' },
      },
    }),
  });
  const data = await res.json();
  const token = data.granted_token?.token;
  if (!token) throw new Error(`Spotify 토큰 발급 실패: ${JSON.stringify(data).slice(0, 120)}`);
  return token;
}

export async function fetchSpotifySongs(playlistUrl, shouldStop) {
  const playlistId = playlistUrl.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
  if (!playlistId) throw new Error('올바른 Spotify 플레이리스트 URL을 입력해주세요.');

  broadcastProgress({ step: 'Spotify 토큰 가져오는 중...' });
  const token   = await getAnonymousToken();
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': UA };

  broadcastProgress({ step: '플레이리스트 정보 로딩 중...' });
  const infoRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.total`,
    { headers }
  );
  const infoText = await infoRes.text();
  let info;
  try { info = JSON.parse(infoText); }
  catch { throw new Error(`Spotify API 오류 (HTTP ${infoRes.status}): ${infoText.slice(0, 120)}`); }
  if (info.error) throw new Error(`Spotify API: ${info.error.message} (${info.error.status})`);
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
