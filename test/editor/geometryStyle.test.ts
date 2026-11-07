import { createDriftEditor } from '@/index';

/** jsdom 은 생성형 스타일시트가 없어 <style data-ddr-style> 대체 경로를 쓴다 */
const styles = () => Array.from(document.querySelectorAll<HTMLStyleElement>('style[data-ddr-style]'));
const geoOf = (host: HTMLElement) => (host.querySelector('.daracl-drift') as HTMLElement).dataset.ddrGeo;

describe('GeometryStyle: 설정이 같은 에디터는 위치 스타일시트를 공유한다', () => {
  const hosts: HTMLElement[] = [];
  const host = () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    hosts.push(el);
    return el;
  };
  afterEach(() => {
    hosts.splice(0).forEach((el) => el.remove());
    expect(styles()).toHaveLength(0);
  });

  it('같은 설정은 시트 하나, 다른 설정은 별도 시트를 쓰고 마지막 사용자가 해제하면 제거된다', () => {
    const editors = Array.from({ length: 5 }, () => createDriftEditor(host(), { columns: 12 }));
    const other = createDriftEditor(host(), { columns: 6 });
    expect(styles()).toHaveLength(2);
    expect(new Set(editors.map((e) => e.element.dataset.ddrGeo)).size).toBe(1);
    expect(other.element.dataset.ddrGeo).not.toBe(editors[0].element.dataset.ddrGeo);
    // 인스턴스 식별자는 에디터마다 다르다
    expect(new Set(editors.map((e) => e.element.dataset.ddr)).size).toBe(5);

    editors.slice(0, 4).forEach((e) => e.destroy());
    expect(styles()).toHaveLength(2);
    editors[4].destroy();
    expect(styles()).toHaveLength(1);
    other.destroy();
  });

  it('한 에디터의 설정(행 범위)이 바뀌면 그 에디터만 다른 시트로 옮겨 가고 나머지는 그대로다', () => {
    const a = createDriftEditor(host(), { columns: 12 });
    const b = createDriftEditor(host(), { columns: 12 });
    const shared = geoOf(hosts[0]);
    expect(geoOf(hosts[1])).toBe(shared);
    a.addItem({ id: 'far', x: 0, y: 80, w: 2, h: 2 }, {});
    a.setFloat(true);
    a.moveItem('far', 0, 80);
    expect(a.getItem('far')?.y).toBe(80);
    expect(geoOf(hosts[0])).not.toBe(shared);
    expect(geoOf(hosts[1])).toBe(shared);
    const css = styles()
      .map((s) => s.textContent || '')
      .join('\n');
    expect(css).toContain(`[data-ddr-geo="${geoOf(hosts[0])}"]>[data-y="80"]`);
    expect(styles()).toHaveLength(2);
    a.destroy();
    b.destroy();
  });
});
