// 실행: node test/logic.test.mjs   (의존성 없음 — vendor 의 SheetJS 만 씀)
// 실제 회사 실적·측정 자료는 아직 받지 않았습니다. 여기서는 손으로 만든 작은 표와 가상 샘플로 계산을 검사합니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');
const XLSX = require('../vendor/xlsx.full.min.js');
const E = require('../js/ai-endpoint.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` ${a} ≈ ${b}`);

// 앱과 같은 길: aoa → 통합문서 → xlsx 바이트 → 다시 읽기(raw 숫자)
function roundTrip(aoa, name = '시트1') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  const back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
  return XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, raw: true, defval: null });
}
function sampleDb() {
  const b = Sample.build();
  const db = L.emptyDb();
  db.processes = b.processes;
  db.settings = L.cleanSettings(b.settings);
  db.compare = b.compare;
  db.daily = L.mergeDaily([], L.parseDaily(roundTrip(b.dailyFile.aoa)).records).records;
  let ms = [];
  b.measureFiles.forEach((f) => { ms = ms.concat(L.parseMeasure(roundTrip(f.aoa)).records); });
  db.measures = L.mergeMeasures([], ms).records;
  return db;
}
const BEFORE = { from: '2026-08-31', to: '2026-09-18' }, AFTER = { from: '2026-09-28', to: '2026-10-16' };

console.log('숫자·날짜·시각');
test('toNum — 단위 붙은 값·쉼표·빈칸·수식', () => {
  assert.equal(L.toNum('10대'), 10); assert.equal(L.toNum('7.5h'), 7.5); assert.equal(L.toNum('1,200'), 1200);
  assert.equal(L.toNum(''), null); assert.equal(L.toNum('=A1'), null); assert.ok(Number.isNaN(L.toNum('열대')));
});
test('toISO — 엑셀 일련번호·여러 글자 꼴·연도 없는 날짜', () => {
  assert.equal(L.toISO(46273), '2026-09-08');
  assert.equal(L.toISO('2026.9.8'), '2026-09-08'); assert.equal(L.toISO('2026년 9월 8일'), '2026-09-08');
  assert.equal(L.toISO('9/8', 2026), '2026-09-08'); assert.equal(L.toISO('2026-09-08(화)'), '2026-09-08');
  assert.equal(L.toISO('2026-02-30'), ''); assert.equal(L.toISO('합계'), '');
});
test('toSec — 글자·엑셀 시각·날짜+시각·오후 표기', () => {
  assert.equal(L.toSec('08:30'), 30600); assert.equal(L.toSec('8:30:15'), 30615);
  assert.equal(L.toSec(0.5), 43200); assert.equal(L.toSec(46273.5), 43200);
  assert.equal(L.toSec('오후 1:20'), 13 * 3600 + 20 * 60); assert.equal(L.toSec('25:00'), null);
});
test('durSec — 자정 넘김·형식 섞임', () => {
  assert.equal(L.durSec('08:00', '08:45:30'), 2730);
  assert.equal(L.durSec('23:50', '00:10'), 1200);
  assert.equal(L.durSec(0.25, '06:30'), 1800);
});
test('주·월 묶기 — 월요일 시작', () => {
  assert.equal(L.weekStart('2026-09-13'), '2026-09-07'); // 일요일 → 그 주 월요일
  assert.equal(L.weekStart('2026-09-07'), '2026-09-07');
  assert.equal(L.monthKey('2026-09-30'), '2026-09');
});

console.log('엑셀 열 찾기');
test('일일 실적 — 제목 행 아래 머리행·단위 붙은 머리 이름', () => {
  const aoa = [['■ 실적'], ['일자', '목표(대)', '실적(대)', '작업인원(명)', '가용시간(HR)', '비고'], [46273, 10, 8, 9, 7.5, '대기']];
  const d = L.detectColumns(aoa, L.DAILY_FIELDS);
  assert.equal(d.headerRow, 1);
  assert.deepEqual(d.map, { date: 0, target: 1, actual: 2, workers: 3, availHr: 4, note: 5 });
  assert.deepEqual(d.missing, []);
});
test('일일 실적 — 다른 이름(생산일자·목표 실적 대수·실제 생산 대수)', () => {
  const d = L.detectColumns([['생산일자', '목표 실적 대수', '실제 생산 대수', '투입인원', '일일 가용시간']], L.DAILY_FIELDS);
  assert.deepEqual(d.map, { date: 0, target: 1, actual: 2, workers: 3, availHr: 4 });
});
test('열 연결 직접 고치기 — 한 열은 한 칸에만', () => {
  const aoa = [['날짜', '계획', '생산', '메모']];
  const d = L.detectColumns(aoa, L.DAILY_FIELDS, { note: 2, actual: -1 });
  assert.equal(d.map.note, 2); assert.equal(d.map.actual, undefined);
  assert.deepEqual(d.missing, ['actual']);
});
test('측정 기록 — 「No」 열이 대 번호로 잘못 잡히지 않음', () => {
  const d = L.detectColumns([['No', '측정일', '작업자', '공정', '대 번호', '구분', '시작', '종료', '메모']], L.MEASURE_FIELDS);
  assert.equal(d.map.unit, 4); assert.equal(d.map.date, 1); assert.deepEqual(d.missing, []);
});

