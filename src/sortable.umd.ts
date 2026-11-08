import { createSortable, createSortableManager, Sortable, SortableManager } from './sortable';

// 브라우저 전역에 등록 (window.Daracl.sortable)
declare global {
  interface Window {
    Daracl?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

if (typeof window !== 'undefined') {
  window.Daracl = window.Daracl || {};
  window.Daracl.sortable = { Sortable, createSortable, SortableManager, createSortableManager };
}
