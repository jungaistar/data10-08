/* 프레임 제작 생산성 개선 — 순수 로직 (화면·저장소와 무관)
   브라우저에서는 window.FrameLogic, node 에서는 require('./logic.js') 로 씁니다.
   기준 문서: docs/01_프로젝트_기획서.md (3장 데이터, 5장 기능, 8장 1단계)

   흐름: 일일 실적(입력·엑셀) → achieveRows(달성률 관리표 — 일·주·월, 90% 선)
        공정 마스터 + 현장 측정 기록(작업·손실 구간) → processStats(공정별 대당 공수·손실)
        → lineAnalysis(사이클타임 vs 택트타임, 병목, 라인 밸런스) · lossPareto(손실 파레토)
        → simulate · suggestAllocation(인원 배분) · comparePeriods(개선 전·후 + 단가 절감)
        → sopRows(표준작업서) · buildAnalysisPrompt · buildSopPrompt(AI 반자동, 사실만)

   용어(이 도구 안에서의 뜻 — 기획서 10장에서 회사 기준을 확인합니다)
   · 가용시간(HR)  : 하루 실작업 가능시간(휴식·회의를 뺀 시간). 라인 기준, 사람마다 같다고 봅니다.
   · 택트타임(분/대): 가용시간 × 60 ÷ 목표 대수 — 목표를 맞추려면 한 대를 이 시간 안에 내보내야 합니다.
   · 대당 공수(인·분): 한 대를 만드는 데 그 공정에서 사람들이 쓴 순작업 시간의 합.
   · 사이클타임(분/대): 대당 공수 ÷ 그 공정 인원 — 작업을 인원끼리 나눌 수 있다고 보는 단순 모델.
   · 병목공정: 사이클타임이 가장 긴 공정. 택트타임보다 길면 목표 대수를 낼 수 없습니다.
   · 대당 투입공수(인·시): 투입 인원 × 가용시간의 합 ÷ 실제 생산 대수 — 손실까지 들어간 실제 값. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrameLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /* 판(版) — index.html 의 ?v= · app.js 의 APP_VERSION 과 같아야 합니다(scripts/bump-version.mjs 로 함께 올림).
     브라우저가 옛 logic.js 와 새 app.js 를 섞어 쓰면 app.js 가 이 값을 보고 계산을 멈춥니다. */
  var VERSION = '2026-10-27.1';

  var SCHEMA_VERSION = 1;
  var GOAL = 0.9; // 달성률 목표 90% (제출 원문)
  var LOSS_TYPES = ['자재 준비', '이동', '대기', '재작업', '기타'];
  var KINDS = ['작업'].concat(LOSS_TYPES);

  /* ── 1. 기본 도구 ───────────────────────────────────────────── */
  function norm(s) { return String(s == null ? '' : s).replace(/[\s()（）\[\]·.:_/\\-]/g, '').toLowerCase(); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function round(n, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round(n * p) / p; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function cmp(a, b) { a = a == null ? '' : String(a); b = b == null ? '' : String(b); return a < b ? -1 : a > b ? 1 : 0; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function sum(a, f) { return a.reduce(function (s, x) { var v = f ? f(x) : x; return s + (v == null || !isFinite(v) ? 0 : v); }, 0); }
  function fmtN(n, d) { return n == null || !isFinite(n) ? '-' : Number(round(n, d == null ? 0 : d)).toLocaleString('ko-KR'); }
  function fmtPct(v, d) { return v == null || !isFinite(v) ? '-' : round(v * 100, d == null ? 1 : d) + '%'; }
  function fmtWon(n) { return n == null || !isFinite(n) ? '-' : Math.round(n).toLocaleString('ko-KR') + '원'; }

  /* 빈칸·공백은 null, 숫자로 못 읽으면 NaN(경고용). 「10대」「7.5h」「3명」처럼 뒤에 단위가 붙은 값도 읽습니다 */
  function toNum(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v === 'boolean') return NaN;
    var s = String(v).trim();
    if (!s || s === '-') return null;
    if (s.charAt(0) === '=') return null; // 계산값이 저장되지 않은 수식
    s = s.replace(/,/g, '').replace(/\s*(대|명|시간|hr|h|분|min|원|%)$/i, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }

  /* ── 2. 날짜·시각 ───────────────────────────────────────────── */
  function isoFromUTC(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function isoOk(y, m, d) {
    if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    var t = Date.UTC(y, m - 1, d), x = new Date(t);
    return x.getUTCMonth() === m - 1 ? isoFromUTC(t) : '';
  }
  /* 엑셀 날짜(일련번호 · Date · 글자) → 'YYYY-MM-DD'. 못 읽으면 ''.
     엑셀은 cellDates 없이(raw 숫자) 읽으므로 날짜는 보통 일련번호로 옵니다. */
  function toISO(v, defaultYear) {
    if (v == null || v === '') return '';
    if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
      if (isNaN(v.getTime())) return '';
      return isoFromUTC(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    }
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) return isoFromUTC(Math.round((Math.floor(v) - 25569) * 86400000));
      return '';
    }
    var s = String(v).trim().replace(/\s*\([^)]*\)\s*$/, ''); // 「2026-09-08(화)」
    var m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/.exec(s);
    if (m) return isoOk(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/.exec(s);
    if (m && defaultYear) return isoOk(defaultYear, +m[1], +m[2]);
    m = /^(\d{2})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
    if (m) return isoOk(2000 + +m[1], +m[2], +m[3]);
    if (/^\d{5}(\.\d+)?$/.test(s)) return toISO(Number(s));
    return '';
  }
  function isoToUTC(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function addDays(iso, n) { return isoFromUTC(isoToUTC(iso) + n * 86400000); }
  function dow(iso) { return new Date(isoToUTC(iso)).getUTCDay(); }
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function weekStart(iso) { var d = dow(iso); return addDays(iso, d === 0 ? -6 : 1 - d); } // 월요일 시작
  function weekEnd(ws) { return addDays(ws, 6); }
  function monthKey(iso) { return iso.slice(0, 7); }
  function dayLabel(iso) { return iso.slice(5).replace('-', '/') + '(' + DOW[dow(iso)] + ')'; }
  function weekLabel(ws) { return ws.slice(5).replace('-', '/') + ' 주 (' + ws.slice(5).replace('-', '/') + '~' + weekEnd(ws).slice(5).replace('-', '/') + ')'; }
  function monthLabel(mk) { return mk.slice(0, 4) + '년 ' + Number(mk.slice(5)) + '월'; }

  /* 시각 → 하루 안의 초. 'HH:MM' · 'HH:MM:SS' · '오후 1:20' · 엑셀 시각(0~1 소수, 날짜+시각이면 소수 부분) · Date. 못 읽으면 null */
  function toSec(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
      if (isNaN(v.getTime())) return null;
      return v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
    }
    if (typeof v === 'number') {
      if (!isFinite(v) || v < 0) return null;
      var f = v - Math.floor(v);
      if (v >= 1 && f === 0) return null;
      return Math.round(f * 86400) % 86400;
    }
    var s = String(v).trim(), pm = false, am = false;
    if (/^(오후|pm)\s*/i.test(s)) { pm = true; s = s.replace(/^(오후|pm)\s*/i, ''); }
    else if (/^(오전|am)\s*/i.test(s)) { am = true; s = s.replace(/^(오전|am)\s*/i, ''); }
    if (/\s*(pm|오후)$/i.test(s)) { pm = true; s = s.replace(/\s*(pm|오후)$/i, ''); }
    else if (/\s*(am|오전)$/i.test(s)) { am = true; s = s.replace(/\s*(am|오전)$/i, ''); }
    var m = /^(\d{1,2})\s*[:시]\s*(\d{1,2})(?:\s*[:분]\s*(\d{1,2})\s*초?)?\s*분?$/.exec(s);
    if (!m) return null;
    var h = +m[1], mi = +m[2], se = m[3] ? +m[3] : 0;
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h > 23 || mi > 59 || se > 59) return null;
    return h * 3600 + mi * 60 + se;
  }
  function secToHms(sec) { sec = Math.round(sec) % 86400; return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec / 60) % 60) + ':' + pad(sec % 60); }
  /* 구간 길이(초) — 종료가 시작보다 이르면 자정을 넘긴 것으로 봅니다 */
  function durSec(start, end) {
    var a = toSec(start), b = toSec(end);
    if (a == null || b == null) return null;
    return secDiff(a, b);
  }
  function secDiff(a, b) { return b >= a ? b - a : b + 86400 - a; } // 둘 다 하루 안의 초
  function fmtDur(sec) {
    if (sec == null) return '-';
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s);
  }

  /* ── 3. 엑셀 열 찾기 ─────────────────────────────────────────
     머리행 글자를 공백·괄호·가운데점을 빼고 소문자로 맞춘 뒤 별칭과 비교합니다.
     첫 15행 가운데 필수 칸이 가장 많이 맞는 행을 머리행으로 봅니다(제목 행이 위에 있어도 됨). */
  var DAILY_FIELDS = [
    { id: 'date', label: '일자', req: true, aliases: ['일자', '날짜', '생산일', '생산일자', '작업일', '작업일자', '실적일자', 'date'] },
    { id: 'target', label: '목표 대수', req: true, aliases: ['목표', '목표대수', '목표실적대수', '목표실적', '목표수량', '목표대', '계획', '계획대수', '계획수량'] },
    { id: 'actual', label: '실제 생산 대수', req: true, aliases: ['실적', '실제', '실적대수', '실제대수', '실제생산대수', '생산대수', '생산수량', '실적대', '실적수량', '생산'] },
    { id: 'workers', label: '투입 인원(명)', req: false, aliases: ['인원', '투입인원', '작업인원', '작업인원명', '인원명', '투입인원명', '현재인원'] },
    { id: 'availHr', label: '가용시간(HR)', req: false, aliases: ['가용시간', '일일가용시간', '가용시간hr', '가용시간시간', '실작업시간', '실작업가능시간', '가용hr'] },
    { id: 'note', label: '비고·지연 사유', req: false, aliases: ['비고', '지연사유', '메모', '특이사항', '사유'] }
  ];
  var MEASURE_FIELDS = [
    { id: 'date', label: '측정일', req: true, aliases: ['측정일', '일자', '날짜', '측정일자', '작업일', '작업일자'] },
    { id: 'worker', label: '작업자', req: false, aliases: ['작업자', '작업자명', '이름', '담당자', '담당'] },
    { id: 'process', label: '공정', req: true, aliases: ['공정', '공정명', '작업공정', '공정이름'] },
    { id: 'unit', label: '대 번호', req: false, aliases: ['대번호', '제품번호', '프레임번호', '호대', '대', '제번', '대no'] },
    { id: 'kind', label: '구분(작업·손실 유형)', req: true, aliases: ['구분', '작업구분', '손실유형', '유형', '작업손실', '내용구분'] },
    { id: 'start', label: '시작', req: true, aliases: ['시작', '시작시각', '시작시간', 'start'] },
    { id: 'end', label: '종료', req: true, aliases: ['종료', '종료시각', '종료시간', '끝', 'end'] },
    { id: 'memo', label: '메모', req: false, aliases: ['메모', '비고', '사유', '내용', '특이사항'] }
  ];
  function fieldsOf(kind) { return kind === 'measure' ? MEASURE_FIELDS : DAILY_FIELDS; }
  function colName(i) { var s = ''; i++; while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

  function matchRow(row, fields) {
    var map = {}, used = {}, hdr = (row || []).map(norm);
    // 1차: 별칭과 똑같은 머리
    fields.forEach(function (f) {
      for (var c = 0; c < hdr.length; c++) {
        if (used[c] || !hdr[c]) continue;
        if (f.aliases.indexOf(hdr[c]) >= 0) { map[f.id] = c; used[c] = 1; return; }
      }
    });
    // 2차: 별칭으로 시작하는 머리(「목표 대수(대)」「가용시간(분)」 등)
    fields.forEach(function (f) {
      if (map[f.id] != null) return;
      for (var c = 0; c < hdr.length; c++) {
        if (used[c] || !hdr[c]) continue;
        if (f.aliases.some(function (a) { return a.length >= 2 && hdr[c].indexOf(a) === 0; })) { map[f.id] = c; used[c] = 1; return; }
      }
    });
    return map;
  }
  function detectColumns(aoa, fields, overrides) {
    var best = { row: -1, req: -1, all: -1, map: {} };
    for (var r = 0; r < Math.min(15, aoa.length); r++) {
      var m = matchRow(aoa[r], fields);
      var req = fields.filter(function (f) { return f.req && m[f.id] != null; }).length;
      var all = Object.keys(m).length;
      if (req > best.req || (req === best.req && all > best.all)) best = { row: r, req: req, all: all, map: m };
    }
    var map = best.map, warnings = [];
    if (best.all < 2) { map = {}; best.row = 0; }
    Object.keys(overrides || {}).forEach(function (k) {
      var v = overrides[k];
      Object.keys(map).forEach(function (o) { if (o !== k && map[o] === v && v >= 0) delete map[o]; }); // 한 열은 한 칸에만
      if (v == null || v < 0) delete map[k]; else map[k] = v;
    });
    var missing = fields.filter(function (f) { return f.req && map[f.id] == null; }).map(function (f) { return f.id; });
    var headers = (aoa[best.row] || []).map(function (x) { return str(x); });
    return { headerRow: best.row, map: map, missing: missing, headers: headers, warnings: warnings };
  }
  function headerSignature(det) { return det && det.headers ? det.headers.map(norm).join('|') : ''; }
  /* 실적·측정 시트 고르기 — 필수 칸이 가장 많이 맞는 시트 */
  function pickSheet(sheets, kind) {
    var f = fieldsOf(kind), best = null, score = -1;
    (sheets || []).forEach(function (s) {
      var d = detectColumns(s.aoa || [], f);
      var sc = f.filter(function (x) { return x.req; }).length - d.missing.length;
      if (sc > score) { score = sc; best = s; }
    });
    return best;
  }
  function guessYear(aoa, det) {
    var c = det.map.date;
    for (var r = det.headerRow + 1; r < aoa.length && c != null; r++) {
      var v = (aoa[r] || [])[c];
      var iso = toISO(v);
      if (iso) return +iso.slice(0, 4);
    }
    return new Date().getFullYear();
  }
  function isBlankRow(row) { return !row || row.every(function (v) { return v == null || str(v) === ''; }); }

  /* ── 4. 일일 실적 읽기 ───────────────────────────────────────── */
  function parseDaily(aoa, opts) {
    opts = opts || {};
    var det = detectColumns(aoa, DAILY_FIELDS, opts.overrides);
    var out = { det: det, records: [], warnings: [], skipped: 0 };
    if (det.missing.length) return out;
    var year = guessYear(aoa, det), M = det.map;
    function cell(row, id) { return M[id] == null ? null : row[M[id]]; }
    for (var r = det.headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [];
      if (isBlankRow(row)) continue;
      var rawDate = cell(row, 'date');
      if (/합계|소계|평균|total/i.test(str(rawDate))) { out.skipped++; continue; }
      var date = toISO(rawDate, year);
      var rowNo = r + 1;
      if (!date) { out.warnings.push({ row: rowNo, msg: '일자를 읽지 못해 뺐습니다(' + str(rawDate) + ')' }); out.skipped++; continue; }
      var rec = { date: date, target: toNum(cell(row, 'target')), actual: toNum(cell(row, 'actual')), workers: toNum(cell(row, 'workers')), availHr: toNum(cell(row, 'availHr')), note: str(cell(row, 'note')) };
      ['target', 'actual', 'workers', 'availHr'].forEach(function (k) {
        if (rec[k] !== rec[k]) { out.warnings.push({ row: rowNo, msg: fieldLabel('daily', k) + ' 값을 숫자로 읽지 못했습니다' }); rec[k] = null; }
        else if (rec[k] != null && rec[k] < 0) { out.warnings.push({ row: rowNo, msg: fieldLabel('daily', k) + ' 이(가) 음수입니다' }); rec[k] = null; }
      });
      if (rec.availHr != null && rec.availHr > 24) { out.warnings.push({ row: rowNo, msg: '가용시간 ' + rec.availHr + ' 은 분으로 보고 시간으로 바꿨습니다(÷60)' }); rec.availHr = round(rec.availHr / 60, 2); }
      if (rec.target == null && rec.actual == null) { out.warnings.push({ row: rowNo, msg: '목표·실적이 모두 비어 뺐습니다' }); out.skipped++; continue; }
      if (rec.target != null && rec.actual != null && rec.target > 0 && rec.actual > rec.target * 2) out.warnings.push({ row: rowNo, msg: '실적(' + rec.actual + ')이 목표(' + rec.target + ')의 2배가 넘습니다 — 단위를 확인해 주세요' });
      out.records.push(rec);
    }
    var seen = {};
    out.records.forEach(function (x) { if (seen[x.date]) out.warnings.push({ row: 0, msg: x.date + ' 가 두 번 나옵니다 — 아래 행 값이 남습니다' }); seen[x.date] = 1; });
    return out;
  }
  function fieldLabel(kind, id) { var f = fieldsOf(kind).filter(function (x) { return x.id === id; })[0]; return f ? f.label : id; }
  function cleanDaily(r) {
    if (!r || !toISO(r.date)) return null;
    function n(v) { var x = toNum(v); return x == null || x !== x || x < 0 ? null : x; }
    return { date: toISO(r.date), target: n(r.target), actual: n(r.actual), workers: n(r.workers), availHr: n(r.availHr), note: str(r.note) };
  }
  /* 같은 일자는 새 값으로 바꿉니다 */
  function mergeDaily(existing, incoming) {
    var by = {}, stat = { added: 0, updated: 0 };
    (existing || []).forEach(function (r) { by[r.date] = r; });
    (incoming || []).forEach(function (r) {
      var c = cleanDaily(r); if (!c) return;
      if (by[c.date]) stat.updated++; else stat.added++;
      by[c.date] = c;
    });
    return { records: Object.keys(by).sort().map(function (k) { return by[k]; }), stat: stat };
  }

  /* ── 5. 달성률 관리표 (일·주·월) ─────────────────────────────── */
  function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }
  function rate(actual, target) { return target > 0 && actual != null ? actual / target : null; }
  /* 가용시간·인원이 빈 날은 기본값(settings)을 씁니다 — 표에 「기본값」 표시 */
  function withDefaults(r, settings) {
    var s = settings || {};
    return {
      date: r.date, target: r.target, actual: r.actual, note: r.note,
      workers: r.workers != null ? r.workers : (s.workers != null ? s.workers : null),
      availHr: r.availHr != null ? r.availHr : (s.availHr != null ? s.availHr : null),
      filled: r.workers == null || r.availHr == null
    };
  }
  function achieveRows(daily, opts) {
    opts = opts || {};
    var unit = opts.unit || 'day', goal = opts.goal != null ? opts.goal : GOAL;
    var list = (daily || []).filter(function (r) { return inRange(r.date, opts.from, opts.to); }).map(function (r) { return withDefaults(r, opts.settings); });
    var groups = {}, order = [];
    list.forEach(function (r) {
      var k = unit === 'week' ? weekStart(r.date) : unit === 'month' ? monthKey(r.date) : r.date;
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(r);
    });
    order.sort();
    return order.map(function (k) { return aggDays(groups[k], goal, k, unit); });
  }
  function aggDays(days, goal, key, unit) {
    goal = goal != null ? goal : GOAL;
    var t = sum(days, function (r) { return r.target; }), a = sum(days, function (r) { return r.actual; });
    var manHr = sum(days, function (r) { return r.workers != null && r.availHr != null ? r.workers * r.availHr : null; });
    var manDays = days.filter(function (r) { return r.workers != null && r.availHr != null; });
    var aOfMan = sum(manDays, function (r) { return r.actual; });
    var availMin = sum(days, function (r) { return r.availHr != null ? r.availHr * 60 : null; });
    var tOfAvail = sum(days.filter(function (r) { return r.availHr != null; }), function (r) { return r.target; });
    var rated = days.filter(function (r) { return r.target > 0 && r.actual != null; });
    return {
      key: key || '', label: key ? (unit === 'week' ? weekLabel(key) : unit === 'month' ? monthLabel(key) : dayLabel(key)) : '',
      days: days.length, target: t, actual: a, gap: a - t, rate: rate(a, t),
      okDays: rated.filter(function (r) { return r.actual / r.target >= goal - 1e-9; }).length, ratedDays: rated.length,
      workers: manDays.length ? round(sum(manDays, function (r) { return r.workers; }) / manDays.length, 1) : null,
      availHr: days.filter(function (r) { return r.availHr != null; }).length ? round(availMin / 60 / days.filter(function (r) { return r.availHr != null; }).length, 2) : null,
      manHr: round(manHr, 2),
      perUnitManHr: aOfMan > 0 ? manHr / aOfMan : null,      // 대당 투입공수(인·시)
      taktMin: tOfAvail > 0 ? availMin / tOfAvail : null,       // 평균 택트타임(분/대)
      filled: days.some(function (r) { return r.filled; }),
      notes: days.filter(function (r) { return r.note; }).map(function (r) { return r.date.slice(5) + ' ' + r.note; })
    };
  }
  function achieveTotal(daily, opts) {
    opts = opts || {};
    var list = (daily || []).filter(function (r) { return inRange(r.date, opts.from, opts.to); }).map(function (r) { return withDefaults(r, opts.settings); });
    var a = aggDays(list, opts.goal);
    a.from = list.length ? list[0].date : ''; a.to = list.length ? list[list.length - 1].date : '';
    return a;
  }
  function achieveToAoa(rows, unit, goal) {
    var head = [unit === 'week' ? '주' : unit === 'month' ? '월' : '일자', '일수', '목표 대수', '실제 대수', '차이(실제−목표)', '달성률', '90% 이상 일수', '평균 인원', '평균 가용시간(HR)', '투입공수(인·시)', '대당 투입공수(인·시)', '택트타임(분/대)', '비고'];
    var out = [head];
    rows.forEach(function (r) {
      out.push([r.key, r.days, r.target, r.actual, r.gap, r.rate == null ? '' : round(r.rate * 100, 1) + '%', r.okDays + '/' + r.ratedDays, r.workers == null ? '' : r.workers,
        r.availHr == null ? '' : r.availHr, r.manHr, r.perUnitManHr == null ? '' : round(r.perUnitManHr, 2), r.taktMin == null ? '' : round(r.taktMin, 1), r.notes.join(' / ')]);
    });
    return out;
  }

  /* ── 6. 공정 마스터 ─────────────────────────────────────────── */
  function cleanProcess(p, i) {
    p = p || {};
    function n(v) { var x = toNum(v); return x == null || x !== x || x < 0 ? null : x; }
    var w = n(p.workers);
    return {
      id: str(p.id) || 'p' + (i + 1), seq: n(p.seq) != null ? n(p.seq) : i + 1, name: str(p.name) || '공정' + (i + 1),
      stdMin: n(p.stdMin), workers: w == null ? 1 : Math.max(0, Math.round(w)),
      points: str(p.points), quality: str(p.quality), safety: str(p.safety)
    };
  }
  function sortProcesses(list) {
    return (list || []).map(cleanProcess).sort(function (a, b) { return a.seq - b.seq || cmp(a.name, b.name); });
  }
  function processByName(list, name) {
    var n = norm(name);
    return (list || []).filter(function (p) { return norm(p.name) === n; })[0] || null;
  }

  /* ── 7. 현장 측정 기록 ───────────────────────────────────────
     한 행 = 한 작업자가 한 대(대 번호)의 한 공정에서 보낸 한 구간(작업 또는 손실). */
  var KIND_ALIASES = {
    '작업': ['작업', '순작업', '정상작업', '본작업', 'work'],
    '자재 준비': ['자재준비', '자재', '준비', '자재찾기', '자재대기준비', '자재운반준비'],
    '이동': ['이동', '운반', '보행'],
    '대기': ['대기', '기다림', '대기시간', '설비대기', '자재대기', '작업대기'],
    '재작업': ['재작업', '수정', '리워크', 'rework', '보수'],
    '기타': ['기타', '그외', '그밖']
  };
  function normKind(v) {
    var s = norm(v);
    if (!s) return null;
    var hit = null;
    KINDS.forEach(function (k) { if (!hit && KIND_ALIASES[k].indexOf(s) >= 0) hit = k; });
    if (hit) return hit;
    KINDS.forEach(function (k) { if (!hit && KIND_ALIASES[k].some(function (a) { return a.length >= 2 && s.indexOf(a) === 0; })) hit = k; });
    return hit;
  }
  function isLoss(kind) { return LOSS_TYPES.indexOf(kind) >= 0; }
  function measureKey(m) { return [m.date, m.worker, norm(m.process), m.unit, m.start].join('|'); }
  function cleanMeasure(m) {
    if (!m) return null;
    var date = toISO(m.date), kind = normKind(m.kind), s = toSec(m.start), e = toSec(m.end);
    if (!date || !kind || s == null || e == null || !str(m.process)) return null;
    return { date: date, worker: str(m.worker), process: str(m.process), unit: str(m.unit), kind: kind, start: secToHms(s), end: secToHms(e), sec: secDiff(s, e), memo: str(m.memo) };
  }
  function parseMeasure(aoa, opts) {
    opts = opts || {};
    var det = detectColumns(aoa, MEASURE_FIELDS, opts.overrides);
    var out = { det: det, records: [], warnings: [], skipped: 0 };
    if (det.missing.length) return out;
    var year = guessYear(aoa, det), M = det.map, lastDate = '';
    function cell(row, id) { return M[id] == null ? null : row[M[id]]; }
    for (var r = det.headerRow + 1; r < aoa.length; r++) {
      var row = aoa[r] || [], rowNo = r + 1;
      if (isBlankRow(row)) continue;
      var date = toISO(cell(row, 'date'), year) || lastDate; // 측정표는 일자를 첫 행에만 쓰는 일이 많아 위 행 일자를 이어 씁니다
      if (!date) { out.warnings.push({ row: rowNo, msg: '측정일을 읽지 못해 뺐습니다' }); out.skipped++; continue; }
      lastDate = date;
      var kindRaw = cell(row, 'kind'), kind = normKind(kindRaw);
      if (!kind) { out.warnings.push({ row: rowNo, msg: '구분 「' + str(kindRaw) + '」 을(를) 알 수 없어 뺐습니다(작업·자재 준비·이동·대기·재작업·기타)' }); out.skipped++; continue; }
      var s = toSec(cell(row, 'start')), e = toSec(cell(row, 'end'));
      if (s == null || e == null) { out.warnings.push({ row: rowNo, msg: '시작·종료 시각을 읽지 못해 뺐습니다' }); out.skipped++; continue; }
      var proc = str(cell(row, 'process'));
      if (!proc) { out.warnings.push({ row: rowNo, msg: '공정이 비어 뺐습니다' }); out.skipped++; continue; }
      var d = secDiff(s, e);
      if (d > 4 * 3600) out.warnings.push({ row: rowNo, msg: '한 구간이 4시간을 넘습니다(' + fmtDur(d) + ') — 시각을 확인해 주세요' });
      if (d === 0) out.warnings.push({ row: rowNo, msg: '시작과 종료가 같습니다(0초)' });
      out.records.push({ date: date, worker: str(cell(row, 'worker')), process: proc, unit: str(cell(row, 'unit')), kind: kind, start: secToHms(s), end: secToHms(e), sec: d, memo: str(cell(row, 'memo')) });
    }
    return out;
  }
  function mergeMeasures(existing, incoming) {
    var by = {}, order = [], stat = { added: 0, updated: 0 };
    function put(m, count) {
      var c = cleanMeasure(m); if (!c) return;
      var k = measureKey(c);
      if (by[k]) { if (count) stat.updated++; } else { order.push(k); if (count) stat.added++; }
      by[k] = c;
    }
    (existing || []).forEach(function (m) { put(m, false); });
    (incoming || []).forEach(function (m) { put(m, true); });
    return { records: sortMeasures(order.map(function (k) { return by[k]; })), stat: stat };
  }
  function sortMeasures(list) {
    return list.slice().sort(function (a, b) { return cmp(a.date, b.date) || cmp(a.worker, b.worker) || cmp(a.start, b.start); });
  }
  function measureDays(measures) { return uniq((measures || []).map(function (m) { return m.date; })).sort(); }

  /* 공정별 측정 통계 — 기간 안의 기록으로 대당 순작업 공수·손실을 냅니다.
     대 수 = (일자 + 대 번호)가 다른 「작업」 구간의 수. 대 번호가 빈 작업 구간은 1건을 1대로 셉니다(경고).
     측정 인원 = 그 공정에서 하루에 기록된 작업자 수의 평균(측정이 없으면 공정 마스터 인원). */
  function processStats(measures, processes, opts) {
    opts = opts || {};
    var procs = sortProcesses(processes);
    var list = (measures || []).filter(function (m) { return inRange(m.date, opts.from, opts.to); });
    var names = procs.map(function (p) { return p.name; });
    list.forEach(function (m) { if (!processByName(procs, m.process) && names.indexOf(m.process) < 0) names.push(m.process); });
    var noUnit = 0;
    var rows = names.map(function (name) {
      var p = processByName(procs, name);
      var mine = list.filter(function (m) { return norm(m.process) === norm(name); });
      var units = {}, perDayWorkers = {};
      mine.forEach(function (m, i) {
        if (m.kind === '작업') {
          var u = m.unit ? m.date + '|' + m.unit : m.date + '|#' + m.worker + '|' + m.start;
          if (!m.unit) noUnit++;
          units[u] = 1;
        }
        if (m.worker) (perDayWorkers[m.date] = perDayWorkers[m.date] || {})[m.worker] = 1;
      });
      var n = Object.keys(units).length;
      var workSec = sum(mine.filter(function (m) { return m.kind === '작업'; }), function (m) { return m.sec; });
      var loss = {};
      LOSS_TYPES.forEach(function (t) { loss[t] = sum(mine.filter(function (m) { return m.kind === t; }), function (m) { return m.sec; }); });
      var lossSec = sum(LOSS_TYPES, function (t) { return loss[t]; });
      var dayKeys = Object.keys(perDayWorkers);
      var mWorkers = dayKeys.length ? sum(dayKeys, function (d) { return Object.keys(perDayWorkers[d]).length; }) / dayKeys.length : null;
      var workers = mWorkers != null ? mWorkers : (p ? p.workers : null);
      var workMin = n ? workSec / 60 / n : null;
      var lossPerUnit = {};
      LOSS_TYPES.forEach(function (t) { lossPerUnit[t] = n ? loss[t] / 60 / n : null; });
      return {
        name: name, seq: p ? p.seq : 999, inMaster: !!p, masterWorkers: p ? p.workers : null, stdMin: p ? p.stdMin : null,
        stdCt: p && p.stdMin != null && p.workers > 0 ? p.stdMin / p.workers : null,
        units: n, rows: mine.length, workSec: workSec, lossSec: lossSec, loss: loss,
        workMin: workMin,                                          // 대당 순작업 공수(인·분)
        lossMin: n ? lossSec / 60 / n : null,                      // 대당 손실(인·분)
        lossPerUnit: lossPerUnit,
        measuredWorkers: mWorkers == null ? null : round(mWorkers, 2), workers: workers,
        ct: workMin != null && workers > 0 ? workMin / workers : null,                       // 순작업 사이클타임
        ctAll: workMin != null && workers > 0 ? (workMin + (n ? lossSec / 60 / n : 0)) / workers : null // 손실 포함(참고)
      };
    });
    return { rows: rows, noUnit: noUnit, days: measureDays(list), count: list.length };
  }

  /* 택트타임(분/대) — 기간의 일일 실적에서 Σ가용시간×60 ÷ Σ목표. 실적이 없으면 설정 기본값 */
  function taktInfo(daily, opts) {
    opts = opts || {};
    var s = opts.settings || {};
    var list = (daily || []).filter(function (r) { return inRange(r.date, opts.from, opts.to); }).map(function (r) { return withDefaults(r, s); })
      .filter(function (r) { return r.availHr != null && r.target > 0; });
    if (list.length) {
      var avail = sum(list, function (r) { return r.availHr * 60; }), t = sum(list, function (r) { return r.target; });
      return { taktMin: avail / t, availMin: avail / list.length, target: t / list.length, days: list.length, source: '일일 실적 ' + list.length + '일' };
    }
    if (s.availHr > 0 && s.target > 0) return { taktMin: s.availHr * 60 / s.target, availMin: s.availHr * 60, target: s.target, days: 0, source: '설정 기본값' };
    return { taktMin: null, availMin: null, target: null, days: 0, source: '없음' };
  }

  /* 사이클타임 vs 택트타임 — source 'measured'(측정 순작업) 또는 'standard'(공정 마스터 표준시간) */
  function lineAnalysis(stats, takt, opts) {
    opts = opts || {};
    var src = opts.source || 'measured';
    var rows = stats.rows.map(function (r) {
      var ct = src === 'standard' ? r.stdCt : r.ct;
      return { name: r.name, seq: r.seq, ct: ct, ctAll: src === 'standard' ? null : r.ctAll, workMin: src === 'standard' ? r.stdMin : r.workMin, workers: src === 'standard' ? r.masterWorkers : r.workers,
        units: r.units, lossMin: r.lossMin, over: ct != null && takt.taktMin != null && ct > takt.taktMin + 1e-9, ratio: ct != null && takt.taktMin ? ct / takt.taktMin : null };
    });
    var valid = rows.filter(function (r) { return r.ct != null; });
    var maxCt = valid.length ? Math.max.apply(null, valid.map(function (r) { return r.ct; })) : null;
    var bottleneck = valid.filter(function (r) { return r.ct === maxCt; })[0] || null;
    rows.forEach(function (r) { r.isBottleneck = !!bottleneck && r === bottleneck; });
    var capacity = maxCt && takt.availMin ? takt.availMin / maxCt : null;
    return {
      rows: rows, source: src, taktMin: takt.taktMin, availMin: takt.availMin, target: takt.target, maxCt: maxCt, bottleneck: bottleneck,
      capacity: capacity,                                                     // 병목 기준 하루 최대 대수
      expectedRate: capacity != null && takt.target ? capacity / takt.target : null,
      balance: valid.length && maxCt ? sum(valid, function (r) { return r.ct; }) / (valid.length * maxCt) : null, // 라인 밸런스 효율
      overCount: rows.filter(function (r) { return r.over; }).length
    };
  }

  /* 손실 파레토 — 유형별 합(분) 큰 순, 누적 비율 */
  function lossPareto(measures, opts) {
    opts = opts || {};
    var list = (measures || []).filter(function (m) { return isLoss(m.kind) && inRange(m.date, opts.from, opts.to) && (!opts.process || norm(m.process) === norm(opts.process)); });
    var total = sum(list, function (m) { return m.sec; });
    var rows = LOSS_TYPES.map(function (t) {
      var mine = list.filter(function (m) { return m.kind === t; });
      return { type: t, sec: sum(mine, function (m) { return m.sec; }), count: mine.length };
    }).sort(function (a, b) { return b.sec - a.sec || LOSS_TYPES.indexOf(a.type) - LOSS_TYPES.indexOf(b.type); });
    var cum = 0;
    rows.forEach(function (r) { r.min = r.sec / 60; r.share = total ? r.sec / total : null; cum += r.sec; r.cum = total ? cum / total : null; });
    return { rows: rows, totalSec: total, totalMin: total / 60, count: list.length };
  }
  /* 손실 교차표 — by 'process' | 'worker' → [{key, loss:{유형: 분}, total, workMin, lossShare}] */
  function lossMatrix(measures, by, opts) {
    opts = opts || {};
    var list = (measures || []).filter(function (m) { return inRange(m.date, opts.from, opts.to); });
    var keys = uniq(list.map(function (m) { return by === 'worker' ? (m.worker || '(작업자 없음)') : m.process; }));
    if (by !== 'worker' && opts.processes) {
      var order = sortProcesses(opts.processes).map(function (p) { return norm(p.name); });
      keys.sort(function (a, b) { var x = order.indexOf(norm(a)), y = order.indexOf(norm(b)); return (x < 0 ? 999 : x) - (y < 0 ? 999 : y) || cmp(a, b); });
    } else keys.sort(cmp);
    return keys.map(function (k) {
      var mine = list.filter(function (m) { return (by === 'worker' ? (m.worker || '(작업자 없음)') : m.process) === k; });
      var loss = {};
      LOSS_TYPES.forEach(function (t) { loss[t] = sum(mine.filter(function (m) { return m.kind === t; }), function (m) { return m.sec; }) / 60; });
      var total = sum(LOSS_TYPES, function (t) { return loss[t]; }), work = sum(mine.filter(function (m) { return m.kind === '작업'; }), function (m) { return m.sec; }) / 60;
      return { key: k, loss: loss, total: total, workMin: work, lossShare: total + work > 0 ? total / (total + work) : null };
    });
  }

  /* ── 8. 인원 배분 시뮬레이터 ─────────────────────────────────
     rows: [{name, workMin(대당 공수), workers, cutPct(공수 줄임 %, 선택)}] → 공정별 사이클타임·병목·하루 예상 대수·예상 달성률 */
  function simulate(rows, availMin, target) {
    var out = (rows || []).map(function (r) {
      var w = Math.max(0, Math.round(Number(r.workers) || 0));
      var cut = Math.min(90, Math.max(0, Number(r.cutPct) || 0));
      var work = r.workMin != null ? r.workMin * (1 - cut / 100) : null;
      return { name: r.name, workMin: r.workMin, cutPct: cut, effWorkMin: work, workers: w, ct: work != null && w > 0 ? work / w : (work != null && w === 0 ? Infinity : null) };
    });
    var valid = out.filter(function (r) { return r.ct != null; });
    var maxCt = valid.length ? Math.max.apply(null, valid.map(function (r) { return r.ct; })) : null;
    var bn = valid.filter(function (r) { return r.ct === maxCt; })[0] || null;
    out.forEach(function (r) { r.isBottleneck = r === bn; r.over = r.ct != null && availMin && target ? r.ct > availMin / target + 1e-9 : false; });
    var capacity = maxCt && isFinite(maxCt) && availMin ? availMin / maxCt : (maxCt === Infinity ? 0 : null);
    return {
      rows: out, totalWorkers: sum(out, function (r) { return r.workers; }), maxCt: maxCt, bottleneck: bn,
      taktMin: availMin && target ? availMin / target : null,
      capacity: capacity, capacityWhole: capacity == null ? null : Math.floor(capacity + 1e-9),
      expectedRate: capacity != null && target ? capacity / target : null,
      balance: valid.length && maxCt && isFinite(maxCt) ? sum(valid, function (r) { return r.ct; }) / (valid.length * maxCt) : null
    };
  }
  /* 같은 총인원으로 가장 긴 사이클타임을 줄이는 배분 — 모두 1명에서 시작해 남은 인원을 그때그때 가장 긴 공정에 1명씩.
     (공수 ÷ 인원 의 최댓값을 줄이는 문제는 이 방법이 최선입니다) */
  function suggestAllocation(rows, total) {
    var n = (rows || []).length;
    total = Math.round(total);
    if (!n || total < n) return null;
    var w = rows.map(function () { return 1; }), left = total - n;
    function work(i) { var r = rows[i]; var c = Math.min(90, Math.max(0, Number(r.cutPct) || 0)); return (r.workMin || 0) * (1 - c / 100); }
    while (left > 0) {
      var best = 0;
      for (var i = 1; i < n; i++) if (work(i) / w[i] > work(best) / w[best] + 1e-12) best = i;
      w[best]++; left--;
    }
    return w;
  }

  /* ── 9. 개선 전·후 비교 + 단가 절감 ─────────────────────────── */
  function periodFacts(db, p) {
    var tot = achieveTotal(db.daily, { from: p.from, to: p.to, settings: db.settings, goal: db.settings.goal });
    var st = processStats(db.measures, db.processes, { from: p.from, to: p.to });
    var tk = taktInfo(db.daily, { from: p.from, to: p.to, settings: db.settings });
    var la = lineAnalysis(st, tk);
    var lp = lossPareto(db.measures, { from: p.from, to: p.to });
    var measured = st.rows.filter(function (r) { return r.units > 0; });
    return {
      from: p.from, to: p.to, total: tot, line: la, pareto: lp, stats: st,
      // 측정 기반: 공정별 대당 값을 더한 「한 대에 드는 순작업·손실 공수」
      netWorkMin: measured.length ? sum(measured, function (r) { return r.workMin; }) : null,
      lossMin: measured.length ? sum(measured, function (r) { return r.lossMin; }) : null,
      lossByType: LOSS_TYPES.reduce(function (o, t) { o[t] = measured.length ? sum(measured, function (r) { return r.lossPerUnit[t]; }) : null; return o; }, {})
    };
  }
  /* cost: { wage(원/시간), otherBefore(대당 기타 원가, 원), otherAfter, annualUnits(선택) } — 전부 사용자가 넣는 값 */
  function costOf(perUnitManHr, wage, other) {
    if (perUnitManHr == null || !(wage >= 0)) return null;
    var labor = perUnitManHr * wage;
    return { labor: labor, other: other || 0, total: labor + (other || 0) };
  }
  function comparePeriods(db, before, after, cost) {
    cost = cost || {};
    var A = periodFacts(db, before), B = periodFacts(db, after);
    var otherA = cost.otherBefore != null ? Number(cost.otherBefore) : 0, otherB = cost.otherAfter != null && cost.otherAfter !== '' ? Number(cost.otherAfter) : otherA;
    var cA = costOf(A.total.perUnitManHr, Number(cost.wage), otherA), cB = costOf(B.total.perUnitManHr, Number(cost.wage), otherB);
    var saving = cA && cB ? cA.total - cB.total : null;
    var annual = saving != null && Number(cost.annualUnits) > 0 ? saving * Number(cost.annualUnits) : null;
    function d(x, y) { return x == null || y == null ? null : y - x; }
    return {
      before: A, after: B, costBefore: cA, costAfter: cB, saving: saving, savingRate: saving != null && cA.total ? saving / cA.total : null, annual: annual,
      delta: {
        rate: d(A.total.rate, B.total.rate), actualPerDay: d(A.total.days ? A.total.actual / A.total.days : null, B.total.days ? B.total.actual / B.total.days : null),
        perUnitManHr: d(A.total.perUnitManHr, B.total.perUnitManHr), lossMin: d(A.lossMin, B.lossMin), maxCt: d(A.line.maxCt, B.line.maxCt),
        workers: d(A.total.workers, B.total.workers)
      },
      kpi: {
        keepWorkers: A.total.workers != null && B.total.workers != null ? B.total.workers <= A.total.workers + 1e-9 : null,
        rate90: B.total.rate != null ? B.total.rate >= (db.settings.goal || GOAL) - 1e-9 : null,
        costDown: saving != null ? saving > 0 : null
      }
    };
  }
  function compareToAoa(c) {
    var A = c.before, B = c.after;
    function v(x, d) { return x == null || !isFinite(x) ? '' : round(x, d == null ? 2 : d); }
    var rows = [['항목', '개선 전', '개선 후', '차이(후−전)'],
      ['기간', A.from + ' ~ ' + A.to, B.from + ' ~ ' + B.to, ''],
      ['실적 일수', A.total.days, B.total.days, ''],
      ['목표 대수 합', A.total.target, B.total.target, B.total.target - A.total.target],
      ['실제 대수 합', A.total.actual, B.total.actual, B.total.actual - A.total.actual],
      ['하루 평균 실제 대수', v(A.total.days ? A.total.actual / A.total.days : null, 2), v(B.total.days ? B.total.actual / B.total.days : null, 2), v(c.delta.actualPerDay, 2)],
      ['달성률', A.total.rate == null ? '' : round(A.total.rate * 100, 1) + '%', B.total.rate == null ? '' : round(B.total.rate * 100, 1) + '%', c.delta.rate == null ? '' : round(c.delta.rate * 100, 1) + '%p'],
      ['90% 이상 일수', A.total.okDays + '/' + A.total.ratedDays, B.total.okDays + '/' + B.total.ratedDays, ''],
      ['평균 투입 인원(명)', v(A.total.workers, 1), v(B.total.workers, 1), v(c.delta.workers, 1)],
      ['대당 투입공수(인·시)', v(A.total.perUnitManHr), v(B.total.perUnitManHr), v(c.delta.perUnitManHr)],
      ['병목 공정', A.line.bottleneck ? A.line.bottleneck.name : '', B.line.bottleneck ? B.line.bottleneck.name : '', ''],
      ['병목 사이클타임(분/대)', v(A.line.maxCt, 1), v(B.line.maxCt, 1), v(c.delta.maxCt, 1)],
      ['측정 대당 순작업 공수(인·분)', v(A.netWorkMin, 1), v(B.netWorkMin, 1), v(A.netWorkMin != null && B.netWorkMin != null ? B.netWorkMin - A.netWorkMin : null, 1)],
      ['측정 대당 손실 공수(인·분)', v(A.lossMin, 1), v(B.lossMin, 1), v(c.delta.lossMin, 1)]];
    LOSS_TYPES.forEach(function (t) { rows.push([' · ' + t + '(인·분/대)', v(A.lossByType[t], 1), v(B.lossByType[t], 1), v(A.lossByType[t] != null && B.lossByType[t] != null ? B.lossByType[t] - A.lossByType[t] : null, 1)]); });
    if (c.costBefore && c.costAfter) {
      rows.push(['대당 인건비(원)', Math.round(c.costBefore.labor), Math.round(c.costAfter.labor), Math.round(c.costAfter.labor - c.costBefore.labor)]);
      rows.push(['대당 기타 원가(원)', Math.round(c.costBefore.other), Math.round(c.costAfter.other), Math.round(c.costAfter.other - c.costBefore.other)]);
      rows.push(['대당 제작원가(원)', Math.round(c.costBefore.total), Math.round(c.costAfter.total), Math.round(c.costAfter.total - c.costBefore.total)]);
      rows.push(['대당 절감액(원)', '', Math.round(c.saving), '']);
      rows.push(['절감률', '', c.savingRate == null ? '' : round(c.savingRate * 100, 1) + '%', '']);
      if (c.annual != null) rows.push(['연간 절감 예상(원)', '', Math.round(c.annual), '']);
    }
    return rows;
  }

  /* ── 10. 표준작업서 ─────────────────────────────────────────── */
  function sopRows(processes, stats) {
    return sortProcesses(processes).map(function (p, i) {
      var st = stats ? stats.rows.filter(function (r) { return norm(r.name) === norm(p.name); })[0] : null;
      return { no: i + 1, name: p.name, workers: p.workers, stdMin: p.stdMin, ct: p.stdMin != null && p.workers > 0 ? p.stdMin / p.workers : null,
        measuredWorkMin: st && st.workMin != null ? st.workMin : null, points: p.points, quality: p.quality, safety: p.safety };
    });
  }

  /* ── 11. 작업자 이름 가리기 (AI 프롬프트용) ─────────────────────
     프롬프트의 작업자 이름을 「작업자1」 같은 별칭으로 바꾸고, 대응표는 이 브라우저에만 둡니다. AI 답의 별칭은 이름으로 되돌립니다. */
  var ALIAS_PREFIX = '작업자';
  function assignAliases(map, names) {
    var out = {}, used = 0;
    Object.keys(map || {}).forEach(function (n) {
      var m = new RegExp('^' + ALIAS_PREFIX + '(\\d+)$').exec(map[n]);
      if (m) { out[n] = map[n]; used = Math.max(used, +m[1]); }
    });
    uniq((names || []).map(str).filter(Boolean)).sort(cmp).forEach(function (n) { if (!out[n]) out[n] = ALIAS_PREFIX + (++used); });
    return out;
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }
  function maskText(text, map) {
    var keys = Object.keys(map || {}).filter(function (k) { return k.length >= 2; }).sort(function (a, b) { return b.length - a.length; });
    var s = text == null ? '' : String(text);
    if (!keys.length) return s;
    return s.replace(new RegExp(keys.map(escRe).join('|'), 'g'), function (k) { return map[k]; });
  }
  /* 「작업자3」만 바꾸고 「작업자 3명」「작업자3명」처럼 수를 세는 말은 그대로 둡니다 */
  function unmaskText(text, map) {
    var back = {};
    Object.keys(map || {}).forEach(function (n) { back[map[n]] = n; });
    return String(text == null ? '' : text).replace(new RegExp(ALIAS_PREFIX + '(\\d+)(?![0-9명인개건])', 'g'), function (all) { return back[all] || all; });
  }
  function findLeaks(text, names) {
    var s = String(text || '');
    return uniq((names || []).filter(function (n) { return n && n.length >= 2 && s.indexOf(n) >= 0; }));
  }

  /* ── 12. AI 프롬프트 (사실만 넣고, 사실 밖의 원인은 「추정」으로) ─── */
  function fmtMin(v, d) { return v == null || !isFinite(v) ? '-' : round(v, d == null ? 1 : d) + '분'; }
  /* ctx: { period:{from,to}, total(achieveTotal), weeks(achieveRows week), line(lineAnalysis), pareto, byProcess(lossMatrix), byWorker(lossMatrix),
          sim(simulate 결과, 선택), compare(comparePeriods, 선택), includeCost, aliases(작업자 별칭, 선택), goal } */
  function buildAnalysisPrompt(ctx) {
    var L = [], al = ctx.aliases || null, goal = ctx.goal || GOAL;
    function W(n) { return al && al[n] ? al[n] : n; }
    var t = ctx.total, la = ctx.line;
    L.push('너는 제조 현장의 생산성 개선 보조야. 아래 [사실]은 프레임 제작 라인의 일일 실적과 현장 측정 기록에서 도구가 계산한 값이야.');
    L.push('[사실]의 숫자만 근거로 삼아줘. 숫자를 새로 만들거나 바꾸지 말아줘.');
    L.push('원인은 [사실]에 측정 손실 유형·메모·비고로 적힌 것만 「기록된 원인」으로 쓰고, 그 밖의 원인은 반드시 「추정」이라고 표시해줘.');
    L.push('조건: 인원을 늘리지 않고(현재 인원 유지), 품질과 안전을 지키면서 목표 대수 대비 달성률 ' + round(goal * 100, 0) + '% 이상을 확보하는 방법을 찾고 있어.');
    if (al) L.push('작업자 이름은 「' + ALIAS_PREFIX + '1」 같은 별칭으로 바꿔 두었어. 답에서도 별칭을 띄어 쓰지 말고 그대로 써줘.');
    L.push('');
    L.push('[사실]');
    L.push('- 기간: ' + (ctx.period.from || '처음') + ' ~ ' + (ctx.period.to || '끝') + ', 실적 ' + t.days + '일');
    L.push('- 목표 대수 합 ' + t.target + ', 실제 생산 대수 합 ' + t.actual + ', 달성률 ' + fmtPct(t.rate) + ', 달성률 ' + round(goal * 100, 0) + '% 이상인 날 ' + t.okDays + '/' + t.ratedDays + '일' +
      (t.workers != null ? ', 평균 투입 인원 ' + t.workers + '명' : '') + (t.availHr != null ? ', 평균 가용시간 ' + t.availHr + '시간' : '') +
      (t.perUnitManHr != null ? ', 대당 투입공수 ' + round(t.perUnitManHr, 2) + '인·시' : ''));
    if (ctx.weeks && ctx.weeks.length) L.push('- 주별 달성률: ' + ctx.weeks.map(function (w) { return w.key.slice(5).replace('-', '/') + '주 ' + fmtPct(w.rate); }).join(', '));
    if (t.notes && t.notes.length) L.push('- 일일 실적 비고: ' + t.notes.slice(0, 12).map(function (n) { return maskText(n, al); }).join(' / '));
    if (la) {
      L.push('- 택트타임 ' + fmtMin(la.taktMin) + '/대 (가용시간 ÷ 목표 대수), 공정별 사이클타임(측정 순작업 공수 ÷ 인원):');
      la.rows.forEach(function (r) {
        L.push('  · ' + r.name + ': ' + (r.ct == null ? '측정 없음' : fmtMin(r.ct) + '/대 (대당 공수 ' + fmtMin(r.workMin) + ', 인원 ' + round(r.workers, 1) + '명, 측정 ' + r.units + '대' +
          (r.lossMin != null ? ', 대당 손실 ' + fmtMin(r.lossMin) : '') + ')' + (r.over ? ' — 택트타임 초과' : '') + (r.isBottleneck ? ' — 병목' : '')));
      });
      if (la.capacity != null) L.push('- 병목 기준 하루 최대 ' + round(la.capacity, 1) + '대, 예상 달성률 ' + fmtPct(la.expectedRate) + ', 라인 밸런스 효율 ' + fmtPct(la.balance));
    }
    if (ctx.pareto && ctx.pareto.count) {
      L.push('- 손실시간(측정, 유형별 큰 순): ' + ctx.pareto.rows.filter(function (r) { return r.sec > 0; }).map(function (r) { return r.type + ' ' + fmtMin(r.min, 0) + '(' + fmtPct(r.share, 0) + ')'; }).join(', ') + ', 합계 ' + fmtMin(ctx.pareto.totalMin, 0));
    }
    if (ctx.byProcess && ctx.byProcess.length) {
      L.push('- 공정별 손실(분): ' + ctx.byProcess.map(function (r) { return r.key + ' ' + LOSS_TYPES.filter(function (x) { return r.loss[x] > 0; }).map(function (x) { return x + ' ' + round(r.loss[x], 0); }).join('·'); }).join(' / '));
    }
    if (ctx.byWorker && ctx.byWorker.length) {
      L.push('- 작업자별 손실 비율(손실 ÷ (작업+손실)): ' + ctx.byWorker.map(function (r) { return W(r.key) + ' ' + fmtPct(r.lossShare, 0); }).join(', '));
    }
    if (ctx.memos && ctx.memos.length) L.push('- 측정 메모: ' + ctx.memos.slice(0, 15).map(function (m) { return maskText(m, al); }).join(' / '));
    if (ctx.sim) {
      L.push('- 인원 배분 시뮬레이션(같은 총인원 ' + ctx.sim.totalWorkers + '명): ' + ctx.sim.rows.map(function (r) { return r.name + ' ' + r.workers + '명' + (r.cutPct ? '(공수 −' + r.cutPct + '%)' : '') + ' → ' + fmtMin(r.ct); }).join(', ') +
        ' → 병목 ' + (ctx.sim.bottleneck ? ctx.sim.bottleneck.name : '-') + ', 하루 최대 ' + round(ctx.sim.capacity, 1) + '대, 예상 달성률 ' + fmtPct(ctx.sim.expectedRate));
    }
    if (ctx.compare) {
      var c = ctx.compare;
      L.push('- 개선 전(' + c.before.from + '~' + c.before.to + ') 달성률 ' + fmtPct(c.before.total.rate) + ' → 개선 후(' + c.after.from + '~' + c.after.to + ') ' + fmtPct(c.after.total.rate) +
        ', 대당 투입공수 ' + round(c.before.total.perUnitManHr, 2) + ' → ' + round(c.after.total.perUnitManHr, 2) + '인·시' +
        (c.before.lossMin != null && c.after.lossMin != null ? ', 측정 대당 손실 ' + fmtMin(c.before.lossMin) + ' → ' + fmtMin(c.after.lossMin) : ''));
      if (ctx.includeCost && c.saving != null) L.push('- 대당 제작원가 ' + fmtWon(c.costBefore.total) + ' → ' + fmtWon(c.costAfter.total) + ', 대당 절감액 ' + fmtWon(c.saving) + ', 절감률 ' + fmtPct(c.savingRate));
    }
    L.push('');
    L.push('[요청] 다음 순서로 한국어로 짧게 정리해줘.');
    L.push('1. 현재 상태 한 줄 요약 (달성률과 병목을 숫자 그대로)');
    L.push('2. 병목공정과 손실의 관계 — 어느 공정의 어떤 손실이 생산량을 막는지 (기록된 원인 / 추정 구분)');
    L.push('3. 작업 순서·인원 배분 개선안 2~3개 (현재 인원 유지, 각 안마다 근거 숫자와 예상 효과)');
    L.push('4. 손실 유형별 줄이는 방법 (자재 준비·이동·대기·재작업 가운데 큰 것부터, 표준화할 작업 방법 포함)');
    L.push('5. 현장에서 더 측정·확인할 것');
    L.push('품질·안전에 영향이 있을 수 있는 안에는 「품질·안전 확인 필요」라고 적어줘. 확실하지 않은 것은 「확인 필요」라고 적어줘.');
    var text = L.join('\n');
    return { prompt: text, leaks: al ? findLeaks(text, Object.keys(al)) : [] };
  }
  function buildSopPrompt(ctx) {
    var L = [], rows = ctx.rows || [];
    L.push('너는 제조 현장의 표준작업서 작성 보조야. 아래 [사실]은 프레임 제작 공정의 순서·시간·작업 메모야.');
    L.push('각 공정의 「작업 요점」「품질 주의」「안전 주의」 메모를 표준작업서 문장으로 다듬어줘.');
    L.push('규칙: 공정 순서·이름·숫자(시간·인원)는 바꾸지 말아줘. 메모에 없는 작업 방법·수치·기준을 지어내지 말아줘. 메모가 비어 있으면 「(현장 확인 후 작성)」이라고 적어줘.');
    L.push('문장은 「~한다」 꼴의 짧은 지시문으로, 한 항목에 한 동작만 써줘.');
    L.push('');
    L.push('[사실]');
    L.push('- 제품: ' + (ctx.product || '프레임') + (ctx.taktMin ? ', 택트타임 ' + fmtMin(ctx.taktMin) + '/대' : '') + (ctx.target ? ', 하루 목표 ' + round(ctx.target, 1) + '대' : ''));
    rows.forEach(function (r) {
      L.push(r.no + '. ' + r.name + ' — 인원 ' + r.workers + '명, 표준 공수 ' + fmtMin(r.stdMin) + (r.ct != null ? ', 사이클타임 ' + fmtMin(r.ct) : ''));
      L.push('   작업 요점 메모: ' + (r.points || '(없음)'));
      L.push('   품질 주의 메모: ' + (r.quality || '(없음)'));
      L.push('   안전 주의 메모: ' + (r.safety || '(없음)'));
    });
    L.push('');
    L.push('[요청] 공정마다 아래 꼴로 답해줘(번호·공정 이름 그대로).');
    L.push('1. 공정 이름');
    L.push('- 작업 순서: ① … ② … ③ …');
    L.push('- 품질 포인트: …');
    L.push('- 안전 포인트: …');
    L.push('마지막에 「현장 확인이 필요한 점」을 3개 이내로 적어줘.');
    return L.join('\n');
  }

  /* ── 13. 스톱워치 (현장 측정 — 누를 때마다 앞 구간을 닫고 새 구간을 엽니다) ──────
     state = null | { worker, process, unit, kind, startMs } */
  function localDate(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localHms(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function swClose(state, nowMs, memo) {
    if (!state) return null;
    var sec = Math.max(0, Math.round((nowMs - state.startMs) / 1000));
    if (sec < 1) return null; // 실수로 두 번 누른 것
    return { date: localDate(state.startMs), worker: state.worker || '', process: state.process, unit: state.unit || '', kind: state.kind,
      start: localHms(state.startMs), end: localHms(nowMs), sec: sec, memo: memo || '' };
  }
  /* 구분을 바꿈(작업 ↔ 손실 유형). ctx 가 있으면 작업자·공정·대 번호도 바꿉니다 */
  function swSwitch(state, kind, nowMs, ctx) {
    var closed = swClose(state, nowMs);
    var base = state || {};
    ctx = ctx || {};
    return { closed: closed, state: { worker: ctx.worker != null ? ctx.worker : base.worker, process: ctx.process != null ? ctx.process : base.process,
      unit: ctx.unit != null ? ctx.unit : base.unit, kind: kind, startMs: nowMs } };
  }
  function swStop(state, nowMs) { return { closed: swClose(state, nowMs), state: null }; }
  /* 다음 대 — 지금 구간을 닫고 대 번호를 하나 올려 「작업」으로 시작 */
  function swNextUnit(state, nowMs) {
    if (!state) return { closed: null, state: null };
    return swSwitch(state, '작업', nowMs, { unit: nextUnit(state.unit) });
  }
  function nextUnit(u) {
    u = str(u);
    if (!u) return '1';
    var m = /^(.*?)(\d+)$/.exec(u);
    if (!m) return u + '-2';
    var n = String(+m[2] + 1);
    while (n.length < m[2].length) n = '0' + n;
    return m[1] + n;
  }

  /* ── 14. 저장 형식 ─────────────────────────────────────────── */
  function defaultSettings() {
    return { goal: GOAL, availHr: 7.5, target: 10, workers: 9, product: '프레임', wage: null, otherBefore: null, otherAfter: null, annualUnits: null };
  }
  function cleanSettings(s) {
    var d = defaultSettings();
    if (!s || typeof s !== 'object') return d;
    function n(v, lo, hi) { var x = toNum(v); return x == null || x !== x || x < lo || x > hi ? null : x; }
    var g = n(s.goal, 0.1, 1.5); if (g != null) d.goal = g;
    d.availHr = n(s.availHr, 0, 24); d.target = n(s.target, 0, 100000); d.workers = n(s.workers, 0, 10000);
    d.product = str(s.product) || '프레임';
    d.wage = n(s.wage, 0, 1e9); d.otherBefore = n(s.otherBefore, 0, 1e12); d.otherAfter = n(s.otherAfter, 0, 1e12); d.annualUnits = n(s.annualUnits, 0, 1e9);
    return d;
  }
  function emptyDb() {
    return { schemaVersion: SCHEMA_VERSION, daily: [], processes: [], measures: [], files: [], settings: defaultSettings(),
      compare: { beforeFrom: '', beforeTo: '', afterFrom: '', afterTo: '' }, sim: {}, aiNotes: { analysis: '', sop: '' }, aliases: {}, maskWorkers: true, includeCost: false, running: null, sample: false };
  }
  function restoreDb(o) {
    var db = emptyDb();
    if (!o || typeof o !== 'object') return db;
    if (Array.isArray(o.daily)) db.daily = mergeDaily([], o.daily).records;
    if (Array.isArray(o.processes)) db.processes = sortProcesses(o.processes);
    if (Array.isArray(o.measures)) db.measures = mergeMeasures([], o.measures).records;
    if (Array.isArray(o.files)) db.files = o.files.filter(function (f) { return f && f.name; });
    db.settings = cleanSettings(o.settings);
    if (o.compare && typeof o.compare === 'object') ['beforeFrom', 'beforeTo', 'afterFrom', 'afterTo'].forEach(function (k) { db.compare[k] = toISO(o.compare[k]) || ''; });
    if (o.sim && typeof o.sim === 'object') db.sim = o.sim;
    if (o.aiNotes && typeof o.aiNotes === 'object') { db.aiNotes.analysis = str(o.aiNotes.analysis); db.aiNotes.sop = str(o.aiNotes.sop); }
    if (o.aliases && typeof o.aliases === 'object') db.aliases = assignAliases(o.aliases, []);
    if (o.maskWorkers === false) db.maskWorkers = false;
    db.includeCost = o.includeCost === true;
    if (o.running && typeof o.running === 'object' && o.running.startMs > 0 && o.running.process && KINDS.indexOf(o.running.kind) >= 0) db.running = o.running;
    db.sample = o.sample === true;
    return db;
  }

  return {
    VERSION: VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION, GOAL: GOAL, LOSS_TYPES: LOSS_TYPES, KINDS: KINDS, DAILY_FIELDS: DAILY_FIELDS, MEASURE_FIELDS: MEASURE_FIELDS, ALIAS_PREFIX: ALIAS_PREFIX,
    norm: norm, str: str, round: round, sum: sum, toNum: toNum, toISO: toISO, addDays: addDays, weekStart: weekStart, weekEnd: weekEnd, monthKey: monthKey,
    dayLabel: dayLabel, weekLabel: weekLabel, monthLabel: monthLabel, toSec: toSec, secToHms: secToHms, durSec: durSec, fmtDur: fmtDur,
    fmtN: fmtN, fmtPct: fmtPct, fmtWon: fmtWon, fmtMin: fmtMin, colName: colName, fieldsOf: fieldsOf, fieldLabel: fieldLabel,
    detectColumns: detectColumns, headerSignature: headerSignature, pickSheet: pickSheet,
    parseDaily: parseDaily, cleanDaily: cleanDaily, mergeDaily: mergeDaily, achieveRows: achieveRows, achieveTotal: achieveTotal, achieveToAoa: achieveToAoa,
    cleanProcess: cleanProcess, sortProcesses: sortProcesses, processByName: processByName,
    normKind: normKind, isLoss: isLoss, parseMeasure: parseMeasure, cleanMeasure: cleanMeasure, mergeMeasures: mergeMeasures, sortMeasures: sortMeasures, measureDays: measureDays, measureKey: measureKey,
    processStats: processStats, taktInfo: taktInfo, lineAnalysis: lineAnalysis, lossPareto: lossPareto, lossMatrix: lossMatrix,
    simulate: simulate, suggestAllocation: suggestAllocation, periodFacts: periodFacts, comparePeriods: comparePeriods, compareToAoa: compareToAoa, costOf: costOf,
    sopRows: sopRows, assignAliases: assignAliases, maskText: maskText, unmaskText: unmaskText, findLeaks: findLeaks,
    buildAnalysisPrompt: buildAnalysisPrompt, buildSopPrompt: buildSopPrompt,
    swSwitch: swSwitch, swStop: swStop, swNextUnit: swNextUnit, nextUnit: nextUnit, localDate: localDate, localHms: localHms,
    defaultSettings: defaultSettings, cleanSettings: cleanSettings, emptyDb: emptyDb, restoreDb: restoreDb
  };
});
