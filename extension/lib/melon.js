import { broadcastProgress } from './state.js';

const UA        = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_SIZE = 50;
const sleep     = ms => new Promise(r => setTimeout(r, ms));

async function bgFetch(url, options = {}) {
  const resp = await fetch(url, options);
  return { ok: resp.ok, status: resp.status, url: resp.url, text: await resp.text() };
}

function parseMelonHtml(html) {
  const titleRe  = /class="btn btn_icon_detail"[^>]*>\s*<span class="odd_span">([^<]+)<\/span>/g;
  const artistRe = /id="artistName"[^>]*>[\s\S]*?<a [^>]*>([^<]+)<\/a>/g;
  const titles   = [...html.matchAll(titleRe)].map(m => m[1].trim());
  const artists  = [...html.matchAll(artistRe)].map(m => m[1].trim());
  return titles.flatMap((title, i) => artists[i] ? [{ title, artist: artists[i] }] : []);
}

export async function fetchMelonSongs(inputUrl, shouldStop) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };

  let finalUrl = inputUrl;
  if (!inputUrl.includes('plylstSeq=')) {
    broadcastProgress({ step: '단축 URL 확인 중...' });
    finalUrl = (await bgFetch(inputUrl, { redirect: 'follow', headers })).url;
  }

  const seqMatch = finalUrl.match(/plylstSeq=(\d+)/);
  if (!seqMatch) throw new Error(`plylstSeq를 찾지 못했습니다. 실제 URL: ${finalUrl}`);

  const plylstSeq = seqMatch[1];
  const referer   = `https://www.melon.com/mymusic/playlist/mymusicplaylistview_inform.htm?plylstSeq=${plylstSeq}`;
  const listUrl   = page => `https://www.melon.com/mymusic/playlist/mymusicplaylistview_listSong.htm?plylstSeq=${plylstSeq}&startIndex=${(page - 1) * PAGE_SIZE + 1}&pageSize=${PAGE_SIZE}`;

  const seenKeys = new Set();
  const songs    = [];

  for (let page = 1; ; page++) {
    if (shouldStop()) break;
    broadcastProgress({ step: `${page}페이지 로딩 중...` });

    try {
      const resp      = await bgFetch(listUrl(page), { headers: { ...headers, Referer: referer } });
      const pageSongs = parseMelonHtml(resp.text);

      if (!pageSongs.length) break;

      let newCount = 0;
      for (const song of pageSongs) {
        const key = `${song.title}||${song.artist}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          songs.push(song);
          newCount++;
        }
      }

      // Melon은 마지막 페이지를 앞 곡으로 패딩하므로 신곡이 0이면 종료
      if (newCount === 0) break;
    } catch (e) {
      broadcastProgress({ log: `${page}페이지 실패: ${e.message}`, logType: 'err' });
      break;
    }

    await sleep(300);
  }

  broadcastProgress({ log: `총 ${songs.length}곡 가져옴`, logType: 'info' });
  return songs;
}