console.log('일일 실적 읽기·합치기');
test('parseDaily — 합계 행 빼기·분 단위 가용시간·알림', () => {
  const aoa = [['일자', '목표', '실적', '인원', '가용시간', '비고'],
    ['2026-09-07', 10, 8, 9, 450, ''], ['9/8', 10, '9대', 9, 7.5, '자재 늦음'], ['날짜 없음', 10, 8, 9, 7.5, ''], ['합계', 20, 17, null, null, null], [null, null, null]];
  const p = L.parseDaily(aoa);
  assert.equal(p.records.length, 2);
  assert.equal(p.records[0].availHr, 7.5);              // 450분 → 7.5시간
  assert.equal(p.records[1].date, '2026-09-08');        // 위 행의 연도
  assert.equal(p.records[1].actual, 9);
  assert.ok(p.warnings.some((w) => /분으로 보고/.test(w.msg)));
  assert.ok(p.warnings.some((w) => /일자를 읽지 못해/.test(w.msg)));
});
test('mergeDaily — 같은 날짜는 새 값, 날짜 순 정렬', () => {
  const a = L.mergeDaily([], [{ date: '2026-09-08', target: 10, actual: 7 }, { date: '2026-09-07', target: 10, actual: 8 }]);
  const b = L.mergeDaily(a.records, [{ date: '2026-09-08', target: 10, actual: 9 }]);
  assert.deepEqual(b.stat, { added: 0, updated: 1 });
  assert.deepEqual(b.records.map((r) => r.date + ':' + r.actual), ['2026-09-07:8', '2026-09-08:9']);
});

console.log('달성률 관리표');
const D = [
  { date: '2026-09-07', target: 10, actual: 9, workers: 9, availHr: 7.5 },
  { date: '2026-09-08', target: 10, actual: 8, workers: 9, availHr: 7.5 },
  { date: '2026-09-14', target: 10, actual: 10, workers: null, availHr: null, note: '정상' },
  { date: '2026-10-01', target: 0, actual: 0, workers: 9, availHr: 7.5 }
];
test('일별 — 달성률·90% 판정·택트타임', () => {
  const r = L.achieveRows(D, { unit: 'day', settings: { workers: 8, availHr: 8 } });
  assert.equal(r.length, 4);
  near(r[0].rate, 0.9); assert.equal(r[0].okDays, 1);       // 정확히 90% 는 달성
  near(r[1].rate, 0.8); assert.equal(r[1].okDays, 0);
  near(r[0].taktMin, 45);
  assert.equal(r[3].rate, null); assert.equal(r[3].ratedDays, 0); // 목표 0 은 달성률 없음
});
test('주별 — 합으로 계산(평균의 평균 아님), 빈 인원은 기본값', () => {
  const r = L.achieveRows(D, { unit: 'week', settings: { workers: 8, availHr: 8 } });
  assert.deepEqual(r.map((x) => x.key), ['2026-09-07', '2026-09-14', '2026-09-28']);
  near(r[0].rate, 17 / 20);
  near(r[0].perUnitManHr, (9 * 7.5 * 2) / 17);
  assert.equal(r[1].filled, true); near(r[1].perUnitManHr, 8 * 8 / 10);
});
test('월별·기간 거르기·합계', () => {
  const r = L.achieveRows(D, { unit: 'month' });
  assert.deepEqual(r.map((x) => x.key), ['2026-09', '2026-10']);
  const t = L.achieveTotal(D, { from: '2026-09-08', to: '2026-09-30' });
  assert.equal(t.days, 2); assert.equal(t.target, 20); assert.equal(t.actual, 18);
  const aoa = L.achieveToAoa(r, 'month');
  assert.equal(aoa[0][0], '월'); assert.equal(aoa.length, 3);
});

