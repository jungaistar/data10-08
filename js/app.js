/* 프레임 제작 생산성 개선 — 화면
   계산은 js/logic.js(FrameLogic), 그래프는 js/charts.js, 저장은 js/store.js, AI 연결은 js/ai-endpoint.js·ai-panel.js. */
(function () {
  'use strict';
  var L = window.FrameLogic, S = window.FrameStore, C = window.FrameCharts, AIP = window.AIPanel;
  /* 판 맞추기 — 브라우저가 옛 logic.js 와 새 app.js 를 섞어 쓰면(Pages 캐시) 버튼과 결과가 어긋날 수 있어, 섞였으면 계산하지 않고 새로고침을 안내합니다.
     판은 scripts/bump-version.mjs 로 index.html(?v=) · logic.js 와 함께 올립니다. */
  var APP_VERSION = '2026-10-27.1';
  if (!L || L.VERSION !== APP_VERSION) {
    var m0 = document.getElementById('main') || document.body;
    m0.innerHTML = '<section class="card" id="versionMismatch"><h1>새 판이 나왔습니다 — 새로고침(Ctrl+F5)해 주세요</h1><p class="alert warn">이 브라우저가 옛 파일과 새 파일을 섞어 불러왔습니다(js/logic.js ' +
      (L && L.VERSION ? L.VERSION : '옛 판') + ' · 화면 ' + APP_VERSION + '). 이대로 계산하면 버튼과 결과가 어긋날 수 있어 멈췄습니다.</p>' +
      '<p>Windows 는 <b>Ctrl+F5</b>, Mac 은 <b>Cmd+Shift+R</b> 을 한 번 눌러 주세요. 쌓아 둔 자료는 지워지지 않습니다.</p></section>';
    return;
  }
  (function () { var ft = document.querySelector('.site-footer .inner') || document.querySelector('.site-footer'); if (!ft) return; var s = document.createElement('span'); s.className = 'ver'; s.textContent = ' · 판 ' + APP_VERSION; ft.appendChild(s); })();
  var db = S.loadDb();
  var ui = {
    unit: 'day', from: '', to: '', src: 'measured', lossBy: 'process', lossProc: '', measDay: '', progress: '',
    pending: { daily: [], measure: [] }, errors: { daily: [], measure: [] }, editDate: '', sw: { worker: '', process: '', unit: '1' }
  };
  var main = document.getElementById('main');

  /* ── 작은 도구 ───────────────────────────── */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function fld(label, control, hint, cls) {
    return h('label', { class: 'field' + (cls ? ' ' + cls : '') }, h('span', null, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
  }
  function inp(attrs) { return h('input', attrs); }
  var toastTimer = null;
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function save() {
    var ok = S.saveDb(db);
    var b = document.getElementById('storeBanner');
    b.hidden = ok;
    b.textContent = ok ? '' : '이 브라우저에 저장되지 않습니다(저장소가 막혔거나 가득 참). 창을 닫기 전에 설정 화면에서 JSON 백업을 받아 두세요.';
    return ok;
  }
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copyText(t) {
    function fallback() { var ta = h('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('복사했습니다.'); } catch (e) { toast('복사하지 못했습니다. 직접 선택해 복사해 주세요.', true); } ta.remove(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(function () { toast('복사했습니다.'); }, fallback); else fallback();
  }
  function pageHead(stage, title, lead, right) {
    return h('div', { class: 'page-head' }, h('div', { class: 'titles' }, h('div', { class: 'stage' }, stage), h('h1', null, title), lead ? h('p', { class: 'lead' }, lead) : null), right || null);
  }
  function tile(k, v, sub, cls) { return h('div', { class: 'tile' + (cls ? ' ' + cls : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('div', { class: 'note' }, sub) : null); }
  function table(head, rows, opts) {
    opts = opts || {};
    var t = h('table', { class: 'list' + (opts.cls ? ' ' + opts.cls : '') });
    var tr = h('tr');
    head.forEach(function (x, i) { tr.appendChild(h('th', { class: opts.num && opts.num[i] ? 'num' : null, scope: 'col' }, x)); });
    t.appendChild(h('thead', null, tr));
    var tb = h('tbody');
    rows.forEach(function (r) {
      var row = h('tr', { class: r.cls || null });
      (r.cells || r).forEach(function (x, i) { row.appendChild(h('td', { class: ((opts.num && opts.num[i] ? 'num' : '') + (r.tdCls && r.tdCls[i] ? ' ' + r.tdCls[i] : '')).trim() || null }, x)); });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return h('div', { class: 'table-wrap' }, t);
  }
  function nums(n, skip) { var a = []; for (var i = 0; i < n; i++) a.push(!(skip || [0]).some(function (s) { return s === i; })); return a; }
  var pct = function (v) { return L.fmtPct(v); };
  var m1 = function (v) { return v == null || !isFinite(v) ? '-' : L.fmtN(v, 1); };
  function goal() { return db.settings.goal || L.GOAL; }
  function goalPct() { return Math.round(goal() * 100) + '%'; }
  function today() { return L.localDate(Date.now()); }
  function shortName(n) { return String(n).replace(/\s*\(.*\)\s*$/, ''); }
  function hasData() { return db.daily.length || db.measures.length; }
  function emptyNotice(what) {
    return h('section', { class: 'card empty' },
      h('p', null, what || '아직 데이터가 없습니다.'),
      h('p', null, '일일 실적을 입력·가져오거나, 가상 샘플로 먼저 둘러봐 주세요.'),
      h('div', { class: 'btn-row', style: 'justify-content:center' },
        h('a', { class: 'btn btn-primary', href: '#/daily' }, '일일 실적으로'),
        h('button', { type: 'button', class: 'btn', onclick: askSample }, '가상 샘플로 시작')));
  }
  function exportWord(title, fileName, paper) {
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>' + title + '</title>' +
      '<style>body{font-family:"맑은 고딕",sans-serif;font-size:10.5pt} table{border-collapse:collapse;margin:6px 0} th,td{border:1px solid #999;padding:3px 6px;font-size:9.5pt;vertical-align:top} th{background:#eef2f7} h1{font-size:16pt} h2{font-size:12.5pt;margin-top:14pt} .pre{white-space:pre-wrap} .no-print{display:none}</style></head><body>' +
      paper.innerHTML + '</body></html>';
    download(fileName, new Blob(['﻿' + html], { type: 'application/msword' }));
  }
  function writeXlsx(fileName, sheets) {
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name.slice(0, 31)); });
    XLSX.writeFile(wb, fileName);
  }

  /* ── 기간 ─────────────────────────────── */
  function dataRange() {
    var ds = db.daily.map(function (r) { return r.date; }).concat(L.measureDays(db.measures)).sort();
    return ds.length ? { from: ds[0], to: ds[ds.length - 1] } : { from: '', to: '' };
  }
  function period() {
    var r = dataRange();
    return { from: ui.from || r.from, to: ui.to || r.to };
  }
  /* 기간 고르기 — 전체 · 개선 전 · 개선 후 · 최근 2주 · 직접 */
  function periodBar(extra) {
    var p = period();
    var f = inp({ type: 'date', value: p.from, 'aria-label': '시작일' }), t = inp({ type: 'date', value: p.to, 'aria-label': '끝일' });
    f.addEventListener('change', function () { ui.from = f.value; render(); });
    t.addEventListener('change', function () { ui.to = t.value; render(); });
    function preset(label, from, to) {
      var on = (from || '') === (ui.from || '') && (to || '') === (ui.to || '');
      return h('button', { type: 'button', class: 'btn' + (on ? ' btn-primary' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { ui.from = from; ui.to = to; render(); } }, label);
    }
    var c = db.compare, r = dataRange();
    var presets = [preset('전체', '', '')];
    if (c.beforeFrom && c.beforeTo) presets.push(preset('개선 전', c.beforeFrom, c.beforeTo));
    if (c.afterFrom && c.afterTo) presets.push(preset('개선 후', c.afterFrom, c.afterTo));
    if (r.to) presets.push(preset('최근 2주', L.addDays(r.to, -13), r.to));
    return h('div', { class: 'filters card no-print' }, fld('시작일', f), fld('끝일', t), h('div', { class: 'span-all' }, h('div', { class: 'preset' }, presets)), extra || null);
  }

  /* ── 엑셀 가져오기 (일일 실적 · 측정 기록 공통) ─────────────── */
  function readFile(file, kind) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        try { resolve(prepare(file.name, XLSX.read(new Uint8Array(fr.result), { type: 'array' }), kind)); }
        catch (e) { reject(new Error(file.name + ': 엑셀로 읽지 못했습니다(' + e.message + ')')); }
      };
      fr.onerror = function () { reject(new Error(file.name + ': 파일을 읽지 못했습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }
  /* 날짜·시각을 엑셀 일련번호(숫자) 그대로 읽어 logic 이 바꿉니다 — 시간대 때문에 하루·한 시간 밀리는 일을 막음 */
  function prepare(name, wb, kind) {
    var sheets = wb.SheetNames.map(function (n) { return { name: n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) }; });
    var pick = L.pickSheet(sheets, kind) || sheets[0];
    var item = { kind: kind, fileName: name, sheets: sheets, sheet: pick ? pick.name : '', overrides: {} };
    reparse(item);
    return item;
  }
  function reparse(item) {
    var sh = item.sheets.filter(function (s) { return s.name === item.sheet; })[0];
    item.aoa = sh ? sh.aoa : [];
    item.result = item.kind === 'daily' ? L.parseDaily(item.aoa, { overrides: item.overrides }) : L.parseMeasure(item.aoa, { overrides: item.overrides });
  }
  function handleFiles(list, kind) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return !/^~\$/.test(f.name) && /\.(xlsx|xlsm|xls|csv)$/i.test(f.name); });
    if (!files.length) { toast('엑셀 파일(.xlsx·.xls·.csv)을 골라 주세요.', true); return; }
    files.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    ui.errors[kind] = [];
    var i = 0;
    (function next() {
      if (i >= files.length) { ui.progress = ''; render(); toast(files.length + '개 파일을 읽었습니다. 열 연결을 확인한 뒤 반영해 주세요.'); return; }
      var f = files[i++];
      ui.progress = '읽는 중 ' + i + ' / ' + files.length + ' — ' + f.name;
      var pr = document.getElementById('importProgress'); if (pr) pr.textContent = ui.progress;
      readFile(f, kind).then(function (it) {
        // 머리행이 같은 파일에 고친 열 연결이 있으면 그대로 씁니다
        var sig = L.headerSignature(it.result.det);
        var src = ui.pending[kind].filter(function (p) { return Object.keys(p.overrides).length && L.headerSignature(p.result.det) === sig; })[0];
        if (src) { it.overrides = JSON.parse(JSON.stringify(src.overrides)); reparse(it); }
        ui.pending[kind].push(it);
      }, function (e) { ui.errors[kind].push(e.message); }).then(function () { setTimeout(next, 0); });
    })();
  }
  function commit(kind, items, quiet) {
    var stat = { added: 0, updated: 0 }, ok = 0, newProcs = [];
    items.forEach(function (it) {
      var r = it.result;
      if (r.det.missing.length) return;
      if (kind === 'daily') {
        var m = L.mergeDaily(db.daily, r.records); db.daily = m.records;
        stat.added += m.stat.added; stat.updated += m.stat.updated;
      } else {
        r.records.forEach(function (x) {
          var p = L.processByName(db.processes, x.process);
          if (p) x.process = p.name; // 공정 마스터 표기로 맞춤
          else if (newProcs.indexOf(x.process) < 0) newProcs.push(x.process);
        });
        var mm = L.mergeMeasures(db.measures, r.records); db.measures = mm.records;
        stat.added += mm.stat.added; stat.updated += mm.stat.updated;
      }
      db.files.push({ kind: kind, name: it.fileName, sheet: it.sheet, rows: r.records.length, at: new Date().toISOString().slice(0, 16).replace('T', ' ') });
      ok++;
    });
    if (newProcs.length) {
      var base = db.processes.length;
      newProcs.forEach(function (n, i) { db.processes.push(L.cleanProcess({ id: 'p' + Date.now() + '-' + i, name: n, seq: (base + i + 1), workers: 1 }, base + i)); });
      db.processes = L.sortProcesses(db.processes);
    }
    if (!items.every(function (it) { return it.sample; })) db.sample = false;
    ui.pending[kind] = ui.pending[kind].filter(function (p) { return items.indexOf(p) < 0; });
    save();
    if (!quiet) {
      toast(ok + '개 파일 반영 — 새 행 ' + stat.added + ' · 바뀐 행 ' + stat.updated + (newProcs.length ? ' · 공정 설정에 새 공정 ' + newProcs.length + '개 추가(표준시간·인원을 채워 주세요)' : ''));
      render();
    }
  }
  function importCard(kind) {
    var label = kind === 'daily' ? '일일 실적' : '측정 기록';
    var input = inp({ type: 'file', multiple: true, accept: '.xlsx,.xlsm,.xls,.csv' });
    input.addEventListener('change', function () { handleFiles(input.files, kind); input.value = ''; });
    var drop = h('div', { class: 'drop' },
      h('label', { class: 'btn btn-primary' }, input, label + ' 엑셀 고르기(여러 개 가능)'),
      h('span', { class: 'note' }, '또는 파일을 여기로 끌어다 놓아 주세요. 머리행 위치·열 이름이 달라도 알아서 찾고, 못 찾은 칸은 아래에서 직접 연결합니다.'));
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files, kind); });
    var box = h('section', { class: 'card' }, h('h2', null, label + ' 엑셀 가져오기'), drop,
      h('p', { class: 'note', id: 'importProgress', 'aria-live': 'polite' }, ui.progress || ''),
      ui.errors[kind].length ? h('details', { class: 'warn-list', open: true }, h('summary', null, '읽지 못한 파일 ' + ui.errors[kind].length + '개'),
        h('ul', null, ui.errors[kind].map(function (e) { return h('li', null, e); }))) : null);
    var pend = ui.pending[kind];
    if (pend.length) {
      var ready = pend.filter(function (it) { return !it.result.det.missing.length; });
      box.appendChild(h('h3', null, '열 연결 확인 (' + pend.length + '개 파일)'));
      pend.forEach(function (it) { box.appendChild(pendingCard(it)); });
      box.appendChild(h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !ready.length, onclick: function () { commit(kind, ready); } }, '확인한 ' + ready.length + '개 파일 반영'),
        h('button', { type: 'button', class: 'btn', onclick: function () { ui.pending[kind] = []; render(); } }, '취소')));
    }
    return box;
  }
  function pendingCard(it) {
    var r = it.result, det = r.det, fields = L.fieldsOf(it.kind);
    var sheetSel = h('select', { 'aria-label': '시트' });
    it.sheets.forEach(function (s) { var o = h('option', { value: s.name }, s.name); if (s.name === it.sheet) o.selected = true; sheetSel.appendChild(o); });
    sheetSel.addEventListener('change', function () { it.sheet = sheetSel.value; it.overrides = {}; reparse(it); render(); });
    var hdr = det.headers || [], ex = it.aoa[det.headerRow + 1] || [];
    var grid = h('div', { class: 'map-grid' });
    fields.forEach(function (f) {
      var sel = h('select', { 'aria-label': f.label + ' 열' });
      sel.appendChild(h('option', { value: '-1' }, '(이 파일에는 없음)'));
      hdr.forEach(function (t, i) { var o = h('option', { value: String(i) }, L.colName(i) + ' · ' + (t || '(빈 머리)')); if (det.map[f.id] === i) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () {
        var sig = L.headerSignature(it.result.det);
        ui.pending[it.kind].forEach(function (p) { if (p === it || L.headerSignature(p.result.det) === sig) { p.overrides[f.id] = Number(sel.value); reparse(p); } });
        render();
      });
      var col = det.map[f.id], exv = col == null ? '' : ex[col];
      var miss = f.req && col == null;
      grid.appendChild(h('div', { class: 'map-row' + (miss ? ' missing' : '') }, h('span', { class: 'col' }, f.label, f.req ? h('span', { class: 'req' }, ' 필수') : null), sel,
        h('span', { class: 'ex' }, col == null ? '' : '예: ' + (exv == null ? '(빈칸)' : String(exv)))));
    });
    var warn = r.warnings || [];
    return h('details', { class: 'block', open: det.missing.length ? true : null },
      h('summary', null, it.fileName + ' — ' + (det.missing.length ? '필수 칸 연결 필요' : r.records.length + '행 읽음' + (warn.length ? ' · 알림 ' + warn.length : ''))),
      h('div', { class: 'form-grid', style: 'margin:8px 0' }, fld('시트', sheetSel), h('p', { class: 'note' }, '머리행: ' + (det.headerRow + 1) + '행' + (r.skipped ? ' · 뺀 행 ' + r.skipped : ''))),
      grid,
      det.missing.length ? h('p', { class: 'alert warn' }, '필수 칸을 연결해 주세요: ' + det.missing.map(function (id) { return L.fieldLabel(it.kind, id); }).join(', ')) : null,
      warn.length ? h('details', { class: 'warn-list' }, h('summary', null, '행 알림 ' + warn.length + '개'), h('ul', null, warn.slice(0, 60).map(function (w) { return h('li', null, (w.row ? w.row + '행: ' : '') + w.msg); }))) : null);
  }

  /* ── 샘플 ─────────────────────────────── */
  function askSample() { if (!hasData() || confirm('지금 데이터를 지우고 가상 샘플(일일 실적 7주 + 현장 측정 5일)을 불러올까요?')) loadSample(); }
  function loadSample() {
    var b = window.FrameSample.build();
    db = L.emptyDb();
    db.processes = b.processes;
    db.settings = L.cleanSettings(b.settings);
    db.compare = b.compare;
    // 앱이 실제 파일을 읽을 때와 같은 길로 — 엑셀 통합문서로 만들었다가 다시 읽습니다
    function asItem(f, kind) {
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f.aoa), f.sheet);
      var it = prepare(f.fileName, XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array' }), kind);
      it.sample = true; return it;
    }
    commit('daily', [asItem(b.dailyFile, 'daily')], true);
    commit('measure', b.measureFiles.map(function (f) { return asItem(f, 'measure'); }), true);
    db.sample = true;
    ui.from = ''; ui.to = '';
    save();
    toast('가상 샘플을 불러왔습니다 — 일일 실적 ' + db.daily.length + '일, 측정 ' + db.measures.length + '구간.');
    if (location.hash === '#/home') render(); else location.hash = '#/home';
  }

  /* ── 대시보드 ─────────────────────────── */
  function pageHome() {
    var out = [pageHead('대시보드', '한눈에 보기', '목표 대수 대비 달성률 ' + goalPct() + ' 이상을 현재 인원으로 확보하기 위한 현황입니다.')];
    if (!hasData()) {
      out.push(emptyNotice('아직 일일 실적이나 측정 기록이 없습니다.'));
      out.push(stepsCard());
      return out;
    }
    var weeks = L.achieveRows(db.daily, { unit: 'week', settings: db.settings, goal: goal() });
    var last = weeks[weeks.length - 1];
    var tot = L.achieveTotal(db.daily, { settings: db.settings, goal: goal() });
    var mdays = L.measureDays(db.measures), mto = mdays[mdays.length - 1], mfrom = mto ? L.addDays(mto, -13) : '';
    var st = L.processStats(db.measures, db.processes, { from: mfrom, to: mto });
    var la = L.lineAnalysis(st, L.taktInfo(db.daily, { from: mfrom, to: mto, settings: db.settings }));
    var lp = L.lossPareto(db.measures, { from: mfrom, to: mto });
    var top = lp.rows[0];
    out.push(h('div', { class: 'tiles' },
      tile('최근 주 달성률', last ? pct(last.rate) : '-', last ? last.label + ' · ' + last.actual + '/' + last.target + '대' : '', last && last.rate != null ? (last.rate >= goal() ? 'ok' : 'bad') : ''),
      tile('전체 기간 달성률', pct(tot.rate), goalPct() + ' 이상 ' + tot.okDays + '/' + tot.ratedDays + '일', tot.rate != null ? (tot.rate >= goal() ? 'ok' : 'bad') : ''),
      tile('병목공정', la.bottleneck ? shortName(la.bottleneck.name) : '-', la.bottleneck ? '사이클타임 ' + m1(la.maxCt) + '분 · 택트 ' + m1(la.taktMin) + '분 (측정 ' + (mfrom ? mfrom.slice(5) + '~' + mto.slice(5) : '-') + ')' : '측정 기록이 필요합니다', la.bottleneck && la.bottleneck.over ? 'bad' : ''),
      tile('가장 큰 손실', top && top.sec ? top.type : '-', top && top.sec ? '손실의 ' + pct(top.share) + ' · ' + L.fmtN(top.min) + '분' : '측정 기록이 필요합니다')));
    if (weeks.length) out.push(h('section', { class: 'card' }, h('h2', null, '주별 달성률'),
      C.figure('주별 달성률 (' + goalPct() + ' 선)', { type: 'bar', labels: weeks.map(function (w) { return w.key.slice(5).replace('-', '/'); }), unit: '%', minMax: 1, refLines: [{ value: goal(), label: goalPct() }],
        series: [{ name: '달성률', values: weeks.map(function (w) { return w.rate; }), color: 'var(--series-3)', colors: weeks.map(function (w) { return w.rate != null && w.rate < goal() ? 'var(--series-bad)' : 'var(--series-3)'; }) }] }),
      h('p', { class: 'note' }, '빨간 막대는 ' + goalPct() + ' 미만인 주입니다. 자세한 표는 「달성률 관리표」에서 봅니다.')));
    out.push(stepsCard());
    return out;
  }
  function stepsCard() {
    var steps = [
      ['#/daily', '일일 실적', '날짜·목표·실제 대수·인원·가용시간을 입력하거나 엑셀로 가져옵니다.'],
      ['#/process', '공정 설정', '공정 순서·표준시간·담당 인원을 적습니다(표준작업서의 바탕).'],
      ['#/measure', '현장 측정', '2~3일 동안 작업자별·공정별 시작·종료와 손실(자재 준비·이동·대기·재작업·기타)을 잽니다. 휴대폰 스톱워치 또는 종이 측정표.'],
      ['#/analysis', '병목 분석 · 손실 분석', '사이클타임과 택트타임을 비교해 병목공정을 찾고, 손실을 큰 순으로 봅니다.'],
      ['#/sim', '인원 배분', '공정별 인원을 바꿔 보며 같은 인원으로 낼 수 있는 대수를 계산합니다.'],
      ['#/compare', '개선 전·후', '두 기간의 실적·손실·대당 공수와 제작 단가 절감을 비교합니다.'],
      ['#/sop', '표준작업서', '개선된 작업 방법을 표준작업서 초안으로 정리합니다.']
    ];
    return h('section', { class: 'card' }, h('h2', null, '진행 순서'),
      h('ol', { class: 'steps' }, steps.map(function (s) { return h('li', null, h('a', { href: s[0] }, s[1]), ' — ', s[2]); })));
  }

  /* ── 일일 실적 ─────────────────────────── */
  function pageDaily() {
    var cur = ui.editDate ? db.daily.filter(function (r) { return r.date === ui.editDate; })[0] : null;
    var last = db.daily[db.daily.length - 1];
    var dDate = inp({ type: 'date', value: cur ? cur.date : today(), required: true });
    function num(v, step) { return inp({ type: 'number', inputmode: 'decimal', min: '0', step: step || '1', value: v == null ? '' : v }); }
    var dT = num(cur ? cur.target : (db.settings.target != null ? db.settings.target : '')), dA = num(cur ? cur.actual : '');
    var dW = num(cur ? cur.workers : (last && last.workers != null ? last.workers : db.settings.workers)), dH = num(cur ? cur.availHr : (last && last.availHr != null ? last.availHr : db.settings.availHr), '0.1');
    var dN = inp({ value: cur ? cur.note : '', placeholder: '예: 본용접 대기, 자재 늦게 들어옴' });
    var preview = h('p', { class: 'note', 'aria-live': 'polite' });
    function upd() {
      var t = Number(dT.value), a = Number(dA.value);
      preview.textContent = t > 0 && dA.value !== '' ? '달성률 ' + L.fmtPct(a / t) + (a / t >= goal() ? ' — 목표 이상' : ' — ' + goalPct() + ' 미만') + (Number(dH.value) > 0 ? ' · 택트타임 ' + m1(Number(dH.value) * 60 / t) + '분/대' : '') : '';
    }
    [dT, dA, dH].forEach(function (x) { x.addEventListener('input', upd); }); upd();
    function submit(e) {
      e.preventDefault();
      if (!dDate.value) { toast('일자를 넣어 주세요.', true); return; }
      if (dT.value === '' && dA.value === '') { toast('목표 또는 실제 대수를 넣어 주세요.', true); return; }
      var exists = db.daily.some(function (r) { return r.date === dDate.value; });
      if (exists && dDate.value !== ui.editDate && !confirm(dDate.value + ' 실적이 이미 있습니다. 새 값으로 바꿀까요?')) return;
      db.daily = L.mergeDaily(db.daily, [{ date: dDate.value, target: dT.value, actual: dA.value, workers: dW.value, availHr: dH.value, note: dN.value }]).records;
      db.sample = false;
      ui.editDate = '';
      save(); toast(dDate.value + ' 실적을 저장했습니다.'); render();
    }
    var form = h('form', { class: 'card', onsubmit: submit }, h('h2', null, cur ? cur.date + ' 실적 고치기' : '현장 실적 입력'),
      h('div', { class: 'form-grid' },
        fld('일자', dDate), fld('목표 대수', dT, '그날 목표 실적 대수'), fld('실제 생산 대수', dA),
        fld('투입 인원(명)', dW, '그날 실제로 일한 인원'), fld('가용시간(HR)', dH, '하루 실작업 가능시간(휴식 제외)'), fld('비고·지연 사유', dN)),
      preview,
      h('div', { class: 'btn-row' }, h('button', { type: 'submit', class: 'btn btn-primary' }, '저장'),
        cur ? h('button', { type: 'button', class: 'btn', onclick: function () { ui.editDate = ''; render(); } }, '고치기 취소') : null));
    var rows = db.daily.slice().reverse().map(function (r) {
      var rt = r.target > 0 && r.actual != null ? r.actual / r.target : null;
      return { cls: rt != null && rt < goal() ? 'below' : null, tdCls: { 4: rt == null ? '' : rt >= goal() ? 'ok' : 'bad' }, cells: [L.dayLabel(r.date) + ' ' + r.date.slice(0, 4), r.target == null ? '-' : r.target, r.actual == null ? '-' : r.actual,
        r.actual != null && r.target != null ? r.actual - r.target : '-', pct(rt), r.workers == null ? '-' : r.workers, r.availHr == null ? '-' : r.availHr, r.note || '',
        h('span', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { ui.editDate = r.date; render(); window.scrollTo(0, 0); } }, '고치기'),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: function () { if (confirm(r.date + ' 실적을 지울까요?')) { db.daily = db.daily.filter(function (x) { return x.date !== r.date; }); save(); render(); } } }, '지우기'))] };
    });
    return [
      pageHead('데이터', '일일 실적', '날짜마다 목표 대수·실제 생산 대수·투입 인원·가용시간을 기록합니다. 같은 날짜를 다시 넣으면 새 값으로 바뀝니다.'),
      form,
      importCard('daily'),
      h('section', { class: 'card' }, h('h2', null, '쌓인 일일 실적 (' + db.daily.length + '일)'),
        h('div', { class: 'btn-row', style: 'margin-bottom:10px' },
          h('button', { type: 'button', class: 'btn', onclick: function () { writeXlsx('프레임_일일실적_양식.xlsx', [{ name: '일일 실적', aoa: [L.DAILY_FIELDS.map(function (f) { return f.label; })] }]); } }, '빈 엑셀 양식 받기'),
          db.daily.length ? h('button', { type: 'button', class: 'btn', onclick: function () {
            writeXlsx('프레임_일일실적_' + today() + '.xlsx', [{ name: '일일 실적', aoa: [L.DAILY_FIELDS.map(function (f) { return f.label; })].concat(db.daily.map(function (r) { return [r.date, r.target, r.actual, r.workers, r.availHr, r.note]; })) }]);
          } }, '엑셀로 내려받기') : null),
        db.daily.length ? table(['일자', '목표', '실제', '차이', '달성률', '인원', '가용(HR)', '비고', ''], rows, { num: [0, 1, 1, 1, 1, 1, 1, 0, 0] }) : h('p', { class: 'note' }, '아직 없습니다.'))
    ];
  }

  /* ── 달성률 관리표 ─────────────────────── */
  function pageAchieve() {
    if (!db.daily.length) return [pageHead('관리', '달성률 관리표'), emptyNotice('아직 일일 실적이 없습니다.')];
    var p = period();
    var rows = L.achieveRows(db.daily, { unit: ui.unit, from: p.from, to: p.to, settings: db.settings, goal: goal() });
    var tot = L.achieveTotal(db.daily, { from: p.from, to: p.to, settings: db.settings, goal: goal() });
    function vb(id, label) { return h('button', { type: 'button', 'aria-pressed': ui.unit === id ? 'true' : 'false', onclick: function () { ui.unit = id; render(); } }, label); }
    var labels = rows.map(function (r) { return ui.unit === 'day' ? r.key.slice(5).replace('-', '/') : ui.unit === 'week' ? r.key.slice(5).replace('-', '/') + '주' : Number(r.key.slice(5)) + '월'; });
    var trows = rows.map(function (r) {
      var below = r.rate != null && r.rate < goal();
      return { cls: below ? 'below' : null, tdCls: { 5: r.rate == null ? '' : below ? 'bad' : 'ok' }, cells: [r.label, r.days, r.target, r.actual, r.gap, pct(r.rate), r.okDays + '/' + r.ratedDays,
        r.workers == null ? '-' : r.workers, r.availHr == null ? '-' : r.availHr, r.perUnitManHr == null ? '-' : L.fmtN(r.perUnitManHr, 2), r.taktMin == null ? '-' : m1(r.taktMin), r.notes.join(' / ')] };
    });
    trows.push({ cls: 'sum', cells: ['합계·평균', tot.days, tot.target, tot.actual, tot.gap, pct(tot.rate), tot.okDays + '/' + tot.ratedDays, tot.workers == null ? '-' : tot.workers, tot.availHr == null ? '-' : tot.availHr,
      tot.perUnitManHr == null ? '-' : L.fmtN(tot.perUnitManHr, 2), tot.taktMin == null ? '-' : m1(tot.taktMin), ''] });
    return [
      pageHead('관리', '달성률 관리표', '목표 실적 대수 대비 실제 생산 대수 — 일·주·월로 묶어 ' + goalPct() + ' 선과 비교합니다.',
        h('div', { class: 'btn-row no-print' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var o = { from: p.from, to: p.to, settings: db.settings, goal: goal() };
            writeXlsx('프레임_달성률관리표_' + p.from + '_' + p.to + '.xlsx', ['day', 'week', 'month'].map(function (u) {
              return { name: u === 'day' ? '일별' : u === 'week' ? '주별' : '월별', aoa: L.achieveToAoa(L.achieveRows(db.daily, Object.assign({ unit: u }, o)), u) };
            }));
          } }, '엑셀로 내려받기'),
          h('button', { type: 'button', class: 'btn', onclick: function () { window.print(); } }, '인쇄'))),
      periodBar(h('div', { class: 'span-all' }, h('div', { class: 'view-toggle', role: 'group', 'aria-label': '묶는 단위' }, vb('day', '일'), vb('week', '주'), vb('month', '월')))),
      h('div', { class: 'tiles' },
        tile('달성률', pct(tot.rate), tot.actual + ' / ' + tot.target + '대', tot.rate != null ? (tot.rate >= goal() ? 'ok' : 'bad') : ''),
        tile(goalPct() + ' 이상인 날', tot.okDays + ' / ' + tot.ratedDays + '일'),
        tile('하루 평균 실제 대수', tot.days ? L.fmtN(tot.actual / tot.days, 1) + '대' : '-', '목표 평균 ' + (tot.days ? L.fmtN(tot.target / tot.days, 1) : '-') + '대'),
        tile('대당 투입공수', tot.perUnitManHr == null ? '-' : L.fmtN(tot.perUnitManHr, 2) + '인·시', '인원 × 가용시간 ÷ 실제 대수')),
      h('div', { class: 'charts' },
        C.figure('목표 대수와 실제 생산 대수', { type: 'bar', labels: labels, unit: '대', series: [
          { name: '목표', values: rows.map(function (r) { return r.target; }), color: 'var(--series-plan)' },
          { name: '실제', values: rows.map(function (r) { return r.actual; }), color: 'var(--series-1)' }] }),
        C.figure('달성률 (' + goalPct() + ' 선)', { type: 'bar', labels: labels, unit: '%', minMax: 1, refLines: [{ value: goal(), label: goalPct() }], series: [
          { name: '달성률', values: rows.map(function (r) { return r.rate; }), color: 'var(--series-3)', colors: rows.map(function (r) { return r.rate != null && r.rate < goal() ? 'var(--series-bad)' : 'var(--series-3)'; }) }] })),
      h('section', { class: 'card' }, h('h2', null, (ui.unit === 'day' ? '일별' : ui.unit === 'week' ? '주별' : '월별') + ' 달성률 관리표'),
        table(['기간', '일수', '목표', '실제', '차이', '달성률', goalPct() + '↑ 일수', '평균 인원', '평균 가용(HR)', '대당 투입공수(인·시)', '택트(분/대)', '비고'], trows, { num: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0] }),
        tot.filled ? h('p', { class: 'note' }, '인원·가용시간이 빈 날은 설정의 기본값(' + db.settings.workers + '명 · ' + db.settings.availHr + '시간)으로 계산했습니다.') : null,
        h('p', { class: 'note' }, '달성률 = 실제 대수 합 ÷ 목표 대수 합. 대당 투입공수 = (인원 × 가용시간)의 합 ÷ 실제 대수 합 — 손실까지 들어간 실제 값입니다.'))
    ];
  }

  /* ── 공정 설정 ─────────────────────────── */
  function pageProcess() {
    var list = L.sortProcesses(db.processes);
    var draft = list.map(function (p) { return Object.assign({ _old: p.name }, p); });
    var tk = L.taktInfo(db.daily, { settings: db.settings });
    function card(p, i) {
      function num(k, step) { var e = inp({ type: 'number', min: '0', step: step || '1', value: p[k] == null ? '' : p[k], inputmode: 'decimal' }); e.addEventListener('input', function () { p[k] = e.value; }); return e; }
      function txt(k, ph) { var e = h('textarea', { rows: '2', placeholder: ph || '' }); e.value = p[k] || ''; e.addEventListener('input', function () { p[k] = e.value; }); return e; }
      var name = inp({ value: p.name }); name.addEventListener('input', function () { p.name = name.value; });
      var ct = p.stdMin != null && p.workers > 0 ? p.stdMin / p.workers : null;
      return h('div', { class: 'proc-card' },
        h('div', { class: 'head' }, h('strong', null, (i + 1) + '. ' + p.name),
          ct != null ? h('span', { class: 'badge ' + (tk.taktMin && ct > tk.taktMin ? 'over' : 'muted') }, '표준 사이클타임 ' + m1(ct) + '분' + (tk.taktMin && ct > tk.taktMin ? ' — 택트 초과' : '')) : null,
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: function () {
            if (!confirm(p.name + ' 공정을 지울까요? (측정 기록은 남습니다)')) return;
            draft = draft.filter(function (x) { return x !== p; });
            if (saveAll(true)) render();
          } }, '지우기')),
        h('div', { class: 'form-grid' },
          fld('순서', num('seq')), fld('공정 이름', name), fld('담당 인원(명)', num('workers')),
          fld('표준 공수(인·분/대)', num('stdMin', '0.1'), '한 대에 이 공정에서 드는 사람 시간의 합. 모르면 비워 두고 측정 후 채웁니다.'),
          fld('작업 요점', txt('points', '작업 순서·요령'), null, 'span-all'), fld('품질 주의', txt('quality')), fld('안전 주의', txt('safety'))));
    }
    var box = h('div');
    draft.forEach(function (p, i) { box.appendChild(card(p, i)); });
    function saveAll(quiet) {
      var renamed = 0;
      var cleaned = draft.map(function (p, i) { return { old: p._old, p: L.cleanProcess(p, i) }; });
      var names = cleaned.map(function (x) { return L.norm(x.p.name); });
      if (names.some(function (n, i) { return names.indexOf(n) !== i; })) { toast('공정 이름이 겹칩니다. 이름을 다르게 해 주세요.', true); return false; }
      cleaned.forEach(function (x) {
        if (x.old && x.old !== x.p.name) db.measures.forEach(function (m) { if (L.norm(m.process) === L.norm(x.old)) { m.process = x.p.name; renamed++; } });
      });
      db.processes = L.sortProcesses(cleaned.map(function (x) { return x.p; }));
      save();
      if (!quiet) { toast('공정 설정을 저장했습니다.' + (renamed ? ' 측정 기록 ' + renamed + '행의 공정 이름도 바꿨습니다.' : '')); render(); }
      return true;
    }
    var total = list.reduce(function (s, p) { return s + (p.workers || 0); }, 0);
    var stdLa = L.lineAnalysis(L.processStats([], list), tk, { source: 'standard' });
    return [
      pageHead('설정', '공정 설정', '프레임 제작 공정의 순서·표준시간·담당 인원을 적습니다. 병목 분석의 「표준」 기준, 인원 배분 시뮬레이터, 표준작업서가 이 값을 씁니다.'),
      h('div', { class: 'tiles' },
        tile('공정 수', list.length + '개'), tile('담당 인원 합', total + '명', '현재 인원 ' + (db.settings.workers != null ? db.settings.workers + '명(설정)' : '-')),
        tile('택트타임', tk.taktMin == null ? '-' : m1(tk.taktMin) + '분/대', tk.source),
        tile('표준 기준 병목', stdLa.bottleneck ? shortName(stdLa.bottleneck.name) : '-', stdLa.bottleneck ? '사이클타임 ' + m1(stdLa.maxCt) + '분' : '표준 공수를 넣어 주세요', stdLa.bottleneck && stdLa.bottleneck.over ? 'bad' : '')),
      h('section', { class: 'card' }, h('h2', null, '공정 ' + list.length + '개'),
        list.length ? null : h('p', { class: 'note' }, '아직 공정이 없습니다. 「공정 더하기」로 순서대로 넣거나, 측정 기록을 가져오면 기록의 공정 이름으로 자동으로 생깁니다.'),
        box,
        h('div', { class: 'btn-row submit-bar' },
          h('button', { type: 'button', class: 'btn', onclick: function () {
            if (!saveAll(true)) return; // 고치던 값을 먼저 담고
            var n = db.processes.length;
            db.processes = L.sortProcesses(db.processes.concat([L.cleanProcess({ id: 'p' + Date.now(), name: '새 공정 ' + (n + 1), seq: n + 1, workers: 1 }, n)]));
            save(); render();
          } }, '공정 더하기'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { saveAll(false); } }, '저장'))),
      h('p', { class: 'note' }, '사이클타임 = 표준 공수 ÷ 담당 인원 — 작업을 인원끼리 나눌 수 있다고 보는 단순 모델입니다. 한 사람만 할 수 있는 작업이 있으면 기획서 10장에 적어 확인합니다.')
    ];
  }

  /* ── 현장 측정 ─────────────────────────── */
  var swTimer = null;
  function workers() { return db.measures.map(function (m) { return m.worker; }).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(); }
  function pressKind(kind) {
    if (!ui.sw.process) { toast('공정을 먼저 골라 주세요.', true); return; }
    var r = L.swSwitch(db.running, kind, Date.now(), { worker: ui.sw.worker, process: ui.sw.process, unit: ui.sw.unit });
    keepClosed(r.closed); db.running = r.state; save(); render();
  }
  function pressNext() {
    if (!db.running) { toast('측정 중이 아닙니다.', true); return; }
    var r = L.swNextUnit(Object.assign({}, db.running, { worker: ui.sw.worker, process: ui.sw.process }), Date.now());
    keepClosed(r.closed); db.running = r.state; ui.sw.unit = r.state.unit; save(); render();
  }
  function pressStop() {
    var r = L.swStop(db.running, Date.now());
    keepClosed(r.closed); db.running = null; save(); render();
  }
  function keepClosed(seg) {
    if (!seg) return;
    db.measures = L.mergeMeasures(db.measures, [seg]).records;
    db.sample = false;
    ui.lastSeg = L.measureKey(seg);
  }
  function stopwatchCard() {
    var procs = L.sortProcesses(db.processes);
    if (!ui.sw.process && procs.length) ui.sw.process = db.running ? db.running.process : procs[0].name;
    if (db.running) { ui.sw.worker = ui.sw.worker || db.running.worker; ui.sw.unit = db.running.unit || ui.sw.unit; }
    var wIn = inp({ value: ui.sw.worker, list: 'workerList', placeholder: '예: 작업자A', autocomplete: 'off' });
    wIn.addEventListener('input', function () { ui.sw.worker = wIn.value; });
    var dl = h('datalist', { id: 'workerList' }, workers().map(function (w) { return h('option', { value: w }); }));
    var pSel = h('select');
    procs.forEach(function (p) { var o = h('option', { value: p.name }, p.seq + '. ' + p.name); if (p.name === ui.sw.process) o.selected = true; pSel.appendChild(o); });
    pSel.addEventListener('change', function () { ui.sw.process = pSel.value; });
    var uIn = inp({ value: ui.sw.unit, inputmode: 'numeric' });
    uIn.addEventListener('input', function () { ui.sw.unit = uIn.value; });
    var run = db.running;
    var timeEl = h('span', { class: 'sw-time', id: 'swTime' }, run ? L.fmtDur((Date.now() - run.startMs) / 1000) : '0:00');
    clearInterval(swTimer);
    if (run) swTimer = setInterval(function () { var e = document.getElementById('swTime'); if (!e || !db.running) { clearInterval(swTimer); return; } e.textContent = L.fmtDur((Date.now() - db.running.startMs) / 1000); }, 1000);
    function kbtn(kind, cls) { return h('button', { type: 'button', class: 'btn ' + (cls || ''), 'aria-pressed': run && run.kind === kind ? 'true' : 'false', onclick: function () { pressKind(kind); } }, kind); }
    var recent = db.measures.filter(function (m) { return m.date === today(); }).slice(-5).reverse();
    return h('section', { class: 'card' }, h('h2', null, '스톱워치 측정 (휴대폰)'),
      procs.length ? null : h('p', { class: 'alert warn' }, '공정 설정에 공정이 없습니다. 먼저 ', h('a', { href: '#/process' }, '공정 설정'), '에서 공정을 넣어 주세요.'),
      h('div', { class: 'form-grid' }, fld('작업자', [wIn, dl], '이름 대신 「작업자A」처럼 적어도 됩니다'), fld('공정', pSel),
        fld('대 번호', h('div', { class: 'unit-row' }, uIn, h('button', { type: 'button', class: 'btn', onclick: function () { ui.sw.unit = L.nextUnit(uIn.value); uIn.value = ui.sw.unit; } }, '+1')), '같은 날 같은 번호 = 같은 프레임')),
      h('div', { class: 'sw' + (run ? ' running' : ''), style: 'margin-top:12px' },
        h('div', { class: 'sw-status', 'aria-live': 'polite' },
          h('span', { class: 'sw-kind' }, run ? run.kind + ' 중' : '측정 전 — 아래 단추로 시작'), timeEl,
          run ? h('span', { class: 'sw-ctx' }, (run.worker || '(작업자 없음)') + ' · ' + run.process + ' · ' + (run.unit || '-') + '번 대 · ' + L.localHms(run.startMs) + ' 부터') : null),
        h('div', { class: 'sw-grid' },
          h('button', { type: 'button', class: 'btn btn-primary wide', 'aria-pressed': run && run.kind === '작업' ? 'true' : 'false', onclick: function () { pressKind('작업'); } }, run && run.kind === '작업' ? '작업 중 (다시 누르면 새 구간)' : '작업 시작'),
          kbtn('자재 준비', 'btn-loss'), kbtn('이동', 'btn-loss'), kbtn('대기', 'btn-wait'), kbtn('재작업', 'btn-loss'), kbtn('기타', 'btn-loss'),
          h('button', { type: 'button', class: 'btn', disabled: !run, onclick: pressNext }, '다음 대'),
          h('button', { type: 'button', class: 'btn btn-danger half', disabled: !run, onclick: pressStop }, '멈춤(기록 끝)'))),
      h('ul', { class: 'note' },
        h('li', null, '단추를 누를 때마다 앞 구간을 닫고 새 구간을 엽니다. 작업 중에 자재를 찾으러 가면 「자재 준비」, 돌아와 다시 일하면 「작업」을 누릅니다.'),
        h('li', null, '「다음 대」는 지금 구간을 닫고 대 번호를 하나 올려 작업으로 시작합니다. 화면을 닫거나 새로 고쳐도 측정 중인 구간은 이어집니다.'),
        h('li', null, '한 휴대폰으로 한 사람을 잽니다. 여러 사람을 같이 잴 때는 사람마다 휴대폰을 쓰거나 종이 측정표를 씁니다.')),
      recent.length ? h('div', null, h('h3', null, '오늘 방금 기록한 구간'), h('ul', { class: 'recent' }, recent.map(function (m) {
        var memo = inp({ value: m.memo, placeholder: '메모(예: 브래킷 찾기)', 'aria-label': '메모' });
        memo.addEventListener('change', function () { m.memo = memo.value.trim(); save(); toast('메모를 저장했습니다.'); });
        return h('li', null, m.start + '~' + m.end + ' · ' + (m.worker || '-') + ' · ' + m.process + ' · ' + (m.unit || '-') + '번 · ', h('strong', null, m.kind), ' ' + L.fmtDur(m.sec) + ' ', memo);
      }))) : null);
  }
  function manualCard() {
    var procs = L.sortProcesses(db.processes);
    var d = inp({ type: 'date', value: today() }), w = inp({ list: 'workerList2' }), u = inp({ value: '1' }), s = inp({ type: 'time', step: '1' }), e = inp({ type: 'time', step: '1' }), memo = inp();
    var dl = h('datalist', { id: 'workerList2' }, workers().map(function (x) { return h('option', { value: x }); }));
    var p = h('select', null, procs.map(function (x) { return h('option', { value: x.name }, x.seq + '. ' + x.name); }));
    var k = h('select', null, L.KINDS.map(function (x) { return h('option', { value: x }, x); }));
    return h('details', { class: 'card' }, h('summary', null, '손으로 한 행 넣기 (종이 측정표 옮겨 적기)'),
      h('div', { class: 'form-grid', style: 'margin-top:10px' }, fld('측정일', d), fld('작업자', [w, dl]), fld('공정', p), fld('대 번호', u), fld('구분', k), fld('시작', s), fld('종료', e), fld('메모', memo, null, 'span-all')),
      h('div', { class: 'btn-row', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        var c = L.cleanMeasure({ date: d.value, worker: w.value, process: p.value, unit: u.value, kind: k.value, start: s.value, end: e.value, memo: memo.value });
        if (!c) { toast('측정일·공정·구분·시작·종료를 모두 넣어 주세요.', true); return; }
        keepClosed(c); save(); toast('한 행을 더했습니다(' + L.fmtDur(c.sec) + ').');
        s.value = e.value; e.value = ''; memo.value = '';
      } }, '더하기')));
  }
  function blankSheetHtml() {
    var procs = L.sortProcesses(db.processes).map(function (p) { return p.seq + '.' + p.name; }).join('  ');
    var rows = '';
    for (var i = 1; i <= 22; i++) rows += '<tr><td>' + i + '</td><td></td><td class="kinds">작업 · 자재 · 이동 · 대기 · 재작업 · 기타</td><td>:</td><td>:</td><td></td></tr>';
    return '<div class="blank-sheet"><h1>프레임 제작 현장 측정표</h1>' +
      '<div class="meta"><span>측정일:</span><span>측정자:</span><span>작업자:</span><span>공정:</span><span>쪽: &nbsp;&nbsp;/</span><span></span></div>' +
      '<table><thead><tr><th style="width:6%">No</th><th style="width:10%">대 번호</th><th style="width:36%">구분 (하나에 ○)</th><th style="width:11%">시작</th><th style="width:11%">종료</th><th>메모(손실 사유)</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="foot">구분: 작업 = 순작업 · 자재 = 자재 준비(찾기·가져오기) · 이동 = 사람·물건 옮기기 · 대기 = 앞 공정·설비·지시를 기다림 · 재작업 = 불량 고치기 · 기타.<br>' +
      '구분이 바뀔 때마다 한 줄씩, 시작·종료는 시:분(가능하면 초까지). 옮겨 적을 때는 이 도구의 「손으로 한 행 넣기」 또는 「빈 측정표 엑셀」에 적어 가져오기.' +
      (procs ? '<br>공정: ' + procs.replace(/</g, '&lt;') : '') + '</p></div>';
  }
  function printBlank() {
    var ps = document.getElementById('printSheet');
    ps.innerHTML = blankSheetHtml();
    document.body.classList.add('print-sheet');
    function done() { document.body.classList.remove('print-sheet'); window.removeEventListener('afterprint', done); }
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);
  }
  function pageMeasure() {
    var days = L.measureDays(db.measures);
    if (ui.measDay && days.indexOf(ui.measDay) < 0) ui.measDay = '';
    var daySel = h('select', { 'aria-label': '측정일' }, h('option', { value: '' }, '모든 날 (' + db.measures.length + '행)'));
    days.slice().reverse().forEach(function (d) { var o = h('option', { value: d }, d + ' (' + db.measures.filter(function (m) { return m.date === d; }).length + '행)'); if (d === ui.measDay) o.selected = true; daySel.appendChild(o); });
    daySel.addEventListener('change', function () { ui.measDay = daySel.value; render(); });
    var list = db.measures.filter(function (m) { return !ui.measDay || m.date === ui.measDay; });
    var shown = list.slice(-300).reverse();
    return [
      pageHead('측정', '현장 측정', '작업자별·공정별로 시작·종료 시각과 손실 유형(자재 준비·이동·대기·재작업·기타)을 잽니다. 공정별 시간이 없으면 2~3일 측정부터 시작합니다.'),
      stopwatchCard(),
      h('section', { class: 'card' }, h('h2', null, '종이 측정표'),
        h('p', { class: 'note' }, '휴대폰을 쓰기 어려운 자리는 종이에 적고, 나중에 「손으로 한 행 넣기」나 엑셀로 옮깁니다. 빈 측정표 엑셀은 가져오기 열 이름과 같습니다.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: printBlank }, '빈 측정표 인쇄'),
          h('button', { type: 'button', class: 'btn', onclick: function () {
            var head = L.MEASURE_FIELDS.map(function (f) { return f.label.replace(/\(.*\)/, ''); });
            var aoa = [head]; for (var i = 0; i < 30; i++) aoa.push(['', '', '', '', '', '', '', '']);
            writeXlsx('프레임_현장측정표_빈양식.xlsx', [{ name: '측정 기록', aoa: aoa }, { name: '작성 방법', aoa: [['칸', '적는 법'], ['측정일', '2026-10-20 처럼. 같은 날이면 첫 행에만 적어도 됩니다'], ['작업자', '이름 또는 작업자A'], ['공정', '공정 설정의 이름과 같게'], ['대 번호', '같은 날 같은 번호 = 같은 프레임'], ['구분', '작업 · 자재 준비 · 이동 · 대기 · 재작업 · 기타'], ['시작·종료', '09:12 또는 09:12:30'], ['메모', '손실 사유 등']] }]);
          } }, '빈 측정표 엑셀 받기'))),
      manualCard(),
      importCard('measure'),
      h('section', { class: 'card' }, h('h2', null, '측정 기록'),
        h('div', { class: 'filters', style: 'margin-bottom:10px' }, fld('측정일', daySel),
          h('div', { class: 'btn-row' },
            db.measures.length ? h('button', { type: 'button', class: 'btn', onclick: function () {
              writeXlsx('프레임_현장측정_' + today() + '.xlsx', [{ name: '측정 기록', aoa: [['측정일', '작업자', '공정', '대 번호', '구분', '시작', '종료', '시간(초)', '메모']].concat(db.measures.map(function (m) { return [m.date, m.worker, m.process, m.unit, m.kind, m.start, m.end, m.sec, m.memo]; })) }]);
            } }, '엑셀로 내려받기') : null,
            ui.measDay ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
              if (!confirm(ui.measDay + ' 측정 기록 ' + list.length + '행을 지울까요?')) return;
              db.measures = db.measures.filter(function (m) { return m.date !== ui.measDay; }); ui.measDay = ''; save(); render();
            } }, '이 날 기록 지우기') : null)),
        list.length ? table(['측정일', '작업자', '공정', '대', '구분', '시작', '종료', '시간', '메모', ''], shown.map(function (m) {
          return { cls: L.measureKey(m) === ui.lastSeg ? 'differs' : null, cells: [m.date.slice(5), m.worker || '-', m.process, m.unit || '-', m.kind === '작업' ? m.kind : h('span', { class: 'badge ' + (m.kind === '대기' ? 'over' : 'bn') }, m.kind), m.start, m.end, L.fmtDur(m.sec), m.memo,
            h('button', { type: 'button', class: 'btn btn-sm btn-danger', 'aria-label': '이 행 지우기', onclick: function () { var k = L.measureKey(m); db.measures = db.measures.filter(function (x) { return L.measureKey(x) !== k; }); save(); render(); } }, '지우기')] };
        }), { num: [0, 0, 0, 0, 0, 1, 1, 1, 0, 0] }) : h('p', { class: 'note' }, '아직 없습니다.'),
        list.length > shown.length ? h('p', { class: 'note' }, '최근 ' + shown.length + '행만 보입니다. 전체는 엑셀로 내려받아 보세요.') : null)
    ];
  }

  /* ── 병목 분석 ─────────────────────────── */
  function analysisData(p) {
    var st = L.processStats(db.measures, db.processes, { from: p.from, to: p.to });
    var tk = L.taktInfo(db.daily, { from: p.from, to: p.to, settings: db.settings });
    return { st: st, tk: tk, la: L.lineAnalysis(st, tk, { source: ui.src }) };
  }
  function analysisAoa(la, st) {
    var out = [['순서', '공정', '인원', '측정 대 수', '대당 순작업 공수(인·분)', '대당 손실(인·분)', '사이클타임(분/대)', '손실 포함 CT(참고)', '표준 CT', '택트타임', '택트 대비', '판정']];
    la.rows.forEach(function (r) {
      var s = st.rows.filter(function (x) { return x.name === r.name; })[0] || {};
      out.push([r.seq === 999 ? '' : r.seq, r.name, r.workers == null ? '' : L.round(r.workers, 2), r.units, r.workMin == null ? '' : L.round(r.workMin, 1), r.lossMin == null ? '' : L.round(r.lossMin, 1),
        r.ct == null ? '' : L.round(r.ct, 1), r.ctAll == null ? '' : L.round(r.ctAll, 1), s.stdCt == null ? '' : L.round(s.stdCt, 1), la.taktMin == null ? '' : L.round(la.taktMin, 1),
        r.ratio == null ? '' : L.round(r.ratio * 100, 0) + '%', r.isBottleneck ? '병목' : r.over ? '택트 초과' : r.ct == null ? '자료 없음' : '여유']);
    });
    return out;
  }
  function pageAnalysis() {
    if (!db.processes.length && !db.measures.length) return [pageHead('분석', '병목 분석'), emptyNotice('공정 설정이나 측정 기록이 없습니다.')];
    var p = period(), A = analysisData(p), la = A.la, st = A.st, tk = A.tk;
    function sb(id, label) { return h('button', { type: 'button', 'aria-pressed': ui.src === id ? 'true' : 'false', onclick: function () { ui.src = id; render(); } }, label); }
    var withCt = la.rows.filter(function (r) { return r.ct != null; });
    var trows = la.rows.map(function (r) {
      var s = st.rows.filter(function (x) { return x.name === r.name; })[0] || {};
      var verdict = r.isBottleneck ? h('span', { class: 'badge bn' }, '병목') : r.over ? h('span', { class: 'badge over' }, '택트 초과') : r.ct == null ? h('span', { class: 'badge muted' }, '자료 없음') : h('span', { class: 'badge ok' }, '여유');
      return { cls: r.isBottleneck ? 'bn' : null, cells: [r.name, r.workers == null ? '-' : L.fmtN(r.workers, 1), r.units || '-', m1(r.workMin), m1(r.lossMin), m1(r.ct), m1(r.ctAll), m1(s.stdCt), r.ratio == null ? '-' : L.fmtN(r.ratio * 100) + '%', verdict] };
    });
    return [
      pageHead('분석', '병목 분석', '공정별 사이클타임(대당 공수 ÷ 인원)을 택트타임(가용시간 ÷ 목표 대수)과 비교해 생산량을 막는 공정을 찾습니다.',
        h('div', { class: 'btn-row no-print' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          writeXlsx('프레임_공정별작업시간분석_' + (p.from || '') + '_' + (p.to || '') + '.xlsx', [{ name: '공정별 분석', aoa: analysisAoa(la, st) }]);
        } }, '엑셀로 내려받기'), h('button', { type: 'button', class: 'btn', onclick: function () { window.print(); } }, '인쇄'))),
      periodBar(h('div', { class: 'span-all' }, h('div', { class: 'view-toggle', role: 'group', 'aria-label': '기준' }, sb('measured', '측정(실측)'), sb('standard', '표준(공정 설정)')))),
      ui.src === 'measured' && !st.count ? h('p', { class: 'alert info' }, '이 기간에 측정 기록이 없습니다. 「현장 측정」에서 재거나 기간을 넓혀 주세요. 지금은 표준(공정 설정) 기준으로도 볼 수 있습니다.') : null,
      h('div', { class: 'tiles' },
        tile('택트타임', tk.taktMin == null ? '-' : m1(tk.taktMin) + '분/대', tk.source + (tk.target ? ' · 목표 ' + L.fmtN(tk.target, 1) + '대/일' : '')),
        tile('병목공정', la.bottleneck ? shortName(la.bottleneck.name) : '-', la.bottleneck ? '사이클타임 ' + m1(la.maxCt) + '분' + (la.bottleneck.over ? ' — 택트 초과' : '') : '', la.bottleneck && la.bottleneck.over ? 'bad' : ''),
        tile('병목 기준 하루 최대', la.capacity == null ? '-' : L.fmtN(la.capacity, 1) + '대', '예상 달성률 ' + pct(la.expectedRate), la.expectedRate != null ? (la.expectedRate >= goal() ? 'ok' : 'bad') : ''),
        tile('라인 밸런스 효율', pct(la.balance), '사이클타임 합 ÷ (공정 수 × 가장 긴 사이클타임)')),
      withCt.length ? h('section', { class: 'card' }, h('h2', null, '라인 밸런스 — 공정별 사이클타임과 택트타임'),
        C.figure('사이클타임(분/대)', { type: 'bar', labels: la.rows.map(function (r) { return shortName(r.name); }), unit: '분', refLines: la.taktMin ? [{ value: la.taktMin, label: '택트 ' + m1(la.taktMin) + '분' }] : [],
          series: [{ name: ui.src === 'standard' ? '표준 사이클타임' : '순작업 사이클타임', values: la.rows.map(function (r) { return r.ct; }), color: 'var(--series-1)', colors: la.rows.map(function (r) { return r.over ? 'var(--series-bad)' : 'var(--series-1)'; }) }]
            .concat(ui.src === 'measured' ? [{ name: '손실 포함(참고)', values: la.rows.map(function (r) { return r.ctAll; }), color: 'var(--series-plan)' }] : []) }),
        h('p', { class: 'note' }, '빨간 막대는 택트타임(점선)보다 긴 공정입니다. 그 공정이 하루에 낼 수 있는 대수가 목표보다 적습니다.')) : null,
      h('section', { class: 'card' }, h('h2', null, '공정별 작업시간 분석표'),
        table(['공정', '인원', '측정 대', '대당 순작업(인·분)', '대당 손실(인·분)', '사이클타임', '손실 포함', '표준 CT', '택트 대비', '판정'], trows, { num: [0, 1, 1, 1, 1, 1, 1, 1, 1, 0] }),
        st.rows.some(function (r) { return r.measuredWorkers != null && Math.abs(r.measuredWorkers - Math.round(r.measuredWorkers)) > 0.01; })
          ? h('p', { class: 'alert info' }, '이 기간에는 인원 배치가 다른 날의 측정이 섞여 있습니다(측정 인원이 소수로 나옴). 위의 「개선 전」「개선 후」처럼 배치가 같은 기간으로 나눠 보면 더 정확합니다.') : null,
        st.noUnit ? h('p', { class: 'alert warn' }, '대 번호가 빈 작업 구간 ' + st.noUnit + '개는 1구간을 1대로 셌습니다. 대 번호를 적으면 더 정확합니다.') : null,
        h('ul', { class: 'note' },
          h('li', null, '판정은 손실을 뺀 순작업 사이클타임으로 합니다. 「대기」는 병목 앞뒤 공정에서 병목 때문에 생기는 결과일 때가 많아, 손실 포함 값은 참고로만 보여 줍니다.'),
          h('li', null, '측정 인원 = 그 공정에서 하루에 기록된 작업자 수의 평균입니다. 측정하지 않은 공정은 공정 설정의 인원을 씁니다.'),
          h('li', null, '하루 최대 대수 = 가용시간 ÷ 병목 사이클타임 — 손실이 전혀 없을 때의 상한입니다. 실제 대수와의 차이가 손실입니다.')))
    ];
  }

  /* ── 손실 분석 ─────────────────────────── */
  function pageLoss() {
    if (!db.measures.length) return [pageHead('분석', '손실 분석'), emptyNotice('아직 측정 기록이 없습니다.')];
    var p = period();
    var procSel = h('select', { 'aria-label': '공정' }, h('option', { value: '' }, '모든 공정'));
    L.sortProcesses(db.processes).forEach(function (x) { var o = h('option', { value: x.name }, x.name); if (x.name === ui.lossProc) o.selected = true; procSel.appendChild(o); });
    procSel.addEventListener('change', function () { ui.lossProc = procSel.value; render(); });
    var lp = L.lossPareto(db.measures, { from: p.from, to: p.to, process: ui.lossProc });
    var st = L.processStats(db.measures, db.processes, { from: p.from, to: p.to });
    var mtx = L.lossMatrix(db.measures, ui.lossBy, { from: p.from, to: p.to, processes: db.processes });
    var units = st.rows.reduce(function (m, r) { return Math.max(m, r.units); }, 0);
    var workAll = st.rows.reduce(function (s, r) { return s + r.workSec; }, 0) / 60;
    var top = lp.rows[0];
    function bb(id, label) { return h('button', { type: 'button', 'aria-pressed': ui.lossBy === id ? 'true' : 'false', onclick: function () { ui.lossBy = id; render(); } }, label); }
    // 메모 — 유형별로 자주 나온 사유
    var memos = {};
    db.measures.forEach(function (m) { if (L.isLoss(m.kind) && m.memo && (!p.from || m.date >= p.from) && (!p.to || m.date <= p.to) && (!ui.lossProc || m.process === ui.lossProc)) { var k = m.kind + '|' + m.memo; memos[k] = (memos[k] || 0) + m.sec; } });
    var memoRows = Object.keys(memos).sort(function (a, b) { return memos[b] - memos[a]; }).slice(0, 15).map(function (k) { var x = k.split('|'); return [x[0], x.slice(1).join('|'), L.fmtN(memos[k] / 60, 0)]; });
    return [
      pageHead('분석', '손실 분석', '측정한 손실시간을 유형별로 큰 순서대로 늘어놓아(파레토) 먼저 줄일 손실을 고릅니다.',
        h('div', { class: 'btn-row no-print' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var a = [['유형', '손실(분)', '건수', '비율', '누적']].concat(lp.rows.map(function (r) { return [r.type, L.round(r.min, 1), r.count, r.share == null ? '' : L.round(r.share * 100, 1) + '%', r.cum == null ? '' : L.round(r.cum * 100, 1) + '%']; }));
          var mp = [['공정'].concat(L.LOSS_TYPES).concat(['손실 합(분)', '작업(분)', '손실 비율'])].concat(L.lossMatrix(db.measures, 'process', { from: p.from, to: p.to, processes: db.processes }).map(function (r) { return [r.key].concat(L.LOSS_TYPES.map(function (t) { return L.round(r.loss[t], 1); })).concat([L.round(r.total, 1), L.round(r.workMin, 1), r.lossShare == null ? '' : L.round(r.lossShare * 100, 1) + '%']); }));
          writeXlsx('프레임_손실시간분석_' + (p.from || '') + '_' + (p.to || '') + '.xlsx', [{ name: '손실 파레토', aoa: a }, { name: '공정별 손실', aoa: mp }, { name: '손실 사유', aoa: [['유형', '메모', '손실(분)']].concat(memoRows) }]);
        } }, '엑셀로 내려받기'), h('button', { type: 'button', class: 'btn', onclick: function () { window.print(); } }, '인쇄'))),
      periodBar(fld('공정', procSel)),
      h('div', { class: 'tiles' },
        tile('손실 합계', L.fmtN(lp.totalMin) + '분', lp.count + '구간'),
        tile('대당 손실', units && !ui.lossProc ? L.fmtN(lp.totalMin / units, 1) + '인·분' : '-', '측정 ' + units + '대 기준'),
        tile('가장 큰 손실', top && top.sec ? top.type : '-', top && top.sec ? '손실의 ' + pct(top.share) : '', top && top.sec ? 'bad' : ''),
        tile('작업 대비 손실', !ui.lossProc && workAll ? pct(lp.totalMin / (workAll + lp.totalMin)) : '-', '손실 ÷ (작업 + 손실)')),
      h('section', { class: 'card' }, h('h2', null, '손실 파레토' + (ui.lossProc ? ' — ' + ui.lossProc : '')),
        C.figure('유형별 손실시간(분)', { type: 'bar', labels: lp.rows.map(function (r) { return r.type; }), unit: '분', series: [{ name: '손실', values: lp.rows.map(function (r) { return r.min; }), color: 'var(--series-2)' }] }),
        table(['순위', '유형', '손실(분)', '건수', '비율', '누적 비율'], lp.rows.map(function (r, i) { return [i + 1, r.type, L.fmtN(r.min, 1), r.count, pct(r.share), pct(r.cum)]; }), { num: [1, 0, 1, 1, 1, 1] }),
        h('p', { class: 'note' }, '누적 비율이 80% 안쪽인 유형부터 줄이면 효과가 큽니다.')),
      h('section', { class: 'card' }, h('h2', null, (ui.lossBy === 'worker' ? '작업자' : '공정') + '별 손실 (분)'),
        h('div', { class: 'view-toggle no-print', role: 'group', 'aria-label': '묶는 기준', style: 'margin-bottom:10px' }, bb('process', '공정별'), bb('worker', '작업자별')),
        table([ui.lossBy === 'worker' ? '작업자' : '공정'].concat(L.LOSS_TYPES).concat(['손실 합', '작업', '손실 비율']), mtx.map(function (r) {
          return [r.key].concat(L.LOSS_TYPES.map(function (t) { return r.loss[t] ? L.fmtN(r.loss[t], 0) : '-'; })).concat([L.fmtN(r.total, 0), L.fmtN(r.workMin, 0), pct(r.lossShare)]);
        }), { num: nums(L.LOSS_TYPES.length + 4) }),
        ui.lossBy === 'worker' ? h('p', { class: 'note' }, '작업자별 표는 사람을 평가하려는 것이 아니라, 배치·자재 공급 때문에 기다리는 자리를 찾기 위한 것입니다.') : null),
      memoRows.length ? h('section', { class: 'card' }, h('h2', null, '자주 적힌 손실 사유 (메모)'), table(['유형', '메모', '손실(분)'], memoRows, { num: [0, 0, 1] })) : null
    ];
  }

  /* ── 인원 배분 시뮬레이터 ───────────────── */
  function simBase() {
    var p = period();
    var st = L.processStats(db.measures, db.processes, { from: p.from, to: p.to });
    var tk = L.taktInfo(db.daily, { from: p.from, to: p.to, settings: db.settings });
    var rows = st.rows.map(function (r) {
      var work = r.workMin != null ? r.workMin : r.stdMin;
      var w = r.measuredWorkers != null ? Math.round(r.measuredWorkers) : r.masterWorkers;
      return { name: r.name, workMin: work, src: r.workMin != null ? '측정' : r.stdMin != null ? '표준' : '없음', baseWorkers: w == null ? 1 : w };
    }).filter(function (r) { return r.workMin != null; });
    return { p: p, rows: rows, tk: tk };
  }
  function pageSim() {
    var B = simBase();
    if (!B.rows.length) return [pageHead('개선안', '인원 배분 시뮬레이터'), emptyNotice('측정 기록이나 공정 설정의 표준 공수가 필요합니다.')];
    var sim = db.sim || {};
    sim.workers = sim.workers || {}; sim.cut = sim.cut || {};
    var availMin = sim.availMin != null ? sim.availMin : (B.tk.availMin != null ? L.round(B.tk.availMin, 1) : null);
    var target = sim.target != null ? sim.target : (B.tk.target != null ? L.round(B.tk.target, 1) : null);
    var rows = B.rows.map(function (r) { return { name: r.name, workMin: r.workMin, src: r.src, baseWorkers: r.baseWorkers, workers: sim.workers[r.name] != null ? sim.workers[r.name] : r.baseWorkers, cutPct: sim.cut[r.name] || 0 }; });
    var baseTotal = rows.reduce(function (s, r) { return s + r.baseWorkers; }, 0);
    var before = L.simulate(rows.map(function (r) { return { name: r.name, workMin: r.workMin, workers: r.baseWorkers }; }), availMin, target);
    var after = L.simulate(rows, availMin, target);
    function persist() { db.sim = { workers: {}, cut: {}, availMin: availMin, target: target }; rows.forEach(function (r) { db.sim.workers[r.name] = r.workers; db.sim.cut[r.name] = r.cutPct; }); save(); }
    var aIn = inp({ type: 'number', min: '1', step: '1', value: availMin == null ? '' : availMin }), tIn = inp({ type: 'number', min: '1', step: '0.5', value: target == null ? '' : target });
    aIn.addEventListener('change', function () { availMin = aIn.value === '' ? null : Number(aIn.value); persist(); render(); });
    tIn.addEventListener('change', function () { target = tIn.value === '' ? null : Number(tIn.value); persist(); render(); });
    var trows = after.rows.map(function (r, i) {
      var src = rows[i];
      var w = inp({ type: 'number', min: '0', step: '1', value: src.workers, 'aria-label': r.name + ' 인원' });
      w.addEventListener('change', function () { src.workers = Math.max(0, Math.round(Number(w.value) || 0)); persist(); render(); });
      var c = inp({ type: 'number', min: '0', max: '90', step: '1', value: src.cutPct, 'aria-label': r.name + ' 공수 줄임' });
      c.addEventListener('change', function () { src.cutPct = Math.min(90, Math.max(0, Number(c.value) || 0)); persist(); render(); });
      var b = before.rows[i];
      return { cls: r.isBottleneck ? 'bn' : null, cells: [r.name, m1(src.workMin) + (src.src === '표준' ? ' (표준)' : ''), src.baseWorkers, m1(b.ct), w, c, m1(r.effWorkMin), r.ct === Infinity ? '인원 0' : m1(r.ct),
        r.isBottleneck ? h('span', { class: 'badge bn' }, '병목') : r.over ? h('span', { class: 'badge over' }, '택트 초과') : h('span', { class: 'badge ok' }, '여유')] };
    });
    var moreWorkers = after.totalWorkers > baseTotal;
    return [
      pageHead('개선안', '인원 배분 시뮬레이터', '공정별 인원과 공수 줄임(작업 개선)을 바꿔 보며, 같은 인원으로 하루에 낼 수 있는 대수와 예상 달성률을 계산합니다.'),
      periodBar(),
      h('section', { class: 'card' }, h('h2', null, '조건'),
        h('div', { class: 'form-grid' }, fld('하루 가용시간(분)', aIn, '기간 평균: ' + (B.tk.availMin == null ? '-' : L.fmtN(B.tk.availMin, 1) + '분')), fld('하루 목표 대수', tIn, '기간 평균: ' + (B.tk.target == null ? '-' : L.fmtN(B.tk.target, 1) + '대'))),
        h('div', { class: 'btn-row', style: 'margin-top:10px' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var s = L.suggestAllocation(rows, baseTotal);
            if (!s) { toast('공정 수보다 인원이 적어 제안할 수 없습니다.', true); return; }
            rows.forEach(function (r, i) { r.workers = s[i]; }); persist(); render(); toast('같은 총인원(' + baseTotal + '명)으로 가장 긴 사이클타임이 가장 짧아지는 배분을 넣었습니다.');
          } }, '같은 인원으로 자동 배분 제안'),
          h('button', { type: 'button', class: 'btn', onclick: function () { db.sim = {}; save(); render(); } }, '처음 값으로'))),
      h('div', { class: 'tiles' },
        tile('총 인원', after.totalWorkers + '명', '지금 ' + baseTotal + '명' + (moreWorkers ? ' — 인원이 늘었습니다' : after.totalWorkers === baseTotal ? ' — 현재 인원 유지' : ''), moreWorkers ? 'bad' : 'ok'),
        tile('병목공정', after.bottleneck ? shortName(after.bottleneck.name) : '-', '지금 ' + (before.bottleneck ? shortName(before.bottleneck.name) + ' ' + m1(before.maxCt) + '분' : '-') + ' → ' + m1(after.maxCt) + '분'),
        tile('하루 최대 대수', after.capacity == null ? '-' : L.fmtN(after.capacity, 1) + '대', '지금 ' + (before.capacity == null ? '-' : L.fmtN(before.capacity, 1) + '대')),
        tile('예상 달성률', pct(after.expectedRate), '지금 ' + pct(before.expectedRate) + ' · 라인 밸런스 ' + pct(after.balance), after.expectedRate != null ? (after.expectedRate >= goal() ? 'ok' : 'bad') : '')),
      h('section', { class: 'card' }, h('h2', null, '공정별 인원 바꿔 보기'),
        table(['공정', '대당 공수(인·분)', '지금 인원', '지금 CT', '바꿀 인원', '공수 줄임(%)', '줄인 공수', '바뀐 CT', '판정'], trows, { cls: 'sim-table', num: [0, 1, 1, 1, 1, 1, 1, 1, 0] }),
        C.figure('사이클타임 비교(분/대)', { type: 'bar', labels: after.rows.map(function (r) { return shortName(r.name); }), unit: '분', refLines: after.taktMin ? [{ value: after.taktMin, label: '택트 ' + m1(after.taktMin) + '분' }] : [],
          series: [{ name: '지금', values: before.rows.map(function (r) { return r.ct; }), color: 'var(--series-plan)' }, { name: '바꾼 뒤', values: after.rows.map(function (r) { return isFinite(r.ct) ? r.ct : null; }), color: 'var(--series-after)' }] }),
        h('ul', { class: 'note' },
          h('li', null, '대당 공수는 이 기간 측정의 순작업 공수(없으면 공정 설정의 표준 공수)입니다. 공수 줄임(%)은 자재 키트·지그 개선 같은 작업 방법 개선을 가정해 넣는 값입니다.'),
          h('li', null, '예상 대수는 손실이 없을 때의 상한입니다. 자재 준비·이동·대기·재작업을 줄여야 실제 대수가 상한에 가까워집니다.'),
          h('li', null, '사람을 옮길 수 있는지(자격·숙련·안전)는 현장에서 확인해야 합니다. 이 계산은 작업을 인원끼리 나눌 수 있다고 봅니다.')))
    ];
  }

  /* ── 개선 전·후 ───────────────────────── */
  function compareData() {
    var c = db.compare, r = dataRange();
    if (!c.beforeFrom || !c.afterFrom) {
      if (!r.from) return null;
      var days = db.daily.map(function (x) { return x.date; });
      var mid = days[Math.floor(days.length / 2)] || r.from;
      c.beforeFrom = c.beforeFrom || r.from; c.beforeTo = c.beforeTo || L.addDays(mid, -1);
      c.afterFrom = c.afterFrom || mid; c.afterTo = c.afterTo || r.to;
    }
    return L.comparePeriods(db, { from: c.beforeFrom, to: c.beforeTo }, { from: c.afterFrom, to: c.afterTo }, db.settings);
  }
  function pageCompare() {
    if (!db.daily.length) return [pageHead('효과', '개선 전·후 비교'), emptyNotice('아직 일일 실적이 없습니다.')];
    var cmp = compareData(), c = db.compare, s = db.settings;
    function dIn(k) { var e = inp({ type: 'date', value: c[k] }); e.addEventListener('change', function () { c[k] = e.value; save(); render(); }); return e; }
    function nIn(k, step) { var e = inp({ type: 'number', min: '0', step: step || '1', value: s[k] == null ? '' : s[k], inputmode: 'decimal' }); e.addEventListener('change', function () { s[k] = e.value === '' ? null : Number(e.value); db.settings = L.cleanSettings(s); save(); render(); }); return e; }
    var A = cmp.before, B = cmp.after, k = cmp.kpi;
    function yes(v) { return v == null ? '-' : v ? '달성' : '미달'; }
    var aoa = L.compareToAoa(cmp);
    var paper = h('div', { class: 'card paper' },
      h('h2', null, '개선 전·후 생산량과 손실시간 비교표'),
      table(aoa[0], aoa.slice(1).map(function (r) { return { cls: /절감|제작원가/.test(r[0]) ? 'sum' : null, cells: r.map(function (x) { return typeof x === 'number' ? L.fmtN(x, 2) : x; }) }; }), { num: [0, 1, 1, 1] }),
      h('p', { class: 'note' }, '대당 투입공수 = (투입 인원 × 가용시간)의 합 ÷ 실제 대수 — 손실까지 들어간 값이라, 같은 인원으로 더 많이 만들면 줄어듭니다. 대당 인건비 = 대당 투입공수 × 시간당 임률, 대당 제작원가 = 대당 인건비 + 대당 기타 원가(모두 입력한 값).'));
    return [
      pageHead('효과', '개선 전·후 비교 · 단가 절감', '두 기간의 달성률·손실시간·대당 투입공수를 비교하고, 입력한 임률·원가로 대당 제작 단가 절감액과 절감률을 계산합니다.',
        h('div', { class: 'btn-row no-print' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { writeXlsx('프레임_개선전후_단가절감_' + today() + '.xlsx', [{ name: '개선 전후 비교', aoa: aoa }]); } }, '엑셀로 내려받기'),
          h('button', { type: 'button', class: 'btn', onclick: function () { exportWord('개선 전·후 비교', '프레임_개선전후비교_' + today() + '.doc', paper); } }, 'Word 로'),
          h('button', { type: 'button', class: 'btn', onclick: function () { window.print(); } }, '인쇄'))),
      h('section', { class: 'card no-print' }, h('h2', null, '비교할 기간'),
        h('div', { class: 'form-grid' }, fld('개선 전 시작', dIn('beforeFrom')), fld('개선 전 끝', dIn('beforeTo')), h('span'), fld('개선 후 시작', dIn('afterFrom')), fld('개선 후 끝', dIn('afterTo')))),
      h('section', { class: 'card no-print' }, h('h2', null, '원가 입력 (회사 계산 방식 확인 전 — 직접 넣는 값)'),
        h('div', { class: 'form-grid' },
          fld('시간당 임률(원/인·시)', nIn('wage', '100'), '인건비 계산에 쓰는 1인 1시간 단가'), fld('대당 기타 원가 — 개선 전(원)', nIn('otherBefore', '1000'), '자재·소모품·경비 등'),
          fld('대당 기타 원가 — 개선 후(원)', nIn('otherAfter', '1000'), '비우면 개선 전과 같게 봅니다'), fld('연간 생산 대수(선택)', nIn('annualUnits'), '넣으면 연간 절감 예상을 계산')),
        s.wage == null ? h('p', { class: 'alert info' }, '임률을 넣으면 대당 제작원가·절감액·절감률이 나옵니다.') : null),
      h('div', { class: 'tiles' },
        tile('현재 인원 유지', yes(k.keepWorkers), '평균 ' + (A.total.workers == null ? '-' : A.total.workers) + '명 → ' + (B.total.workers == null ? '-' : B.total.workers) + '명', k.keepWorkers == null ? '' : k.keepWorkers ? 'ok' : 'bad'),
        tile('달성률 ' + goalPct() + ' 이상', yes(k.rate90), pct(A.total.rate) + ' → ' + pct(B.total.rate), k.rate90 == null ? '' : k.rate90 ? 'ok' : 'bad'),
        tile('대당 절감액', cmp.saving == null ? '-' : L.fmtWon(cmp.saving), cmp.annual != null ? '연간 ' + L.fmtWon(cmp.annual) : '대당 투입공수 ' + L.fmtN(A.total.perUnitManHr, 2) + ' → ' + L.fmtN(B.total.perUnitManHr, 2) + '인·시', k.costDown == null ? '' : k.costDown ? 'ok' : 'bad'),
        tile('절감률', pct(cmp.savingRate), cmp.costBefore ? L.fmtWon(cmp.costBefore.total) + ' → ' + L.fmtWon(cmp.costAfter.total) : '임률 입력 필요')),
      h('div', { class: 'charts' },
        C.figure('대당 손실 공수(인·분/대, 측정)', { type: 'bar', labels: L.LOSS_TYPES, unit: '분', series: [
          { name: '개선 전', values: L.LOSS_TYPES.map(function (t) { return A.lossByType[t]; }), color: 'var(--series-plan)' },
          { name: '개선 후', values: L.LOSS_TYPES.map(function (t) { return B.lossByType[t]; }), color: 'var(--series-after)' }] }),
        C.figure('공정별 사이클타임(분/대, 측정)', { type: 'bar', labels: A.line.rows.map(function (r) { return shortName(r.name); }), unit: '분', refLines: B.line.taktMin ? [{ value: B.line.taktMin, label: '택트' }] : [], series: [
          { name: '개선 전', values: A.line.rows.map(function (r) { return r.ct; }), color: 'var(--series-plan)' },
          { name: '개선 후', values: A.line.rows.map(function (r) { var x = B.line.rows.filter(function (y) { return y.name === r.name; })[0]; return x ? x.ct : null; }), color: 'var(--series-after)' }] })),
      A.stats.count && B.stats.count ? null : h('p', { class: 'alert info' }, '두 기간 모두에 측정 기록이 있어야 손실·사이클타임 비교가 나옵니다(실적·원가 비교는 일일 실적만으로 됩니다).'),
      paper
    ];
  }

  /* ── 표준작업서 ───────────────────────── */
  function pageSop() {
    var procs = L.sortProcesses(db.processes);
    if (!procs.length) return [pageHead('표준화', '표준작업서 초안'), emptyNotice('공정 설정에 공정이 없습니다.')];
    var r = dataRange(), c = db.compare;
    var from = c.afterFrom || r.from, to = c.afterTo || r.to;
    var st = L.processStats(db.measures, db.processes, { from: from, to: to });
    var rows = L.sopRows(procs, st);
    var tk = L.taktInfo(db.daily, { from: from, to: to, settings: db.settings });
    var total = rows.reduce(function (s, x) { return s + (x.workers || 0); }, 0);
    var prompt = L.buildSopPrompt({ rows: rows, product: db.settings.product, taktMin: tk.taktMin, target: tk.target });
    var ans = h('textarea', { rows: '10', placeholder: 'AI 답을 여기에 붙여 넣으면 아래 표준작업서에 「작업 요령(AI 다듬음)」으로 들어갑니다. 검토 후 고쳐 쓰세요.' });
    ans.value = db.aiNotes.sop || '';
    ans.addEventListener('input', function () { db.aiNotes.sop = ans.value; save(); });
    ans.addEventListener('change', function () { render(); });
    var paper = h('div', { class: 'card paper', id: 'sopPaper' },
      h('table', { class: 'sign' }, h('tr', null, h('th', null, '작성'), h('th', null, '검토'), h('th', null, '승인')), h('tr', null, h('td'), h('td'), h('td'))),
      h('h1', null, db.settings.product + ' 제작 표준작업서 (초안)'),
      h('p', { class: 'note' }, '작성일 ' + today() + ' · 제작팀 · 이 문서는 도구가 만든 초안입니다. 현장 확인 후 사용하세요.'),
      table(['항목', '내용'], [
        ['택트타임', tk.taktMin == null ? '-' : m1(tk.taktMin) + '분/대 (' + tk.source + ')'],
        ['하루 목표', tk.target == null ? '-' : L.fmtN(tk.target, 1) + '대 · 가용시간 ' + (tk.availMin == null ? '-' : L.fmtN(tk.availMin / 60, 2) + '시간')],
        ['총 인원', total + '명'],
        ['측정 기준 기간', from && to ? from + ' ~ ' + to : '-']]),
      h('h2', null, '1. 공정 순서와 표준시간'),
      table(['순서', '공정', '인원', '표준 공수(인·분)', '사이클타임(분)', '측정 순작업(인·분)'], rows.map(function (x) { return [x.no, x.name, x.workers, m1(x.stdMin), m1(x.ct), m1(x.measuredWorkMin)]; }), { num: [1, 0, 1, 1, 1, 1] }),
      h('h2', null, '2. 작업 요점과 주의사항'),
      table(['순서', '공정', '작업 요점', '품질 주의', '안전 주의'], rows.map(function (x) { return [x.no, x.name, x.points || '(현장 확인 후 작성)', x.quality || '-', x.safety || '-']; }), { cls: 'sop', num: [1, 0, 0, 0, 0] }),
      db.aiNotes.sop ? [h('h2', null, '3. 작업 요령 (AI 다듬음 — 검토 후 사용)'), h('div', { class: 'pre' }, db.aiNotes.sop)] : null,
      h('p', { class: 'note' }, '사이클타임 = 표준 공수 ÷ 인원. 표준 공수는 공정 설정의 값, 측정 순작업은 ' + (from && to ? from + '~' + to : '측정') + ' 기간의 평균입니다.'));
    return [
      pageHead('표준화', '표준작업서 초안', '공정 설정의 순서·시간·메모로 표준작업서 초안을 만듭니다. 메모는 공정 설정에서 고치고, 문장은 AI 프롬프트로 다듬을 수 있습니다.',
        h('div', { class: 'btn-row no-print' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { window.print(); } }, '인쇄 / PDF'),
          h('button', { type: 'button', class: 'btn', onclick: function () { exportWord('표준작업서', '프레임_표준작업서_초안_' + today() + '.doc', paper); } }, 'Word 로'),
          h('button', { type: 'button', class: 'btn', onclick: function () {
            writeXlsx('프레임_표준작업서_초안_' + today() + '.xlsx', [{ name: '표준작업서', aoa: [['순서', '공정', '인원', '표준 공수(인·분)', '사이클타임(분)', '작업 요점', '품질 주의', '안전 주의']].concat(rows.map(function (x) { return [x.no, x.name, x.workers, x.stdMin, x.ct == null ? '' : L.round(x.ct, 1), x.points, x.quality, x.safety]; })) }]);
          } }, '엑셀로'),
          h('a', { class: 'btn', href: '#/process' }, '메모 고치기(공정 설정)'))),
      h('section', { class: 'card no-print' }, h('h2', null, 'AI 로 문장 다듬기 (선택 · 반자동)'),
        h('ol', { class: 'steps' }, h('li', null, '프롬프트를 복사해 회사가 허용한 AI 에 붙여 넣습니다.'), h('li', null, 'AI 답을 아래 칸에 붙여 넣습니다.'), h('li', null, '표준작업서에 들어간 문장을 검토해 고칩니다.')),
        h('p', { class: 'note' }, '프롬프트에는 공정 이름·시간·인원·메모만 들어갑니다(작업자 이름·원가 없음). 메모에 없는 방법·수치를 지어내지 말라고 적어 두었습니다.'),
        h('textarea', { class: 'mono', rows: '8', readonly: true }, prompt),
        h('div', { class: 'btn-row', style: 'margin:8px 0' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { copyText(prompt); } }, '프롬프트 복사'),
          AIP.sendButton('설정한 AI 서버로 보내기(선택)', function () { return prompt; }, function (t) { db.aiNotes.sop = t; save(); render(); toast('AI 답을 받았습니다. 검토 후 사용하세요.'); }, { toast: toast, settingsHref: '#/settings' })),
        fld('AI 답', ans)),
      paper
    ];
  }

  /* ── 개선 보고서 · AI ─────────────────── */
  function pageReport() {
    if (!hasData()) return [pageHead('보고', '개선 보고서 · AI'), emptyNotice()];
    var p = period();
    var tot = L.achieveTotal(db.daily, { from: p.from, to: p.to, settings: db.settings, goal: goal() });
    var weeks = L.achieveRows(db.daily, { unit: 'week', from: p.from, to: p.to, settings: db.settings, goal: goal() });
    var A = analysisData(p);
    var lp = L.lossPareto(db.measures, { from: p.from, to: p.to });
    var byP = L.lossMatrix(db.measures, 'process', { from: p.from, to: p.to, processes: db.processes });
    var byW = L.lossMatrix(db.measures, 'worker', { from: p.from, to: p.to });
    var memos = db.measures.filter(function (m) { return L.isLoss(m.kind) && m.memo && (!p.from || m.date >= p.from) && (!p.to || m.date <= p.to); })
      .map(function (m) { return m.process + ' ' + m.kind + ': ' + m.memo; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var sim = null;
    if (db.sim && db.sim.workers && Object.keys(db.sim.workers).length) {
      var B = simBase();
      sim = L.simulate(B.rows.map(function (r) { return { name: r.name, workMin: r.workMin, workers: db.sim.workers[r.name] != null ? db.sim.workers[r.name] : r.baseWorkers, cutPct: (db.sim.cut || {})[r.name] || 0 }; }),
        db.sim.availMin != null ? db.sim.availMin : B.tk.availMin, db.sim.target != null ? db.sim.target : B.tk.target);
    }
    var cmp = db.compare.beforeFrom && db.compare.afterFrom ? compareData() : null;
    var mask = db.maskWorkers !== false;
    var names = workers();
    if (mask) db.aliases = L.assignAliases(db.aliases, names);
    var info = L.buildAnalysisPrompt({ period: p, total: tot, weeks: weeks, line: A.st.count ? A.la : null, pareto: lp, byProcess: byP, byWorker: byW, memos: memos, sim: sim, compare: cmp,
      includeCost: db.includeCost, aliases: mask ? db.aliases : null, goal: goal() });
    var prompt = info.prompt;
    function back(t) { return mask ? L.unmaskText(t, db.aliases) : t; }
    var ans = h('textarea', { rows: '12', placeholder: 'AI 답을 여기에 붙여 넣으세요(별칭은 이름으로 되돌립니다). 보고서 「AI 개선 의견」에 들어갑니다.' });
    ans.value = db.aiNotes.analysis || '';
    ans.addEventListener('input', function () { db.aiNotes.analysis = back(ans.value); save(); });
    ans.addEventListener('change', function () { var b = back(ans.value); if (b !== ans.value) { ans.value = b; toast('답의 별칭을 이름으로 되돌렸습니다.'); } render(); });
    var mBox = inp({ type: 'checkbox' }); mBox.checked = mask;
    mBox.addEventListener('change', function () { db.maskWorkers = mBox.checked; save(); render(); });
    var cBox = inp({ type: 'checkbox' }); cBox.checked = !!db.includeCost;
    cBox.addEventListener('change', function () { db.includeCost = cBox.checked; save(); render(); });
    var usedNames = names.filter(function (n) { return mask && db.aliases[n]; });
    var la = A.la;
    var paper = h('div', { class: 'card paper' },
      h('h1', null, '프레임 제작 생산성 개선 보고 (초안)'),
      h('p', { class: 'note' }, '기간 ' + (p.from || '-') + ' ~ ' + (p.to || '-') + ' · 제작팀 · 작성 ' + today()),
      h('h2', null, '1. 달성률'),
      h('p', null, '목표 ' + tot.target + '대 · 실제 ' + tot.actual + '대 · 달성률 ' + pct(tot.rate) + ' · ' + goalPct() + ' 이상 ' + tot.okDays + '/' + tot.ratedDays + '일 · 평균 인원 ' + (tot.workers == null ? '-' : tot.workers + '명') + ' · 대당 투입공수 ' + (tot.perUnitManHr == null ? '-' : L.fmtN(tot.perUnitManHr, 2) + '인·시')),
      weeks.length ? table(['주', '목표', '실제', '달성률'], weeks.map(function (w) { return [w.label, w.target, w.actual, pct(w.rate)]; }), { num: [0, 1, 1, 1] }) : null,
      A.st.count ? [h('h2', null, '2. 병목공정 (측정 ' + A.st.days.length + '일)'),
        h('p', null, '택트타임 ' + m1(la.taktMin) + '분/대 · 병목 ' + (la.bottleneck ? la.bottleneck.name + ' ' + m1(la.maxCt) + '분/대' : '-') + ' · 병목 기준 하루 최대 ' + (la.capacity == null ? '-' : L.fmtN(la.capacity, 1) + '대') + ' · 라인 밸런스 효율 ' + pct(la.balance)),
        table(['공정', '인원', '사이클타임', '대당 손실', '판정'], la.rows.map(function (r) { return [r.name, r.workers == null ? '-' : L.fmtN(r.workers, 1), m1(r.ct), m1(r.lossMin), r.isBottleneck ? '병목' : r.over ? '택트 초과' : r.ct == null ? '-' : '여유']; }), { num: [0, 1, 1, 1, 0] })] : null,
      lp.count ? [h('h2', null, '3. 손실시간'), table(['유형', '손실(분)', '비율', '누적'], lp.rows.map(function (r) { return [r.type, L.fmtN(r.min, 0), pct(r.share), pct(r.cum)]; }), { num: [0, 1, 1, 1] })] : null,
      sim ? [h('h2', null, '4. 인원 배분안 (시뮬레이션)'), table(['공정', '인원', '공수 줄임', '사이클타임'], sim.rows.map(function (r) { return [r.name, r.workers, r.cutPct ? r.cutPct + '%' : '-', m1(r.ct)]; }), { num: [0, 1, 1, 1] }),
        h('p', null, '총 ' + sim.totalWorkers + '명 · 병목 ' + (sim.bottleneck ? sim.bottleneck.name : '-') + ' · 하루 최대 ' + L.fmtN(sim.capacity, 1) + '대 · 예상 달성률 ' + pct(sim.expectedRate))] : null,
      cmp ? [h('h2', null, '5. 개선 전·후'), h('p', null, '달성률 ' + pct(cmp.before.total.rate) + ' → ' + pct(cmp.after.total.rate) + ' · 대당 투입공수 ' + L.fmtN(cmp.before.total.perUnitManHr, 2) + ' → ' + L.fmtN(cmp.after.total.perUnitManHr, 2) + '인·시' +
        (cmp.saving != null ? ' · 대당 절감액 ' + L.fmtWon(cmp.saving) + ' (' + pct(cmp.savingRate) + ')' : ''))] : null,
      db.aiNotes.analysis ? [h('h2', null, 'AI 개선 의견 (검토 후 사용)'), h('div', { class: 'pre' }, db.aiNotes.analysis)] : null);
    return [
      pageHead('보고', '개선 보고서 · AI', '계산한 사실만 담은 프롬프트로 AI 에 개선안 정리를 맡기고(복사 → 붙여 넣기), 보고서 초안으로 묶습니다.',
        h('div', { class: 'btn-row no-print' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { window.print(); } }, '인쇄 / PDF'),
          h('button', { type: 'button', class: 'btn', onclick: function () { exportWord('생산성 개선 보고', '프레임_생산성개선보고_' + today() + '.doc', paper); } }, 'Word 로'),
          h('button', { type: 'button', class: 'btn', onclick: function () { copyText(paper.innerText); } }, '글자로 복사'))),
      periodBar(),
      h('section', { class: 'card no-print' }, h('h2', null, 'AI 프롬프트 (반자동)'),
        h('div', { class: 'mask-box' },
          h('label', { class: 'opt' }, mBox, h('span', null, h('span', { class: 't' }, '작업자 이름 가리기(외부 AI 에 이름을 보내지 않음)'), h('span', { class: 's' }, '「작업자1」 같은 별칭으로 바꾸고, 대응표는 이 PC 에만 둡니다.'))),
          h('label', { class: 'opt', style: 'margin-top:8px' }, cBox, h('span', null, h('span', { class: 't' }, '원가·절감액도 넣기'), h('span', { class: 's' }, '기본은 뺍니다. 회사 보안 기준을 확인한 뒤 켜 주세요.'))),
          mask && info.leaks.length ? h('p', { class: 'alert warn' }, '가리지 못한 이름이 프롬프트에 남아 있습니다: ' + info.leaks.join(', ') + ' — 보내기 전에 지워 주세요.') : null,
          mask ? h('p', { class: 'note' }, info.leaks.length ? '' : '확인: 프롬프트에 작업자 이름이 없습니다(이름 ' + names.length + '개 대조).') : h('p', { class: 'alert info' }, '지금은 작업자 이름이 그대로 들어갑니다.'),
          usedNames.length ? h('details', null, h('summary', null, '별칭 대응표 (' + usedNames.length + '명 · 이 PC 에만 있음)'), table(['별칭', '이름'], usedNames.map(function (n) { return [db.aliases[n], n]; }))) : null),
        h('textarea', { class: 'mono', rows: '12', readonly: true }, prompt),
        h('div', { class: 'btn-row', style: 'margin:8px 0' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { copyText(prompt); } }, '프롬프트 복사'),
          AIP.sendButton('설정한 AI 서버로 보내기(선택)', function () { return prompt; }, function (t) { t = back(t); db.aiNotes.analysis = t; save(); render(); toast('AI 답을 받았습니다(별칭은 이름으로 되돌림). 검토 후 사용하세요.'); }, { toast: toast, settingsHref: '#/settings' })),
        fld('AI 답', ans),
        h('p', { class: 'note' }, '프롬프트에는 도구가 계산한 숫자·손실 메모·비고만 들어가고, 원인은 기록된 것과 「추정」을 나눠 쓰라고 적어 두었습니다. ' +
          (sim ? '인원 배분 시뮬레이션 결과도 들어갑니다.' : '인원 배분 화면에서 배분안을 만들면 그 결과도 들어갑니다.'))),
      paper
    ];
  }

  /* ── 설정 ─────────────────────────────── */
  function pageSettings() {
    var s = db.settings;
    function nIn(k, step, mul) { var e = inp({ type: 'number', min: '0', step: step || '1', value: s[k] == null ? '' : L.round(s[k] * (mul || 1), 2), inputmode: 'decimal' }); e._k = k; e._mul = mul || 1; return e; }
    var ins = [nIn('availHr', '0.1'), nIn('target'), nIn('workers'), nIn('goal', '1', 100)];
    var prod = inp({ value: s.product });
    var backup = inp({ type: 'file', accept: '.json' });
    backup.addEventListener('change', function () {
      var f = backup.files[0]; if (!f) return;
      f.text().then(function (t) {
        var o = JSON.parse(t); if (!o || !Array.isArray(o.daily)) throw new Error('이 도구의 백업 파일이 아닙니다.');
        db = L.restoreDb(o); save(); toast('백업을 불러왔습니다(일일 실적 ' + db.daily.length + '일 · 측정 ' + db.measures.length + '행).'); render();
      }).catch(function (e) { toast('불러오지 못했습니다: ' + e.message, true); });
    });
    return [
      pageHead('설정', '기본값 · AI 연결 · 백업'),
      h('section', { class: 'card' }, h('h2', null, '기본값'),
        h('p', { class: 'note' }, '일일 실적에 인원·가용시간이 빈 날과, 실적이 없을 때의 택트타임 계산에 씁니다.'),
        h('div', { class: 'form-grid' }, fld('가용시간(HR/일)', ins[0], '하루 실작업 가능시간(휴식 제외)'), fld('목표 대수(대/일)', ins[1]), fld('현재 인원(명)', ins[2]),
          fld('달성률 목표(%)', ins[3], '제출 원문 기준 90%'), fld('제품 이름', prod, '표준작업서 제목에 씁니다')),
        h('div', { class: 'btn-row', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var o = Object.assign({}, s);
          ins.forEach(function (e) { o[e._k] = e.value === '' ? null : Number(e.value) / e._mul; });
          if (o.goal == null) o.goal = L.GOAL;
          o.product = prod.value;
          db.settings = L.cleanSettings(o); save(); toast('기본값을 저장했습니다.'); render();
        } }, '저장'))),
      AIP.settingsCard({ toast: toast, onChange: render }),
      h('section', { class: 'card' }, h('h2', null, '백업 · 샘플 · 지우기'),
        h('p', { class: 'note' }, '데이터는 이 브라우저에만 있습니다. 다른 PC 로 옮기거나 브라우저 정리 전에 JSON 으로 받아 두세요. (작업자 이름·원가가 들어 있으니 보관에 주의해 주세요)'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: function () { download('프레임생산성_백업_' + today() + '.json', new Blob([JSON.stringify(db)], { type: 'application/json' })); } }, 'JSON 백업 내려받기'),
          h('label', { class: 'btn' }, backup, 'JSON 백업 불러오기'),
          h('button', { type: 'button', class: 'btn', onclick: askSample }, '가상 샘플 불러오기'),
          h('a', { class: 'btn', href: 'samples/' + encodeURIComponent('프레임_현장측정_샘플_개선전_0908-0910.xlsx'), download: '' }, '샘플 측정 엑셀 받기'),
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            if (!confirm('이 브라우저에 쌓인 실적·측정·공정·설정을 모두 지울까요? (되돌릴 수 없습니다)')) return;
            db = L.emptyDb(); S.clearDb(); ui.from = ''; ui.to = ''; save(); render();
          } }, '모든 데이터 지우기')))
    ];
  }

  /* ── 라우터 · 왼쪽 메뉴 ─────────────────── */
  var ICON = {
    home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    daily: '<rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 2.5v4M16 2.5v4M8 13h3M8 16.5h6"/>',
    achieve: '<rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M8 16v-3M12 16V9.5M16 16v-5"/>',
    measure: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M9.5 2.5h5M12 2.5v4"/>',
    analysis: '<path d="M4 20V10M9.5 20V5M15 20v-8M20.5 20v-4"/><path d="M3 7.5h18" stroke-dasharray="2 2"/>',
    loss: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M7 17V8M11 17v-6M15 17v-3.5M7 8l4 3 4 2.5 3-6.5"/>',
    sim: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 19c.6-3.4 3-5.5 5.5-5.5s4.9 2.1 5.5 5.5M14 14.5c1-.7 2-1 3-1 2.2 0 4 1.8 4.5 4.5"/>',
    compare: '<path d="M4 7h11l-3-3M20 17H9l3 3"/>',
    sop: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5M14 3v5h5"/>',
    report: '<path d="M5 4h14v16H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
    process: '<path d="M4 6h16M4 12h10M4 18h6"/><path d="m15 17 2 2 4-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'
  };
  var PAGES = [
    { id: 'home', t: '대시보드', fn: pageHome },
    { id: 'daily', t: '일일 실적', fn: pageDaily },
    { id: 'achieve', t: '달성률 관리표', fn: pageAchieve },
    { id: 'measure', t: '현장 측정', fn: pageMeasure },
    { id: 'analysis', t: '병목 분석', fn: pageAnalysis },
    { id: 'loss', t: '손실 분석', fn: pageLoss },
    { id: 'sim', t: '인원 배분', fn: pageSim },
    { id: 'compare', t: '개선 전·후', fn: pageCompare },
    { id: 'sop', t: '표준작업서', fn: pageSop },
    { id: 'report', t: '개선 보고서 · AI', fn: pageReport, sep: true },
    { id: 'process', t: '공정 설정', fn: pageProcess, sub: true },
    { id: 'settings', t: '설정', fn: pageSettings, bottom: true }
  ];
  function route() { var id = (location.hash || '').replace(/^#\//, '').split('?')[0]; return PAGES.filter(function (p) { return p.id === id; })[0] || PAGES[0]; }
  function navLink(x, cur) {
    var a = h('a', { href: '#/' + x.id, class: x.bottom ? 'side-set' : x.sub ? 'side-sub' : null, 'aria-current': x === cur ? 'page' : null });
    a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[x.id] + '</svg>';
    a.appendChild(h('span', null, x.t));
    return a;
  }
  function render() {
    var p = route();
    var nav = document.getElementById('nav'), nb = document.getElementById('navBottom');
    nav.innerHTML = ''; nb.innerHTML = '';
    PAGES.forEach(function (x) {
      if (x.bottom) { nb.appendChild(navLink(x, p)); return; }
      if (x.sub && !nav.querySelector('.side-sep')) nav.appendChild(h('div', { class: 'side-sep', role: 'presentation' }));
      nav.appendChild(navLink(x, p));
    });
    var r = dataRange();
    document.getElementById('dataChip').textContent = hasData() ? '실적 ' + db.daily.length + '일 · 측정 ' + L.measureDays(db.measures).length + '일 · 공정 ' + db.processes.length + '개' + (r.to ? ' · ~' + r.to.slice(5).replace('-', '/') : '') : '달성률 · 병목공정 · 손실시간 · 인원 배분 · 표준작업서';
    var b = document.getElementById('sampleBanner');
    b.hidden = !db.sample;
    b.textContent = '지금 보시는 것은 가상 샘플입니다(작업자A~I, 원가·임률도 가짜 값). 개선 전에는 본용접이 병목이고 「대기」 손실이 가장 크게, 09/21 인원 배분 변경 뒤에는 달성률이 90%를 넘게 일부러 만들어 두었습니다. 실제 자료를 넣기 전에 설정에서 「모든 데이터 지우기」를 해 주세요.';
    main.innerHTML = '';
    add(main, p.fn());
    document.title = p.t + ' — 프레임 제작 생산성 개선';
    save();
  }
  window.addEventListener('hashchange', function () { setMenu(false); render(); main.focus(); window.scrollTo(0, 0); });

  // 좁은 화면(1024px 미만)에서는 왼쪽 메뉴를 「메뉴」 단추로 여닫습니다 (data09-17 과 같은 방식)
  var menuBtn = document.getElementById('menuBtn'), sidebar = document.getElementById('sidebar'), backdrop = document.getElementById('sideBackdrop');
  function setMenu(open) {
    document.body.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    backdrop.hidden = !open;
    if (open) { var first = sidebar.querySelector('a'); if (first) first.focus(); }
  }
  menuBtn.addEventListener('click', function () { setMenu(!document.body.classList.contains('menu-open')); });
  backdrop.addEventListener('click', function () { setMenu(false); menuBtn.focus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { setMenu(false); menuBtn.focus(); } });
  sidebar.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function nowText() {
    var d = new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    document.getElementById('nowText').textContent = d.getFullYear() + '. ' + p2(d.getMonth() + 1) + '. ' + p2(d.getDate()) + ' (' + WEEK[d.getDay()] + ') ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  nowText(); setInterval(nowText, 30000);
  render();
})();
