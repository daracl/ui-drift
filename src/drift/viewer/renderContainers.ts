import { parseContainerData } from '@/drift/core/containers';
import { getRowCount } from '@/drift/core/geometry';
import { DriftContainerData, DriftContainerMargin, DriftItem } from '@t/DriftLayout';
import { DEFAULT_FIT_MIN_HEIGHT, DEFAULT_MOBILE_MAX_WIDTH, renderViewer, ViewerOptions } from './renderViewer';
import { assertScope, escapeHtml } from './escape';

export interface ContainersViewerOptions extends Omit<ViewerOptions, 'renderContent'> {
  /**
   * 바깥 묶음의 CSS 클래스 접두사 (기본 'ddr'). 각 컨테이너는 `${scope}-c0`, `${scope}-c1` … 처럼 순번 scope 를 쓴다
   * (컨테이너 id 는 임의 문자열이라 CSS 이름으로 쓰지 않는다).
   */
  scope?: string;
  /** 항목 내부 HTML 을 직접 만든다. 반환 값은 escape 되지 않는다 (renderViewer 와 같다) */
  renderContent?: (item: DriftItem, containerId: string) => string;
  /**
   * 모든 컨테이너 사이 간격(px). 기본 12. 음수/잘못된 값이면 기본값.
   * 컨테이너별 여백은 각 레이아웃의 `containerMargin` 으로 정하며, 둘을 함께 쓰면 더해진다.
   */
  containerGap?: number;
}

export interface ContainersViewerResult {
  html: string;
  css: string;
  scope: string;
  /** 컨테이너별 렌더링 정보 (데이터 순서). height 는 실제로 적용된 방식 */
  containers: { id: string; scope: string; height: 'auto' | 'fixed'; rows: number; margin: string; zIndex: number }[];
}

const fmt = (n: number): string => String(Number.isFinite(n) ? n : 0);
const NO_MARGIN = '0px 0px 0px 0px';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNegative = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

/** margin → CSS 값 ('8px 0px -4px 0px'). 음수도 그대로 쓰고, 잘못된 값(NaN 등)은 0 */
function marginValue(input: number | DriftContainerMargin | undefined): string {
  const o = typeof input === 'number' ? { top: input, right: input, bottom: input, left: input } : input || {};
  return [o.top, o.right, o.bottom, o.left].map((v) => `${fmt(isFiniteNumber(v) ? v : 0)}px`).join(' ');
}

/**
 * 여러 컨테이너 레이아웃 묶음(DriftContainerData)을 세로로 쌓은 정적 HTML 과 CSS 로 만든다.
 *
 * `fitHeight` 이면 바깥 묶음이 부모 높이(height:100%)를 채운다.
 * - `height:'auto'` 컨테이너: 고정 컨테이너를 뺀 남은 높이를 auto 컨테이너끼리 **행 수 비율**로 나누고,
 *   그 안에서 다시 행 수로 나눠 채운다 (renderViewer fitHeight 와 같다).
 * - 그 밖의 컨테이너: 고정 높이. 행 수 × rowHeight (+ 행 사이 gap) 의 일반 Viewer 배치다.
 * - auto 컨테이너가 하나도 없으면 모든 컨테이너를 auto 로 본다.
 * - `minHeight` 는 바깥 묶음 전체에 적용된다. mobileMaxWidth 이하에서는 맞춤을 끄고 모두 rowHeight 로 쌓는다.
 *
 * 컨테이너가 겹치면(음수 containerMargin 등) 위에 있는(앞 순서) 컨테이너가 위로 올라온다 (z-index = 개수 - 순번).
 *
 * fitHeight 가 아니면 모든 컨테이너를 일반 Viewer 로 쌓는다. 출력에는 스크립트/인라인 style 이 없다.
 */