console.log('측정 기록');
const PROCS = [{ name: '절단', seq: 1, stdMin: 30, workers: 1 }, { name: '용접', seq: 2, stdMin: 100, workers: 2 }, { name: '검사', seq: 3, stdMin: 40, workers: 2 }];
const M = [
  // 1번 대
  { date: '2026-09-08', worker: '갑', process: '절단', unit: '1', kind: '작업', start: '08:00', end: '08:30' },
  { date: '2026-09-08', worker: '갑', process: '절단', unit: '1', kind: '자재 준비', start: '08:30', end: '08:35' },
  { date: '2026-09-08', worker: '을', process: '용접', unit: '1', kind: '작업', start: '08:35', end: '09:25' },
  { date: '2026-09-08', worker: '병', process: '용접', unit: '1', kind: '작업', start: '08:35', end: '09:35' },
  { date: '2026-09-08', worker: '정', process: '검사', unit: '1', kind: '대기', start: '08:00', end: '09:30', memo: '용접 완료품 대기' },
  { date: '2026-09-08', worker: '정', process: '검사', unit: '1', kind: '작업', start: '09:35', end: '10:15' },
  // 2번 대
  { date: '2026-09-08', worker: '갑', process: '절단', unit: '2', kind: '작업', start: '08:35', end: '09:05' },
  { date: '2026-09-08', worker: '을', process: '용접', unit: '2', kind: '작업', start: '09:35', end: '10:25' },
  { date: '2026-09-08', worker: '병', process: '용접', unit: '2', kind: '작업', start: '09:35', end: '10:25' },
  { date: '2026-09-08', worker: '병', process: '용접', unit: '2', kind: '재작업', start: '10:25', end: '10:35', memo: '비드 불량' },
  { date: '2026-09-08', worker: '정', process: '검사', unit: '2', kind: '작업', start: '10:35', end: '11:15' }
];
test('normKind — 구분 표기 흔들림', () => {
  assert.equal(L.normKind('자재'), '자재 준비'); assert.equal(L.normKind('대기시간'), '대기'); assert.equal(L.normKind('리워크'), '재작업');
  assert.equal(L.normKind('운반'), '이동'); assert.equal(L.normKind(' 작업 '), '작업'); assert.equal(L.normKind('점심'), null);
});
test('parseMeasure — 일자 이어 쓰기·모르는 구분 빼기·시각 못 읽음', () => {
  const aoa = [['측정일', '작업자', '공정', '대 번호', '구분', '시작', '종료', '메모'],
    ['2026-09-08', '갑', '절단', 1, '작업', '08:00', '08:30', null],
    [null, '갑', '절단', 1, '자재', 0.354166667, 0.357638889, '랙'],
    [null, '갑', '절단', 1, '점심', '12:00', '13:00', null],
    [null, '갑', '절단', 1, '작업', '아침', '08:30', null]];
  const p = L.parseMeasure(aoa);
  assert.equal(p.records.length, 2);
  assert.equal(p.records[1].date, '2026-09-08');
  assert.equal(p.records[1].kind, '자재 준비'); assert.equal(p.records[1].sec, 300);
  assert.equal(p.warnings.length, 2);
});
test('mergeMeasures — 같은 구간(일자·작업자·공정·대·시작)은 한 번만', () => {
  const a = L.mergeMeasures([], M);
  const b = L.mergeMeasures(a.records, M.slice(0, 3));
  assert.equal(b.records.length, M.length); assert.equal(b.stat.updated, 3);
});
test('processStats — 대당 공수·측정 인원·사이클타임·손실', () => {
  const st = L.processStats(L.mergeMeasures([], M).records, PROCS);
  const by = Object.fromEntries(st.rows.map((r) => [r.name, r]));
  assert.equal(by['절단'].units, 2); near(by['절단'].workMin, 30); near(by['절단'].ct, 30); near(by['절단'].lossMin, 2.5);
  assert.equal(by['용접'].units, 2); near(by['용접'].workMin, (50 + 60 + 50 + 50) / 2); near(by['용접'].measuredWorkers, 2); near(by['용접'].ct, 52.5);
  near(by['용접'].loss['재작업'], 600);
  near(by['검사'].workers, 1); near(by['검사'].ct, 40);   // 측정 인원 1명(설정 2명보다 측정 우선)
  near(by['검사'].stdCt, 20);
  near(by['검사'].ctAll, (80 + 90) / 2);
});
test('taktInfo — 일일 실적 기준, 없으면 설정 기본값', () => {
  near(L.taktInfo(D, { from: '2026-09-07', to: '2026-09-08' }).taktMin, 45);
  const t = L.taktInfo([], { settings: { availHr: 8, target: 12 } });
  near(t.taktMin, 40); assert.equal(t.source, '설정 기본값');
  assert.equal(L.taktInfo([], {}).taktMin, null);
});
test('lineAnalysis — 병목·택트 초과·하루 최대 대수·라인 밸런스', () => {
  const st = L.processStats(L.mergeMeasures([], M).records, PROCS);
  const la = L.lineAnalysis(st, { taktMin: 45, availMin: 450, target: 10 });
  assert.equal(la.bottleneck.name, '용접'); assert.equal(la.overCount, 1);
  near(la.capacity, 450 / 52.5); near(la.expectedRate, 450 / 52.5 / 10);
  near(la.balance, (30 + 52.5 + 40) / (3 * 52.5));
  const std = L.lineAnalysis(st, { taktMin: 45, availMin: 450, target: 10 }, { source: 'standard' });
  assert.equal(std.bottleneck.name, '용접'); near(std.maxCt, 50);
});
test('lossPareto — 큰 순·누적 100%·공정 거르기', () => {
  const ms = L.mergeMeasures([], M).records;
  const p = L.lossPareto(ms);
  assert.deepEqual(p.rows.map((r) => r.type).slice(0, 3), ['대기', '재작업', '자재 준비']);
  near(p.rows[p.rows.length - 1].cum, 1); near(p.totalMin, 90 + 10 + 5);
  assert.equal(L.lossPareto(ms, { process: '절단' }).totalMin, 5);
});
test('lossMatrix — 공정 순서대로, 작업자별 손실 비율', () => {
  const ms = L.mergeMeasures([], M).records;
  const byP = L.lossMatrix(ms, 'process', { processes: PROCS });
  assert.deepEqual(byP.map((r) => r.key), ['절단', '용접', '검사']);
  const byW = L.lossMatrix(ms, 'worker');
  const jung = byW.find((r) => r.key === '정');
  near(jung.lossShare, 90 / (90 + 80));
});

