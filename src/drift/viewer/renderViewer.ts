import { TITLE_HEIGHT } from '@/drift/constants';
import { compareYX } from '@/drift/core/geometry';
import { parseLayout } from '@/drift/core/layout';
import { getBreakpoints, resolveItems } from '@/drift/core/responsive';
import { DriftGeometry, DriftItem, DriftLayout } from '@t/DriftLayout';
import { assertScope, escapeHtml, toDataAttribute } from './escape';

export interface ViewerOptions {
  /** CSS 클래스 접두사 겸 충돌 방지 범위 (기본 'ddr') */
  scope?: string;
  /**
   * 항목 내부 HTML 을 직접 만든다. 반환 값은 escape 되지 않으므로 신뢰할 수 있는 HTML 만 반환해야 한다.
   * 지정하지 않으면 item.content(없으면 빈 문자열)가 텍스트로 출력된다.
   */
  renderContent?: (item: DriftItem) => string;
}

export interface ViewerPageOptions extends ViewerOptions {
  title?: string;
  lang?: string;
  /** 외부 CSS 파일 경로. 지정하면 <link> 로 연결한다 (CSP 에 가장 안전) */
  cssHref?: string;
  /** 지정하면 <style nonce> 로 CSS 를 인라인한다 */
  nonce?: string;
}

export interface ViewerResult {
  html: string;
  css: string;
  scope: string;
}

const fmt = (n: number): string => String(Number.isFinite(n) ? n : 0);

/**
 * 저장된 레이아웃을 정적 HTML 과 CSS 문자열로 변환한다.
 * 출력에는 <script>, 이벤트 핸들러, 인라인 style 이 없으며 위치/크기/반응형은 모두 CSS 로 표현된다.
 * 입력은 parseLayout 으로 검증/보정된다.
 */
export function renderViewer(input: DriftLayout | string | unknown, options: ViewerOptions = {}): ViewerResult {
  const layout = parseLayout(input);
  const scope = assertScope(options.scope || 'ddr');
  const sorted = layout.items.slice().sort(compareYX);

  const levels = resolveLevels(layout, sorted);

  return {
    scope,
    html: buildHtml(sorted, levels, scope, options),
    css: buildCss(layout, sorted, levels, scope),
  };
}

type Axis = 'x' | 'y' | 'w' | 'h';
const AXES: Axis[] = ['x', 'y', 'w', 'h'];

/** data 속성 값 → grid 속성. x/y 는 1 기반 시작선, w/h 는 span */
const RULE: Record<Axis, (v: number) => string> = {
  x: (v) => `grid-column-start:${v + 1}`,
  w: (v) => `grid-column-end:span ${v}`,
  y: (v) => `grid-row-start:${v + 1}`,
  h: (v) => `grid-row-end:span ${v}`,
};

/** 기본 레이아웃의 속성 이름은 data-x, breakpoint(큰 것부터 0,1,..)는 data-bp0-x 처럼 만든다 */
const attrName = (level: number, axis: Axis): string => (level < 0 ? `data-${axis}` : `data-bp${level}-${axis}`);

interface Levels {
  /** levels[0] = 기본, levels[1..] = breakpoint(큰 것부터) 에서 실제로 쓰일 위치/크기 */
  geometry: Map<string, DriftGeometry>[];
  columns: number[];
  maxWidths: number[];
}

function resolveLevels(layout: DriftLayout, sorted: DriftItem[]): Levels {
  const base = new Map<string, DriftGeometry>(sorted.map((item) => [item.id, item]));
  const geometry = [base];
  const columns = [layout.columns];
  const maxWidths: number[] = [];
  for (const bp of getBreakpoints(layout)) {
    geometry.push(new Map(resolveItems(layout, bp).map((item) => [item.id, item])));
    columns.push(bp.columns);
    maxWidths.push(bp.maxWidth);
  }
  return { geometry, columns, maxWidths };
}

/** 이전 단계와 값이 달라진 축만 [levelIndex → axis → value] 로 반환한다 */
function changedValue(levels: Levels, level: number, id: string, axis: Axis): number | undefined {
  const cur = (levels.geometry[level].get(id) as DriftGeometry)[axis];
  if (level === 0) return cur;
  const prev = (levels.geometry[level - 1].get(id) as DriftGeometry)[axis];
  return cur === prev ? undefined : cur;
}

