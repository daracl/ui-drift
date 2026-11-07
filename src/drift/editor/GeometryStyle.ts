import { DriftMetrics } from '@t/DriftLayout';

let sequence = 0;
let tokenSequence = 0;

/** 값이 커질수록 규칙 수가 늘어나므로, 필요한 최대값보다 여유를 두고 생성해 재생성 횟수를 줄인다 */
const HEADROOM = 30;

/** 같은 규칙 집합(설정 키)을 쓰는 에디터들이 함께 쓰는 스타일시트 */
interface SharedSheet {
  /** 선택자에 쓰는 짧은 식별자 (data-ddr-geo 값) */
  token: string;
  refs: number;
  sheet?: CSSStyleSheet;
  styleEl?: HTMLStyleElement;
}

/** 문서(또는 shadow root)별 공유 스타일시트. 설정 키 → 시트 */
const registry = new WeakMap<Document | ShadowRoot, Map<string, SharedSheet>>();

/**
 * 항목의 위치/크기를 data-x, data-y, data-w, data-h 속성으로 정하기 위한 CSS 규칙을 관리한다.
 * (GridStack 의 gs-x / gs-y 방식과 같다)
 *
 *   .daracl-drift[data-ddr-geo="g1"] > [data-x="3"] { left: calc((100% + 8px) * 3 / 12) }
 *   .daracl-drift[data-ddr-geo="g1"] > [data-w="4"] { width: calc((100% + 8px) * 4 / 12 - 8px) }
 *   .daracl-drift[data-ddr-geo="g1"] > [data-y="2"] { top: 96px }
 *   .daracl-drift[data-ddr-geo="g1"] > [data-h="3"] { height: 136px }
 *
 * - x/w 는 컬럼 수·gap 에만 의존하는 % 값이라 컨테이너 폭이 바뀌어도 규칙을 다시 만들 필요가 없다.
 * - y/h 는 rowHeight·gap 에 의존한다.
 * - 규칙은 설정 키(컬럼 수, gap, rowHeight, y/h 규칙 범위)로만 정해지므로, **설정이 같은 에디터들은 시트 하나를 공유**하고
 *   설정이 다른 에디터는 서로 다른 시트(data-ddr-geo)를 쓴다. 한 에디터의 설정이 바뀌면 그 에디터만 다른 시트로 옮겨 가며
 *   다른 에디터에는 영향이 없다. 아무도 쓰지 않는 시트는 제거된다(참조 수).
 *   (에디터가 많은 화면에서 시트가 에디터 수만큼 늘어나 스타일 무효화가 반복되던 비용을 줄인다)
 * - 에디터 인스턴스 식별자(data-ddr)는 그대로 둔다.
 * - 생성형(constructable) 스타일시트를 우선 사용하므로 엄격한 CSP(style-src)에서도 인라인 <style> 없이 동작한다.
 */
export class GeometryStyle {
  readonly uid = `e${++sequence}`;

  private readonly canvas: HTMLElement;
  private root: Document | ShadowRoot;
  private key = '';
  private shared?: SharedSheet;
  // 처음부터 여유분을 두어 흔한 범위의 y/h 규칙이 항상 존재하게 한다
  private capacityY = HEADROOM;
  private capacityH = HEADROOM;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    canvas.setAttribute('data-ddr', this.uid);
    const root = canvas.getRootNode();
    this.root = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root : document;
  }

  /** 현재 메트릭과 항목이 사용하는 최대 y/h 에 맞춰 규칙을 갱신한다 */
  update(m: DriftMetrics, maxY: number, maxH: number): void {
    if (maxY > this.capacityY) this.capacityY = maxY + HEADROOM;
    if (maxH > this.capacityH) this.capacityH = maxH + HEADROOM;

    const key = `${m.columns}|${m.gap}|${m.rowHeight}|${this.capacityY}|${this.capacityH}`;
    if (key === this.key) return;
    this.key = key;
    // 새 시트를 먼저 확보한 뒤 속성을 바꾸고 이전 시트를 놓는다 (규칙이 없는 순간이 없게)
    const next = this.acquire(key, m);
    this.canvas.setAttribute('data-ddr-geo', next.token);
    this.release();
    this.shared = next;
  }

  destroy(): void {
    this.release();
    this.key = '';
  }

  private sheets(): Map<string, SharedSheet> {
    let map = registry.get(this.root);
    if (!map) registry.set(this.root, (map = new Map()));
    return map;
  }

  private acquire(key: string, m: DriftMetrics): SharedSheet {
    const map = this.sheets();
    let entry = map.get(key);
    if (!entry) {
      entry = { token: `g${++tokenSequence}`, refs: 0 };
      this.create(entry, this.css(entry.token, m));
      map.set(key, entry);
    }
    entry.refs++;
    return entry;
  }

  /** 현재 시트의 참조를 놓는다. 아무도 쓰지 않으면 문서에서 제거한다 */
  private release(): void {
    const entry = this.shared;
    this.shared = undefined;
    if (!entry || --entry.refs > 0) return;
    const map = this.sheets();
    map.forEach((value, k) => value === entry && map.delete(k));
    if (entry.sheet) {
      const target = this.root as Document;
      target.adoptedStyleSheets = (target.adoptedStyleSheets || []).filter((s) => s !== entry.sheet);
    }
    entry.styleEl?.remove();
  }

  private css(token: string, m: DriftMetrics): string {
    const p = `.daracl-drift[data-ddr-geo="${token}"]>`;
    const stride = m.rowHeight + m.gap;
    const out: string[] = [];
    for (let x = 0; x < m.columns; x++)
      out.push(`${p}[data-x="${x}"]{left:calc((100% + ${m.gap}px) * ${x} / ${m.columns})}`);
    for (let w = 1; w <= m.columns; w++)
      out.push(`${p}[data-w="${w}"]{width:calc((100% + ${m.gap}px) * ${w} / ${m.columns} - ${m.gap}px)}`);
    for (let y = 0; y <= this.capacityY; y++) out.push(`${p}[data-y="${y}"]{top:${y * stride}px}`);
    for (let h = 1; h <= this.capacityH; h++) out.push(`${p}[data-h="${h}"]{height:${h * stride - m.gap}px}`);
    return out.join('\n');
  }

  private create(entry: SharedSheet, css: string): void {
    const target = this.root as Document;
    if (
      typeof CSSStyleSheet === 'function' &&
      'replaceSync' in CSSStyleSheet.prototype &&
      'adoptedStyleSheets' in target
    ) {
      entry.sheet = new CSSStyleSheet();
      entry.sheet.replaceSync(css);
      target.adoptedStyleSheets = [...target.adoptedStyleSheets, entry.sheet];
      return;
    }
    // 생성형 스타일시트를 지원하지 않는 환경(구형 브라우저, jsdom)의 대체 경로
    entry.styleEl = document.createElement('style');
    entry.styleEl.setAttribute('data-ddr-style', entry.token);
    entry.styleEl.textContent = css;
    (this.root === document ? document.head : (this.root as ShadowRoot)).appendChild(entry.styleEl);
  }
}