console.log('인원 배분');
test('simulate — 사이클타임·병목·예상 달성률, 인원 0 이면 그 공정이 멈춤', () => {
  const s = L.simulate([{ name: 'A', workMin: 30, workers: 1 }, { name: 'B', workMin: 110, workers: 2 }, { name: 'C', workMin: 75, workers: 3 }], 450, 10);
  assert.equal(s.bottleneck.name, 'B'); near(s.capacity, 450 / 55); assert.equal(s.capacityWhole, 8); assert.equal(s.totalWorkers, 6);
  near(s.taktMin, 45); assert.equal(s.rows[1].over, true);
  const z = L.simulate([{ name: 'A', workMin: 30, workers: 0 }], 450, 10);
  assert.equal(z.capacity, 0);
  const cut = L.simulate([{ name: 'B', workMin: 110, workers: 2, cutPct: 20 }], 450, 10);
  near(cut.rows[0].ct, 44);
});
test('suggestAllocation — 총인원 유지, 가장 긴 사이클타임 최소', () => {
  const rows = [{ workMin: 34 }, { workMin: 39 }, { workMin: 37 }, { workMin: 108 }, { workMin: 29 }, { workMin: 75 }];
  const w = L.suggestAllocation(rows, 9);
  assert.deepEqual(w, [1, 1, 1, 3, 1, 2]);
  assert.equal(w.reduce((a, b) => a + b, 0), 9);
  // 모든 다른 배분과 비교해 최댓값이 더 작은 배분이 없음(작은 문제로 전수 확인)
  const best = Math.max(...rows.map((r, i) => r.workMin / w[i]));
  let brute = Infinity;
  (function rec(i, left, cur) {
    if (i === rows.length) { if (left === 0) brute = Math.min(brute, Math.max(...rows.map((r, k) => r.workMin / cur[k]))); return; }
    for (let n = 1; n <= left - (rows.length - i - 1); n++) rec(i + 1, left - n, cur.concat([n]));
  })(0, 9, []);
  near(best, brute);
  assert.equal(L.suggestAllocation(rows, 5), null);
});

