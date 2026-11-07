import type { DriftEditor } from './DriftEditor';
import { measureScrollTarget } from './scrollContainer';

export interface CanvasHit {
  editor: DriftEditor;
  canvas: DOMRect;
}

/**
 * 포인터가 캔버스의 '보이는' 영역 위에 있는지. 컨테이너/스크롤 대상 밖으로 잘려 안 보이는 부분은 제외한다.
 * (외부 끌어오기와 컨테이너 간 이동이 같은 규칙으로 대상을 고른다)
 */
export function isOverCanvas(editor: DriftEditor, x: number, y: number, canvas: DOMRect): boolean {
  if (x < canvas.left || x > canvas.right) return false;
  const { top, bottom } = measureScrollTarget(editor.getScrollElement());
  const host = (editor.element.parentElement ?? editor.element).getBoundingClientRect();
  return y >= Math.max(canvas.top, host.top, top) && y <= Math.min(canvas.bottom, host.bottom, bottom);
}

/**
 * 포인터 아래의 대상 에디터를 고른다. destroy 되었거나 문서에서 떨어진 캔버스는 제외한다.
 * 여러 캔버스가 화면에서 겹치면 실제로 포인터 아래에 그려진 쪽, 판단할 수 없으면 현재 대상(떨림 방지) → 앞 순서를 고른다.
 */
export function pickCanvas(
  editors: Iterable<DriftEditor>,
  x: number,
  y: number,
  current?: DriftEditor,
): CanvasHit | undefined {
  const hits: CanvasHit[] = [];
  for (const editor of editors) {
    if (editor.isDestroyed() || !editor.element.isConnected) continue;
    const canvas = editor.element.getBoundingClientRect();
    if (isOverCanvas(editor, x, y, canvas)) hits.push({ editor, canvas });
  }
  if (hits.length <= 1) return hits[0];
  // 복제본(ghost)은 pointer-events:none 이므로 elementFromPoint 는 그 아래의 실제 요소를 돌려준다
  const top = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  const drawn = top ? hits.find((h) => h.editor.element.contains(top)) : undefined;
  return drawn ?? hits.find((h) => h.editor === current) ?? hits[0];
}
