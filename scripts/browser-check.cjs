// 브라우저 확인(선택): headless Chromium 으로 file:// 를 열어 화면마다 오류·가로 넘침·주요 동작을 봅니다.
// 실행: PLAYWRIGHT=<playwright 패키지 경로> node scripts/browser-check.cjs
//   예) PLAYWRIGHT=~/.npm/_npx/<해시>/node_modules/playwright CHROME=<chrome-headless-shell 경로(선택)> node scripts/browser-check.cjs
// 리포는 playwright 를 의존성으로 두지 않습니다(정적 도구라 설치할 것이 없게).
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const root = path.join(__dirname, '..');
const url = 'file://' + path.join(root, 'index.html');
const PAGES = ['home', 'daily', 'achieve', 'measure', 'analysis', 'loss', 'sim', 'compare', 'sop', 'report', 'process', 'settings'];
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok  ' : '  FAIL ') + msg); if (!ok) fails++; }

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  for (const width of [1280, 390]) {
    console.log('— 폭 ' + width + 'px');
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('dialog', (d) => d.accept());
    await page.goto(url + '#/settings');
    await page.getByRole('button', { name: '가상 샘플 불러오기' }).click();
    await page.waitForTimeout(400);
    check(await page.locator('#sampleBanner').isVisible(), '샘플 배너');
    for (const id of PAGES) {
      await page.goto(url + '#/' + id);
      await page.waitForTimeout(150);
      // 가로 넘침 — 안쪽 가로 스크롤 상자(table-wrap 등) 안은 의도된 것이라 뺍니다
      const over = await page.evaluate(() => {
        const W = document.documentElement.clientWidth, bad = [];
        document.querySelectorAll('.main *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width || r.right <= W + 1) return;
          for (let p = el.parentElement; p; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') return; }
          bad.push(el.tagName + '.' + el.className + ' ' + Math.round(r.right));
        });
        return { bad: bad.slice(0, 3), scroll: document.documentElement.scrollWidth - W };
      });
      check(!over.bad.length && over.scroll <= 0, id + ' 가로 넘침 없음' + (over.bad.length ? ' ' + over.bad.join(' | ') : '') + (over.scroll > 0 ? ' scroll+' + over.scroll : ''));
    }
    // 검사기 자체 확인 — 일부러 넓은 상자를 넣으면 넘침을 잡아야 합니다
    const caught = await page.evaluate(() => {
      const d = document.createElement('div'); d.style.width = '3000px'; d.style.height = '4px'; document.querySelector('.main').appendChild(d);
      const W = document.documentElement.clientWidth; const r = d.getBoundingClientRect(); d.remove(); return r.right > W + 1;
    });
    check(caught, '넘침 검사기가 일부러 넣은 넓은 상자를 잡음');
    // 주요 내용
    await page.goto(url + '#/analysis');
    await page.getByRole('button', { name: '개선 전' }).click();
    check((await page.locator('.tiles').innerText()).includes('본용접'), '병목 분석(개선 전) — 본용접이 병목');
    await page.goto(url + '#/loss');
    await page.getByRole('button', { name: '개선 전' }).click();
    check((await page.locator('.tile').nth(2).innerText()).includes('대기'), '손실 분석(개선 전) — 대기가 1위');
    await page.goto(url + '#/sim');
    await page.getByRole('button', { name: '같은 인원으로 자동 배분 제안' }).click();
    const simTiles = await page.locator('.tiles').innerText();
    check(/현재 인원 유지/.test(simTiles), '인원 배분 — 같은 인원 유지 표시');
    await page.goto(url + '#/compare');
    const kpi = (await page.locator('.tiles .tile .v').allInnerTexts()).slice(0, 2);
    check(kpi.every((v) => v.trim() === '달성'), '개선 전·후 — 인원 유지·달성률 90% 모두 「달성」 (' + kpi.join(', ') + ')');
    check(/원/.test(await page.locator('.tiles .tile .v').nth(2).innerText()), '개선 전·후 — 대당 절감액 표시');
    await page.goto(url + '#/report');
    const prompt = await page.locator('textarea[readonly]').inputValue();
    check(!/작업자[A-I]/.test(prompt) && /작업자\d/.test(prompt), 'AI 프롬프트 — 작업자 이름이 별칭으로 바뀜');
    check(!/절감액/.test(prompt), 'AI 프롬프트 — 원가는 기본으로 빠짐');
    // 스톱워치
    await page.goto(url + '#/measure');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('data10-08.db')).measures.length);
    await page.getByRole('button', { name: '작업 시작' }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '대기' }).click();
    await page.waitForTimeout(1200);
    await page.reload(); // 새로 고쳐도 측정 중인 구간이 이어지는지
    await page.waitForTimeout(200);
    check((await page.locator('.sw-kind').innerText()).includes('대기 중'), '스톱워치 — 새로 고쳐도 측정 이어짐');
    await page.getByRole('button', { name: '멈춤(기록 끝)' }).click();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('data10-08.db')).measures.length);
    check(after === before + 2, '스톱워치 — 구간 2개 기록 (' + before + ' → ' + after + ')');
    // 엑셀 가져오기 — 같은 파일을 다시 넣어도 두 번 세지 않음
    await page.goto(url + '#/daily');
    await page.locator('input[type=file]').first().setInputFiles(path.join(root, 'samples', '프레임_일일실적_샘플_0831-1016.xlsx'));
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /확인한 1개 파일 반영/ }).click();
    const days = await page.evaluate(() => JSON.parse(localStorage.getItem('data10-08.db')).daily.length);
    check(days === 32, '일일 실적 엑셀 다시 가져오기 — 32일 그대로 (' + days + ')');
    // 좁은 화면: 메뉴 단추로 왼쪽 메뉴 열기
    for (const id of ['home', 'measure', 'analysis', 'sop']) { await page.goto(url + '#/' + id); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS || require('os').tmpdir(), 'data10-08_' + width + '_' + id + '.png'), fullPage: false }); }
    if (width < 1024) {
      await page.locator('#menuBtn').click();
      check(await page.locator('#sidebar').isVisible(), '좁은 화면 — 메뉴 단추로 왼쪽 메뉴 열림');
    }
    check(!errors.length, '콘솔 오류 없음' + (errors.length ? ': ' + errors.slice(0, 3).join(' / ') : ''));
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? '\n실패 ' + fails + '개' : '\n모두 통과');
  process.exitCode = fails ? 1 : 0;
})();