console.log('개선 전·후 · 단가');
test('comparePeriods — 대당 투입공수·원가·절감액·절감률·KPI', () => {
  const db = L.emptyDb();
  db.daily = L.mergeDaily([], [
    { date: '2026-09-01', target: 10, actual: 8, workers: 10, availHr: 8 },
    { date: '2026-10-01', target: 10, actual: 10, workers: 10, availHr: 8 }]).records;
  const c = L.comparePeriods(db, { from: '2026-09-01', to: '2026-09-30' }, { from: '2026-10-01', to: '2026-10-31' }, { wage: 20000, otherBefore: 50000, annualUnits: 100 });
  near(c.before.total.perUnitManHr, 10); near(c.after.total.perUnitManHr, 8);
  near(c.costBefore.total, 10 * 20000 + 50000); near(c.costAfter.total, 8 * 20000 + 50000); // 개선 후 기타 원가가 비면 개선 전과 같게
  near(c.saving, 40000); near(c.savingRate, 40000 / 250000); near(c.annual, 4000000);
  assert.deepEqual(c.kpi, { keepWorkers: true, rate90: true, costDown: true });
  const aoa = L.compareToAoa(c);
  assert.ok(aoa.some((r) => r[0] === '대당 절감액(원)' && r[2] === 40000));
});
test('comparePeriods — 임률이 없으면 원가 계산 안 함', () => {
  const db = L.emptyDb(); db.daily = [{ date: '2026-09-01', target: 10, actual: 8, workers: 10, availHr: 8 }];
  const c = L.comparePeriods(db, { from: '2026-09-01', to: '2026-09-01' }, { from: '2026-09-01', to: '2026-09-01' }, {});
  assert.equal(c.saving, null); assert.equal(c.kpi.costDown, null);
  assert.ok(!L.compareToAoa(c).some((r) => /절감/.test(r[0])));
});

console.log('스톱워치');
test('구간 바꾸기·다음 대·멈춤 — 앞 구간을 닫음', () => {
  const t0 = new Date(2026, 8, 8, 8, 0, 0).getTime();
  let r = L.swSwitch(null, '작업', t0, { worker: '갑', process: '용접', unit: '1' });
  assert.equal(r.closed, null); assert.equal(r.state.kind, '작업');
  r = L.swSwitch(r.state, '자재 준비', t0 + 600000);
  assert.deepEqual([r.closed.kind, r.closed.start, r.closed.end, r.closed.sec, r.closed.unit, r.closed.date], ['작업', '08:00:00', '08:10:00', 600, '1', '2026-09-08']);
  r = L.swNextUnit(r.state, t0 + 660000);
  assert.equal(r.closed.kind, '자재 준비'); assert.equal(r.state.unit, '2'); assert.equal(r.state.kind, '작업');
  const again = L.swSwitch(r.state, '대기', r.state.startMs + 300); // 0.3초 만에 다시 누름 → 기록 안 함
  assert.equal(again.closed, null);
  r = L.swStop(r.state, t0 + 720000);
  assert.equal(r.state, null); assert.equal(r.closed.sec, 60);
  assert.ok(L.cleanMeasure(r.closed));
});
test('nextUnit — 숫자 자릿수 유지', () => {
  assert.equal(L.nextUnit('09'), '10'); assert.equal(L.nextUnit('F-007'), 'F-008'); assert.equal(L.nextUnit(''), '1'); assert.equal(L.nextUnit('가'), '가-2');
});

