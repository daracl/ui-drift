import { DriftMetrics } from '@t/DriftLayout';

let sequence = 0;

/** 값이 커질수록 규칙 수가 늘어나므로, 필요한 최대값보다 여유를 두고 생성해 재생성 횟수를 줄인다 */
const HEADROOM = 30;

/**
 * 항목의 위치/크기를 data-x, data-y, data-w, data-h 속성으로 정하기 위한 CSS 규칙을 관리한다.
 * (GridStack 의 gs-x / gs-y 방식과 같다)
 *
 *   .daracl-drift[data-ddr="e1"] > [data-x="3"] { left: calc((100% + 8px) * 3 / 12) }
 *   .daracl-drift[data-ddr="e1"] > [data-w="4"] { width: calc((100% + 8px) * 4 / 12 - 8px) }
 *   .daracl-drift[data-ddr="e1"] > [data-y="2"] { top: 96px }
 *   .daracl-drift[data-ddr="e1"] > [data-h="3"] { height: 136px }
 *
 * - x/w 는 컬럼 수·gap 에만 의존하는 % 값이라 컨테이너 폭이 바뀌어도 규칙을 다시 만들 필요가 없다.
 * - y/h 는 rowHeight·gap 에 의존한다.
 * - 규칙은 에디터 인스턴스별로 분리(data-ddr)되어 여러 에디터가 서로 영향을 주지 않는다.
 * - 생성형(constructable) 스타일시트를 우선 사용하므로 엄격한 CSP(style-src)에서도 인라인 <style> 없이 동작한다.
 */
export class GeometryStyle {
  readonly uid = `e${++sequence}`;

  private sheet?: CSSStyleSheet;
  private styleEl?: HTMLStyleElement;
  private root: Document | ShadowRoot;
  private key = '';
  // 처음부터 여유분을 두어 흔한 범위의 y/h 규칙이 항상 존재하게 한다
  private capacityY = HEADROOM;
  private capacityH = HEADROOM;

  constructor(canvas: HTMLElement) {
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
    this.write(this.css(m));
  }

  destroy(): void {
    if (this.sheet) {
      const sheets = (this.root as Document).adoptedStyleSheets || [];
      (this.root as Document).adoptedStyleSheets = sheets.filter((s) => s !== this.sheet);
      this.sheet = undefined;
    }
    this.styleEl?.remove();
    this.styleEl = undefined;
  }

  private css(m: DriftMetrics): string {
    const p = `.daracl-drift[data-ddr="${this.uid}"]>`;
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

  private write(css: string): void {
    if (!this.sheet && !this.styleEl) this.create();
    if (this.sheet) this.sheet.replaceSync(css);
    else if (this.styleEl) this.styleEl.textContent = css;
  }

  private create(): void {
    const target = this.root as Document;
    if (
      typeof CSSStyleSheet === 'function' &&
      'replaceSync' in CSSStyleSheet.prototype &&
      'adoptedStyleSheets' in target
    ) {
      this.sheet = new CSSStyleSheet();
      target.adoptedStyleSheets = [...target.adoptedStyleSheets, this.sheet];
      return;
    }
    // 생성형 스타일시트를 지원하지 않는 환경(구형 브라우저, jsdom)의 대체 경로
    this.styleEl = document.createElement('style');
    this.styleEl.setAttribute('data-ddr-style', this.uid);
    (this.root === document ? document.head : (this.root as ShadowRoot)).appendChild(this.styleEl);
  }
}
