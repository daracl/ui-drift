// 에디터(실제 Chromium) 연산 비용 측정. jsdom 이 아니라 실제 브라우저에서 스타일/레이아웃까지 포함해 잰다.
// 사용: (개발 서버 기동) npx vite --config vite.config.dev.js --port 5199 --host 127.0.0.1
//       node scripts/bench-editor.cjs [결과.json]
// 각 연산을 REPEAT 번 실행해 중앙값(ms)을 기록한다. 연산 직후 레이아웃을 강제(offsetHeight)해 DOM 반영 비용을 포함한다.
// 이 수치는 프로그램 호출 경로 비용이며 사용자 드래그의 프레임 시간과 동일하지 않다.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');

const BASE = process.env.BENCH_URL || 'http://127.0.0.1:5199';
const SIZES = (process.env.BENCH_SIZES || '100,300,1000').split(',').map(Number);
const REPEAT = Number(process.env.BENCH_REPEAT || 9);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/uitest/api.html`);
  await page.waitForFunction(() => window.__ready === true);

  const results = [];
  for (const n of SIZES) {
    const r = await page.evaluate(
      ([n, repeat]) => {
        const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
        const layoutOf = (n) => ({
          columns: 12,
          items: Array.from({ length: n }, (_, i) => ({
            id: `i${i}`,
            x: (i % 4) * 3,
            y: Math.floor(i / 4) * 2,
            w: 3,
            h: 2,
            title: `T${i}`,
            content: `C${i}`,
            props: { k: i },
          })),
        });
        const host = document.getElementById('host');
        const out = {};
        const time = (name, fn, setup) => {
          const samples = [];
          for (let i = 0; i < repeat; i++) {
            if (setup) setup(i);
            const t = performance.now();
            fn(i);
            void document.body.offsetHeight; // 스타일/레이아웃 강제
            samples.push(performance.now() - t);
          }
          out[name] = +median(samples).toFixed(3);
        };

        // 1) 생성(첫 렌더) / 파괴
        host.innerHTML = '';
        let ed;
        time('생성(첫 렌더)', () => {
          ed = window.Drift.createDriftEditor(host, { layout: layoutOf(n), animate: false });
        }, () => {
          if (ed) ed.destroy();
        });
        ed.destroy();
        host.innerHTML = '';
        ed = window.Drift.createDriftEditor(host, { layout: layoutOf(n), animate: false });

        // 2) 변경 없는 전체 렌더 (refresh = 측정 + render)
        time('refresh (변경 없는 전체 렌더)', () => ed.refresh());

        // 3) 변경 없는 커밋 (같은 자리로 이동)
        time('moveItem 변경 없음', () => ed.moveItem('i0', 0, 0));

        // 4) 변경이 있는 커밋: 두 위치를 번갈아 이동 (리스너 없음 / 있음)
        let flip = false;
        time('moveItem 변경 있음 (리스너 없음)', () => {
          flip = !flip;
          ed.moveItem('i0', flip ? 9 : 0, flip ? 3 : 0);
        });
        let events = 0;
        ed.on('layoutChange', () => events++);
        time('moveItem 변경 있음 (layoutChange 리스너 1개)', () => {
          flip = !flip;
          ed.moveItem('i0', flip ? 9 : 0, flip ? 3 : 0);
        });

        // 5) 콘텐츠 변경 / 위치만 변경
        time('updateItem (title 변경)', (i) => ed.updateItem('i1', { title: `X${i}` }));
        time('updateItem (위치/크기만 변경)', (i) => ed.updateItem('i2', { w: 3 + (i % 2) }));

        // 6) 추가 + 삭제
        time('addItem + removeItem', () => {
          ed.addItem({ id: 'tmp', w: 3, h: 2 });
          ed.removeItem('tmp');
        });

        // 7) 외부 모델 동기화 상당: load (같은 데이터) / 전체 교체
        const data = layoutOf(n);
        time('load (같은 데이터 다시 불러오기)', () => ed.load(data));
        // 8) 외부 모델 동기화: 항목의 20% 크기를 번갈아 바꾼 목록을 반영 (리스너 1개, 이벤트 수 비교)
        const listFor = (t) => layoutOf(n).items.map((it, i) => (i % 5 === 0 ? { ...it, w: t ? 2 : 3 } : it));
        const changedIds = layoutOf(n).items.filter((_, i) => i % 5 === 0).map((it) => it.id);
        ed.load(layoutOf(n));
        let before = events;
        let t = 0;
        time('syncItems (20% 항목 크기 변경)', () => {
          t ^= 1;
          ed.syncItems(listFor(t));
        });
        out.syncItemsEvents = (events - before) / repeat;
        ed.load(layoutOf(n));
        before = events;
        t = 0;
        time('updateItem 개별 호출 (20% 항목)', () => {
          t ^= 1;
          for (const id of changedIds) ed.updateItem(id, { w: t ? 2 : 3 });
        });
        out.updateItemEvents = (events - before) / repeat;
        ed.load(layoutOf(n));
        time('syncItems 변경 없음', () => ed.syncItems(layoutOf(n).items));

        // 9) 이력 비용: history:false 에디터의 변경 있는 moveItem
        ed.destroy();
        host.innerHTML = '';
        ed = window.Drift.createDriftEditor(host, { layout: layoutOf(n), animate: false, history: false });
        let f3 = false;
        time('moveItem 변경 있음 (history:false)', () => {
          f3 = !f3;
          ed.moveItem('i0', f3 ? 9 : 0, f3 ? 3 : 0);
        });
        out.eventsDuringBench = events;
        ed.destroy();
        return out;
      },
      [n, REPEAT],
    );
    results.push({ n, ...r });
  }

  const env = {
    chromium: browser.version(),
    node: process.version,
    cpu: os.cpus()[0].model,
    cores: os.cpus().length,
    viewport: '1280x900',
    repeat: REPEAT,
    layout: '12열, 항목 3x2 를 4개씩 쌓은 빽빽한 레이아웃, title/content/props 포함',
    method: '연산 직후 offsetHeight 로 스타일/레이아웃을 강제한 시간(ms)의 중앙값',
  };
  console.log(JSON.stringify({ env, results }, null, 2));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ env, results }, null, 2));
  await browser.close();
})();
