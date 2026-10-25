const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/** HTML 텍스트/속성 값으로 안전하게 출력하기 위해 escape 한다 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`]/g, (ch) => ESCAPE_MAP[ch]);
}

/** CSS class/scope 로 쓸 수 있는 식별자인지 검사한다 (CSS 주입 방지) */
export function assertScope(scope: string): string {
  if (!/^[a-z][a-z0-9-]*$/i.test(scope)) {
    throw new Error(`[drift] scope 는 영문/숫자/하이픈만 사용할 수 있습니다: ${scope}`);
  }
  return scope;
}

/** props 키를 data-* 속성 이름으로 변환한다. 허용되지 않으면 undefined */
export function toDataAttribute(key: string): string | undefined {
  const kebab = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(kebab) || kebab === 'drift-id') return undefined;
  return `data-${kebab}`;
}
