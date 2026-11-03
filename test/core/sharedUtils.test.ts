import { clamp, cloneJson } from '@daracl/core/utils';
import { clamp as driftClamp } from '../../src/drift/core/geometry';
import { cloneLayout, createLayout } from '../../src/drift/core/layout';
import { escapeHtml, toDataAttribute } from '../../src/drift/viewer/escape';

describe('공통 유틸 연동 계약', () => {
  it('공개 clamp를 유지하고 공통 구현을 사용한다', () => {
    expect(driftClamp(5, 0, 12)).toBe(clamp(5, 0, 12));
    expect(driftClamp(-1, 0, 12)).toBe(0);
    expect(driftClamp(20, 0, 12)).toBe(12);
  });

  it('JSON 복사 규칙과 중첩 데이터의 격리를 유지한다', () => {
    const layout = createLayout({ items: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, props: { label: '원본' } }] });
    const copy = cloneLayout(layout);
    expect(copy).toEqual(cloneJson(layout));
    copy.items[0].props!.label = '변경';
    expect(layout.items[0].props!.label).toBe('원본');
  });

  it('속성명 변환 후 검증하고 HTML의 여섯 문자를 계속 보호한다', () => {
    expect(toDataAttribute('chartType')).toBe('data-chart-type');
    expect(toDataAttribute('driftId')).toBeUndefined();
    expect(toDataAttribute('bad"key')).toBeUndefined();
    expect(escapeHtml('&<>"\'`')).toBe('&amp;&lt;&gt;&quot;&#39;&#96;');
  });
});