function buildHtml(sorted: DriftItem[], levels: Levels, scope: string, options: ViewerOptions): string {
  const items = sorted.map((item) => {
    // 위치/크기는 data 속성으로만 표현하고, 실제 배치는 속성 선택자 CSS 가 담당한다 (인라인 style/클래스 없음)
    let attrs = `class="${scope}-item" data-drift-id="${escapeHtml(item.id)}"`;
    for (let level = 0; level < levels.geometry.length; level++) {
      for (const axis of AXES) {
        const v = changedValue(levels, level, item.id, axis);
        if (v !== undefined) attrs += ` ${attrName(level - 1, axis)}="${v}"`;
      }
    }
    for (const [key, value] of Object.entries(item.props || {})) {
      const name = toDataAttribute(key);
      if (name && value !== null) attrs += ` ${name}="${escapeHtml(value)}"`;
    }
    const inner = options.renderContent ? options.renderContent(item) : escapeHtml(item.content ?? '');
    const title = item.title ? `<div class="${scope}-title">${escapeHtml(item.title)}</div>` : '';
    return `<div ${attrs}>${title}${inner}</div>`;
  });
  return `<div class="${scope}-viewer">${items.join('')}</div>`;
}

function buildCss(layout: DriftLayout, sorted: DriftItem[], levels: Levels, scope: string): string {
  const root = `.${scope}-viewer`;
  const cols = (n: number) => `grid-template-columns:repeat(${fmt(n)},minmax(0,1fr))`;

  const rules: string[] = [
    `${root}{display:grid;box-sizing:border-box;width:100%;${cols(layout.columns)};grid-auto-rows:${fmt(
      layout.rowHeight,
    )}px;gap:${fmt(layout.gap)}px}`,
    `${root}>.${scope}-item{box-sizing:border-box;min-width:0;min-height:0;overflow:auto;border:1px solid #d0d7de;border-radius:6px}`,
    `${root}>.${scope}-item>.${scope}-title{box-sizing:border-box;height:${TITLE_HEIGHT}px;margin:0;overflow:hidden;font-weight:600;line-height:${TITLE_HEIGHT}px;white-space:nowrap;text-overflow:ellipsis}`,
  ];

  /** 같은 값은 한 규칙으로 묶는다: [data-x="3"]{grid-column-start:4} */
  const valueRules = (level: number): string[] => {
    const out: string[] = [];
    for (const axis of AXES) {
      const values = new Set<number>();
      for (const item of sorted) {
        const v = changedValue(levels, level, item.id, axis);
        if (v !== undefined) values.add(v);
      }
      Array.from(values)
        .sort((a, b) => a - b)
        .forEach((v) => out.push(`${root}>[${attrName(level - 1, axis)}="${v}"]{${RULE[axis](v)}}`));
    }
    return out;
  };

  // 기본(desktop) 배치
  rules.push(...valueRules(0));

  // 큰 breakpoint 부터 max-width 미디어 쿼리로 덮어쓴다. 이전 단계와 달라진 값만 출력
  for (let level = 1; level < levels.geometry.length; level++) {
    const body = [`${root}{${cols(levels.columns[level])}}`, ...valueRules(level)];
    rules.push(`@media (max-width:${fmt(levels.maxWidths[level - 1])}px){${body.join('')}}`);
  }

  return rules.join('\n');
}

/**
 * 완전한 HTML 문서를 만든다. viewport meta 를 포함하며 스크립트는 포함하지 않는다.
 * cssHref 가 없으면 CSS 를 <style> 로 인라인한다(nonce 지정 가능).
 */
export function renderViewerPage(input: DriftLayout | string | unknown, options: ViewerPageOptions = {}): string {
  const { html, css } = renderViewer(input, options);
  const style = options.cssHref
    ? `<link rel="stylesheet" href="${escapeHtml(options.cssHref)}">`
    : `<style${options.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : ''}>${css.replace(
        /<\/style/gi,
        '<\\/style',
      )}</style>`;

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(options.lang || 'ko')}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(options.title || 'Drift Viewer')}</title>${style}</head>`,
    `<body>${html}</body>`,
    '</html>',
  ].join('\n');
}
