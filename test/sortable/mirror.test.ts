import { createMirrorItem } from '@/sortable/mirror';

const rect = (width: number, height: number): DOMRect =>
  ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 } as DOMRect);

function makeItem(html: string): HTMLElement {
  const item = document.createElement('li');
  item.className = 'card';
  item.style.padding = '4px';
  item.innerHTML = html;
  document.body.appendChild(item);
  return item;
}

describe('createMirrorItem', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe("'clone' (기본)", () => {
    it('깊은 복사하되 원본은 건드리지 않는다', () => {
      const item = makeItem('<span class="t">제목</span><b>굵게</b>');
      const mirror = createMirrorItem(item, undefined);
      expect(mirror).not.toBe(item);
      expect(mirror.className).toBe('card');
      expect(mirror.querySelector('.t')?.textContent).toBe('제목');
      expect(mirror.querySelector('b')?.textContent).toBe('굵게');
      expect(item.querySelector('.t')).not.toBeNull();
      expect(item.hasAttribute('inert')).toBe(false);
    });

    it('iframe/video/audio/canvas 는 원본과 같은 크기의 빈 상자로 바꾼다', () => {
      const item = makeItem(
        '<iframe src="about:blank" class="f" style="margin:2px"></iframe><video></video><audio></audio><canvas width="10" height="10"></canvas>',
      );
      item.querySelectorAll('iframe,video,audio,canvas').forEach((el, i) => {
        el.getBoundingClientRect = () => rect(100 + i, 50 + i);
      });
      const mirror = createMirrorItem(item, 'clone');
      expect(mirror.querySelector('iframe,video,audio,canvas,object,embed')).toBeNull();
      const boxes = Array.from(mirror.children) as HTMLElement[];
      expect(boxes).toHaveLength(4);
      boxes.forEach((box, i) => {
        expect(box.tagName).toBe('DIV');
        expect(box.style.width).toBe(`${100 + i}px`);
        expect(box.style.height).toBe(`${50 + i}px`);
        expect(box.style.boxSizing).toBe('border-box');
      });
      expect(boxes[0].className).toBe('f'); // class/inline style 은 유지해 배치를 같게 한다
      expect(boxes[0].style.margin).toBe('2px');
      // 원본은 그대로
      expect(item.querySelector('iframe')).not.toBeNull();
      expect(item.querySelector('canvas')).not.toBeNull();
    });

    it('canvas 그림은 복사하지 않는다 (getContext 를 부르면 GPU 캔버스 초기화 비용이 크다)', () => {
      const item = makeItem('<canvas width="300" height="80"></canvas>');
      const canvas = item.querySelector('canvas') as HTMLCanvasElement;
      canvas.getBoundingClientRect = () => rect(300, 80);
      const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext');
      createMirrorItem(item, 'clone');
      expect(getContext).not.toHaveBeenCalled();
      getContext.mockRestore();
    });

    it('중첩된 무거운 요소(object 안의 embed)도 문제없이 처리한다', () => {
      const item = makeItem('<object><embed></object><span>끝</span>');
      item.querySelectorAll('object,embed').forEach((el) => {
        el.getBoundingClientRect = () => rect(40, 20);
      });
      const mirror = createMirrorItem(item, 'clone');
      expect(mirror.querySelector('object,embed')).toBeNull();
      expect(mirror.querySelector('span')?.textContent).toBe('끝');
    });

    it('display 가 none 인 요소는 숨긴 채 유지한다', () => {
      const item = makeItem('<iframe style="display:none"></iframe>');
      (item.querySelector('iframe') as HTMLElement).getBoundingClientRect = () => rect(0, 0);
      const box = createMirrorItem(item, 'clone').firstElementChild as HTMLElement;
      expect(box.style.display).toBe('none');
    });
  });

  describe("'box'", () => {
    it('내용 없이 항목 껍데기(태그, class, style)만 복사한다', () => {
      const item = makeItem('<span>무거운 내용</span>'.repeat(50));
      const mirror = createMirrorItem(item, 'box');
      expect(mirror.tagName).toBe('LI');
      expect(mirror.className).toBe('card');
      expect(mirror.style.padding).toBe('4px');
      expect(mirror.childNodes).toHaveLength(0);
    });
  });

  describe('함수', () => {
    it('돌려준 요소를 그대로 복제본으로 쓴다', () => {
      const item = makeItem('<span>원본</span>');
      const custom = document.createElement('div');
      custom.textContent = '미리보기';
      const mirror = createMirrorItem(item, (el) => {
        expect(el).toBe(item);
        return custom;
      });
      expect(mirror).toBe(custom);
      expect(mirror.textContent).toBe('미리보기');
    });

    it('요소가 아닌 값을 돌려주면 기본 복제로 대체한다', () => {
      const item = makeItem('<span>원본</span>');
      const mirror = createMirrorItem(item, (() => undefined) as unknown as () => HTMLElement);
      expect(mirror.querySelector('span')?.textContent).toBe('원본');
    });
  });

  it('복제본은 보기 전용이다: 접근성 트리와 포커스에서 제외한다', () => {
    const item = makeItem('<input value="x">');
    for (const mode of [undefined, 'box', () => document.createElement('div')] as const) {
      const mirror = createMirrorItem(item, mode);
      expect(mirror.getAttribute('aria-hidden')).toBe('true');
      expect(mirror.hasAttribute('inert')).toBe(true);
    }
  });
});
