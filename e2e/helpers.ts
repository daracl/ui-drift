import { Page } from '@playwright/test';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`요소를 찾을 수 없습니다: ${selector}`);
  return b;
}

export const item = (id: string) => `[data-drift-id="${id}"]`;

/** 편집기가 노출한 window.editor 의 항목 겹침 여부 */
export async function hasOverlap(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const items = (window as any).editor.getItems(); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) return true;
      }
    }
    return false;
  });
}

export async function getItem(page: Page, id: string) {
  return page.evaluate((i) => (window as any).editor.getItem(i), id); // eslint-disable-line @typescript-eslint/no-explicit-any
}