console.log('표준작업서 · AI 프롬프트');
test('sopRows — 순서·사이클타임·측정 공수', () => {
  const st = L.processStats(L.mergeMeasures([], M).records, PROCS);
  const rows = L.sopRows([PROCS[2], PROCS[0], PROCS[1]], st);
  assert.deepEqual(rows.map((r) => r.name), ['절단', '용접', '검사']);
  near(rows[1].ct, 50); near(rows[1].measuredWorkMin, 105);
});
test('buildSopPrompt — 숫자·메모만, 지어내지 말라는 규칙', () => {
  const p = L.buildSopPrompt({ rows: L.sopRows([{ name: '용접', stdMin: 100, workers: 2, points: '대칭으로 용접', quality: '', safety: '마스크' }]), product: '프레임', taktMin: 45, target: 10 });
  assert.ok(p.includes('대칭으로 용접')); assert.ok(p.includes('(없음)')); assert.ok(p.includes('지어내지 말아줘')); assert.ok(p.includes('택트타임 45분'));
});
test('작업자 별칭 — 유지·되돌리기·세는 말은 그대로', () => {
  const al = L.assignAliases({}, ['홍길동', '김철수']);
  assert.deepEqual(al, { '김철수': '작업자1', '홍길동': '작업자2' });
  const al2 = L.assignAliases(al, ['박영희', '홍길동']);
  assert.equal(al2['홍길동'], '작업자2'); assert.equal(al2['박영희'], '작업자3');
  assert.equal(L.maskText('홍길동이 자재를 찾음', al2), '작업자2이 자재를 찾음');
  assert.equal(L.unmaskText('작업자2 는 대기, 작업자 3명, 작업자3명 투입', al2), '홍길동 는 대기, 작업자 3명, 작업자3명 투입');
});
test('buildAnalysisPrompt — 사실만, 이름 가림, 원가는 켤 때만', () => {
  const db = sampleDb();
  db.measures.forEach((m) => { if (m.worker === '작업자D') m.worker = '홍길동'; });
  db.measures[0].memo = '홍길동에게 자재 받음';
  const names = [...new Set(db.measures.map((m) => m.worker))];
  const al = L.assignAliases({}, names);
  const st = L.processStats(db.measures, db.processes, BEFORE);
  const la = L.lineAnalysis(st, L.taktInfo(db.daily, { ...BEFORE, settings: db.settings }));
  const cmp = L.comparePeriods(db, BEFORE, AFTER, db.settings);
  const memos = db.measures.filter((m) => m.memo).map((m) => m.memo);
  const ctx = { period: BEFORE, total: L.achieveTotal(db.daily, { ...BEFORE, settings: db.settings }), line: la, pareto: L.lossPareto(db.measures, BEFORE),
    byWorker: L.lossMatrix(db.measures, 'worker', BEFORE), memos, compare: cmp, aliases: al };
  const info = L.buildAnalysisPrompt(ctx);
  assert.equal(info.leaks.length, 0, '이름이 남음: ' + info.leaks.join(','));
  assert.ok(!info.prompt.includes('홍길동'));
  assert.ok(info.prompt.includes('본용접') && info.prompt.includes('— 병목'));
  assert.ok(info.prompt.includes('「추정」'));
  assert.ok(!/제작원가|절감액/.test(info.prompt));
  const withCost = L.buildAnalysisPrompt({ ...ctx, includeCost: true });
  assert.ok(withCost.prompt.includes('대당 절감액'));
  const noMask = L.buildAnalysisPrompt({ ...ctx, aliases: null });
  assert.ok(noMask.prompt.includes('홍길동'));
});

