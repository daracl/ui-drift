// core 엔진 성능 측정 (Node, 빌드 산출물 dist/core.js 사용). DOM/브라우저와 무관한 순수 계산 비용만 잰다.
// 사용: npm run build && node scripts/bench-core.mjs [결과.json]
// 같은 입력을 여러 번 반복해 중앙값을 기록한다. 케이스마다 시간 상한을 두어 지나치게 느린 조합은 건너뛴다.
import fs from 'fs';
import os from 'os';
import { performance } from 'perf_hooks';
import { addItem, compact, moveItem, normalizeItems, resizeItem } from '../dist/core.js';

const COLUMNS = 12;
const SIZES = (process.env.BENCH_SIZES || '100,300,1000,2000').split(',').map(Number);
const BUDGET_MS = Number(process.env.BENCH_BUDGET_MS || 20000); // 한 번 실행이 이 시간을 넘으면 반복/큰 n 을 건너뛴다

/** 재현 가능한 난수 */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const SHAPES = {
  /** 이미 빽빽하게 정렬된 레이아웃: 압축해도 변하지 않는다 (가장 흔한 편집 상태) */
  dense: (n) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, x: (i % 4) * 3, y: Math.floor(i / 4) * 2, w: 3, h: 2 })),
  /** 위쪽이 비어 있는 레이아웃: 모든 항목이 한 행씩 위로 올라가야 한다 (y 가 큰 항목의 압축 비용) */
  tall: (n) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, x: (i % 4) * 3, y: 200 + Math.floor(i / 4) * 4, w: 3, h: 2 })),
  /** 임의 크기/위치가 섞인 겹침 없는 레이아웃 (add 로 쌓아 만든다) */
  mixed: (n) => {
    const r = rng(42);
    let items = [];
    for (let i = 0; i < n; i++) {
      items = addItem(items, COLUMNS, { id: `i${i}`, w: 1 + Math.floor(r() * 4), h: 1 + Math.floor(r() * 3) });
    }
    return items;
  },
};

function time(fn) {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 첫 실행으로 시간을 가늠하고, 빠르면 반복해 중앙값을 낸다 */
function measure(fn) {
  const first = time(fn);
  if (first > BUDGET_MS) return { ms: first, runs: 1, capped: true };
  const runs = first < 5 ? 15 : first < 100 ? 7 : first < 2000 ? 3 : 1;
  const samples = [first];
  for (let i = 1; i < runs; i++) samples.push(time(fn));
  return { ms: median(samples), runs, capped: false };
}

const cases = {
  'compact (전체 압축)': (items) => () => compact(items, undefined, false),
  'compact float (위로 올리지 않음)': (items) => () => compact(items, undefined, true),
  'moveItem (맨 앞 항목을 끝으로, 충돌 재배치)': (items) => () => moveItem(items, COLUMNS, items[0].id, 9, 9999, false),
  'moveItem (중간 항목을 (0,0)으로)': (items) => () => moveItem(items, COLUMNS, items[items.length >> 1].id, 0, 0, false),
  'resizeItem (맨 앞 항목 확대)': (items) => () => resizeItem(items, COLUMNS, items[0].id, 6, 6, false),
  'addItem (빈 자리 자동 배치)': (items) => () => addItem(items, COLUMNS, { id: 'new', w: 3, h: 2 }, false),
  'normalizeItems (불러오기)': (items) => () => normalizeItems(items, COLUMNS, false),
};

const results = [];
const skipFrom = {}; // 케이스+모양별로 한 번 상한을 넘으면 더 큰 n 은 건너뛴다
for (const [shape, make] of Object.entries(SHAPES)) {
  for (const n of SIZES) {
    const items = make(n);
    for (const [name, build] of Object.entries(cases)) {
      const key = `${shape}|${name}`;
      if (skipFrom[key]) {
        results.push({ shape, n, case: name, ms: null, skipped: true });
        continue;
      }
      const r = measure(build(items));
      if (r.capped) skipFrom[key] = true;
      results.push({ shape, n, case: name, ms: +r.ms.toFixed(3), runs: r.runs, capped: r.capped });
    }
  }
}

const env = {
  node: process.version,
  platform: `${os.platform()} ${os.release()}`,
  cpu: os.cpus()[0]?.model,
  cores: os.cpus().length,
  columns: COLUMNS,
  sizes: SIZES,
  budgetMs: BUDGET_MS,
  method: '각 케이스를 처음 한 번 실행해 시간을 가늠한 뒤 반복하여 중앙값(ms)을 기록. 입력은 매 반복 동일(순수 함수)',
};

// 표로 출력
const byCase = {};
for (const r of results) (byCase[`${r.shape} / ${r.case}`] ||= {})[r.n] = r;
console.log(`\n환경: ${env.node}, ${env.cpu} x${env.cores}`);
console.log(['케이스', ...SIZES.map((n) => `n=${n}`)].join('\t'));
for (const [k, row] of Object.entries(byCase)) {
  console.log([k, ...SIZES.map((n) => (row[n].skipped ? '(생략)' : row[n].capped ? `>${BUDGET_MS}ms` : `${row[n].ms}ms`))].join('\t'));
}

if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ env, results }, null, 2));