export function renderContainersViewer(
  input: DriftContainerData | string | unknown,
  options: ContainersViewerOptions = {},
): ContainersViewerResult {
  const data = parseContainerData(input);
  const scope = assertScope(options.scope || 'ddr');
  const { renderContent, containerGap, fitHeight, ...viewerOptions } = options;
  const fit = fitHeight ? (fitHeight === true ? {} : fitHeight) : undefined;
  const minHeight = nonNegative(fit?.minHeight, DEFAULT_FIT_MIN_HEIGHT);
  // fitHeight 를 쓰면 모바일 처리가 기본으로 켜진다. 고정 컨테이너도 같은 폭에서 쌓이도록 값을 맞춘다
  const mobile = fit ? nonNegative(options.mobileMaxWidth, DEFAULT_MOBILE_MAX_WIDTH) : options.mobileMaxWidth;
  const anyAuto = data.containers.some((c) => c.height === 'auto');

  const root = `.${scope}-containers`;
  const css: string[] = [];
  const html: string[] = [];
  const containers: ContainersViewerResult['containers'] = [];
  const margins: string[] = [];

  data.containers.forEach((c, i) => {
    const auto = !!fit && (!anyAuto || c.height === 'auto');
    const rows = Math.max(getRowCount(c.layout.items), 1);
    const inner = renderViewer(c.layout, {
      ...viewerOptions,
      scope: `${scope}-c${i}`,
      mobileMaxWidth: mobile,
      // 최소 높이는 바깥 묶음이 지킨다
      fitHeight: auto ? { minRowHeight: fit?.minRowHeight, minHeight: 0 } : false,
      renderContent: renderContent ? (item) => renderContent(item, c.id) : undefined,
    });
    css.push(inner.css);
    // 레이아웃의 containerMargin. 같은 값은 한 규칙으로 묶어 data-margin 번호로 연결한다
    const margin = marginValue(c.layout.containerMargin);
    if (!margins.includes(margin)) margins.push(margin);
    let attrs = `class="${scope}-container" data-container-id="${escapeHtml(c.id)}"`;
    if (margin !== NO_MARGIN) attrs += ` data-margin="${margins.indexOf(margin)}"`;
    if (fit) attrs += ` data-height="${auto ? 'auto' : 'fixed'}"${auto ? ` data-rows="${rows}"` : ''}`;
    html.push(`<div ${attrs}>${inner.html}</div>`);
    containers.push({
      id: c.id,
      scope: inner.scope,
      height: auto ? 'auto' : 'fixed',
      rows,
      margin,
      zIndex: data.containers.length - i,
    });
  });

  css.push(
    `${root}{display:flex;flex-direction:column;box-sizing:border-box;width:100%;gap:${fmt(
      nonNegative(containerGap, 12),
    )}px}`,
    `${root}>.${scope}-container{flex:none;min-width:0;position:relative}`,
    // 겹칠 때 앞 순서(위쪽) 컨테이너가 위로 오게 한다
    ...containers.map((c, i) => `${root}>:nth-child(${i + 1}){z-index:${c.zIndex}}`),
    // margin 은 flex 항목의 바깥 크기에 포함되므로 fitHeight 의 남은 높이 계산에서 자동으로 빠진다
    ...margins.flatMap((m, i) => (m === NO_MARGIN ? [] : [`${root}>[data-margin="${i}"]{margin:${m}}`])),
  );
  if (fit) {
    const autoRows = Array.from(new Set(containers.filter((c) => c.height === 'auto').map((c) => c.rows))).sort(
      (a, b) => a - b,
    );
    css.push(
      `${root}{height:100%;min-height:${fmt(minHeight)}px}`,
      // auto 컨테이너는 flex 로 남은 높이를 받고, 안쪽 Viewer 도 flex 로 채운다 (부모 높이가 percent 로 정해지지 않아도 된다)
      `${root}>[data-height="auto"]{display:flex;flex-direction:column}`,
      `${root}>[data-height="auto"]>*{flex:1 1 0px;height:auto}`,
      // 남은 높이를 행 수 비율로 나눈다
      ...autoRows.map((r) => `${root}>[data-rows="${r}"]{flex:${r} 1 0px}`),
      `@media (max-width:${fmt(
        mobile as number,
      )}px){${root}{height:auto;min-height:0}${root}>[data-height="auto"]{flex:none;display:block}}`,
    );
  }

  return { scope, html: `<div class="${scope}-containers">${html.join('')}</div>`, css: css.join('\n'), containers };
}