console.log('가상 샘플 — 줄거리가 화면에 보이는지');
test('샘플 파일 다시 읽기 — 알림 0, 합계 행 빠짐', () => {
  const b = Sample.build();
  const d = L.parseDaily(roundTrip(b.dailyFile.aoa));
  assert.equal(d.warnings.length, 0); assert.equal(d.records.length, Sample.DAILY.length); assert.equal(d.skipped, 1);
  b.measureFiles.forEach((f) => { const p = L.parseMeasure(roundTrip(f.aoa)); assert.equal(p.warnings.length, 0); assert.deepEqual(p.det.missing, []); });
});
test('개선 전 — 본용접이 병목(택트 초과), 대기가 가장 큰 손실, 달성률 90% 미만', () => {
  const db = sampleDb();
  const st = L.processStats(db.measures, db.processes, BEFORE);
  const la = L.lineAnalysis(st, L.taktInfo(db.daily, { ...BEFORE, settings: db.settings }));
  assert.equal(la.bottleneck.name, '본용접'); assert.equal(la.bottleneck.over, true); assert.equal(la.overCount, 1);
  assert.equal(L.lossPareto(db.measures, BEFORE).rows[0].type, '대기');
  assert.ok(L.lossPareto(db.measures, BEFORE).rows[0].share > 0.5);
  assert.ok(L.achieveTotal(db.daily, { ...BEFORE, settings: db.settings }).rate < 0.9);
});
test('개선 후 — 같은 인원, 택트 초과 공정 없음, 달성률 90% 이상, 단가 절감', () => {
  const db = sampleDb();
  const st = L.processStats(db.measures, db.processes, AFTER);
  const la = L.lineAnalysis(st, L.taktInfo(db.daily, { ...AFTER, settings: db.settings }));
  assert.equal(la.overCount, 0); assert.equal(la.bottleneck.name, '홀 가공');
  near(st.rows.find((r) => r.name === '본용접').measuredWorkers, 3);
  const c = L.comparePeriods(db, BEFORE, AFTER, db.settings);
  assert.deepEqual(c.kpi, { keepWorkers: true, rate90: true, costDown: true });
  assert.ok(c.after.lossMin < c.before.lossMin);
  assert.ok(c.savingRate > 0 && c.savingRate < 0.5);
});
test('개선 전 측정으로 자동 배분 → 샘플의 실제 개선안(본용접 3명·사상 2명)과 같음', () => {
  const db = sampleDb();
  const rows = L.processStats(db.measures, db.processes, BEFORE).rows.map((r) => ({ name: r.name, workMin: r.workMin }));
  const w = L.suggestAllocation(rows, 9);
  assert.deepEqual(Object.fromEntries(rows.map((r, i) => [r.name, w[i]])), { '자재 절단': 1, '홀 가공': 1, '가접(지그 조립)': 1, '본용접': 3, '변형 교정': 1, '사상·검사': 2 });
  assert.ok(L.simulate(rows.map((r, i) => ({ ...r, workers: w[i] })), 450, 10).expectedRate >= 0.9);
});
test('샘플에 회사명·실명 없음 — 작업자는 작업자A~I', () => {
  const db = sampleDb();
  const ws = [...new Set(db.measures.map((m) => m.worker))].sort();
  assert.deepEqual(ws, ['작업자A', '작업자B', '작업자C', '작업자D', '작업자E', '작업자F', '작업자G', '작업자H', '작업자I']);
  assert.ok(/가상/.test(db.settings.product));
});

console.log('저장 형식 · AI 연결');
test('restoreDb — 깨진 값 걸러내기·기본값', () => {
  const db = L.restoreDb({ daily: [{ date: '2026-09-08', target: '10', actual: 8 }, { date: 'x' }], processes: [{ name: '용접', workers: '2' }], measures: [{ date: '2026-09-08', process: '용접', kind: '대기', start: '08:00', end: '08:10' }, { kind: '?' }],
    settings: { goal: 5, availHr: 'abc' }, maskWorkers: false, running: { startMs: 5, process: '용접', kind: '작업' }, compare: { beforeFrom: '2026/9/1' } });
  assert.equal(db.daily.length, 1); assert.equal(db.daily[0].target, 10);
  assert.equal(db.processes[0].workers, 2); assert.equal(db.measures.length, 1); assert.equal(db.measures[0].sec, 600);
  assert.equal(db.settings.goal, 0.9); assert.equal(db.settings.availHr, null);
  assert.equal(db.maskWorkers, false); assert.equal(db.running.process, '용접'); assert.equal(db.compare.beforeFrom, '2026-09-01');
  const e = L.restoreDb(null); assert.equal(e.daily.length, 0); assert.equal(e.maskWorkers, true); assert.equal(e.includeCost, false);
});
test('AI 연결 — 키가 없으면 인증 머리글 없음, 저장 칸 이름', () => {
  assert.equal(E.STORE_KEY, 'data10-08.ai');
  const req = E.buildChatRequest({ baseUrl: 'https://llm.example.com/v1/', model: 'm' }, E.promptMessages('안녕'));
  assert.equal(req.url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(req.init.headers.Authorization, undefined);
  assert.equal(E.toStored({ baseUrl: 'https://a/v1', model: 'm', apiKey: 'k', remember: false }).apiKey, '');
});

const { versions } = await import('../scripts/bump-version.mjs');
test('판 맞추기 — index.html ?v= · logic.js · app.js 가 같은 판 (scripts/bump-version.mjs)', () => {
  const v = versions();
  assert.equal(v.logic, L.VERSION, 'logic.js VERSION'); assert.equal(v.app, L.VERSION, 'app.js APP_VERSION');
  assert.ok(v.html.length >= 9 && v.html.every(x => x === L.VERSION), 'index.html 의 모든 js·css 에 ?v=' + L.VERSION + ' — ' + JSON.stringify(v.html));
});

console.log(`\n${passed}개 통과` + (process.exitCode ? ' — 실패가 있습니다' : ''));
