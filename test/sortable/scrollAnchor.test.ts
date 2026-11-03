import { disableScrollAnchoring, restoreScrollAnchoring, ScrollAnchorHold } from '@/dom/scrollAnchor';

describe('scrollAnchor', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('start 와 모든 조상의 overflow-anchor 를 끄고, 복원하면 원래 값으로 돌아간다', () => {
    document.body.innerHTML = '<div id="a"><div id="b"><div id="c"></div></div></div>';
    // jsdom 은 overflow-anchor 를 인식하지 못해 마크업의 style 속성은 버려지므로 속성으로 직접 지정한다
    (document.getElementById('a') as HTMLElement).style.overflowAnchor = 'auto';
    const held: ScrollAnchorHold = new Map();
    const c = document.getElementById('c') as HTMLElement;
    disableScrollAnchoring(c, held);
    ['a', 'b', 'c'].forEach((id) =>
      expect((document.getElementById(id) as HTMLElement).style.overflowAnchor).toBe('none'),
    );
    expect(document.documentElement.style.overflowAnchor).toBe('none');

    restoreScrollAnchoring(held);
    expect((document.getElementById('a') as HTMLElement).style.overflowAnchor).toBe('auto');
    expect((document.getElementById('b') as HTMLElement).style.overflowAnchor).toBe('');
    expect(document.documentElement.style.overflowAnchor).toBe('');
    expect(held.size).toBe(0);
  });

  it('이미 처리한 요소를 만나면 그 위 조상은 다시 처리하지 않는다', () => {
    document.body.innerHTML = '<div id="a"><div id="b"></div><div id="c"></div></div>';
    const held: ScrollAnchorHold = new Map();
    disableScrollAnchoring(document.getElementById('b'), held);
    const size = held.size;
    disableScrollAnchoring(document.getElementById('c'), held);
    expect(held.size).toBe(size + 1); // c 만 추가된다
    restoreScrollAnchoring(held);
  });
});
