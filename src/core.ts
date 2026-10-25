export { compact } from './core/compact';
export { diffItems, itemsEqual, layoutsEqual } from './core/diff';
export { isMovable, isResizable } from './core/flags';
export {
  clamp,
  collides,
  compareYX,
  createMetrics,
  findCollisions,
  firstCollision,
  getRowCount,
  hasOverlap,
  normalizeItem,
  toGridPosition,
  toGridSize,
  toPixelRect,
} from './core/geometry';
export { cloneLayout, createLayout, parseLayout, sanitizeItem, serializeLayout, validateLayout } from './core/layout';
export {
  addItem,
  findFreePosition,
  moveItem,
  normalizeItems,
  removeItem,
  resizeItem,
  resizeItemFromLeft,
  updateItem,
} from './core/operations';
export type { DriftItemInput } from './core/operations';
export { applyItems, deriveItems, getBreakpoints, matchBreakpoint, resolveItems } from './core/responsive';
export {
  DEFAULT_BREAKPOINTS,
  DEFAULT_COLUMNS,
  DEFAULT_GAP,
  DEFAULT_ROW_HEIGHT,
  LAYOUT_VERSION,
  STACK_THRESHOLD_COLUMNS,
} from './constants';
export type {
  DriftBreakpoint,
  DriftChanges,
  DriftGeometry,
  DriftItem,
  DriftItemChange,
  DriftLayout,
  DriftMetrics,
  DriftPropValue,
  DriftRect,
  DriftValidationResult,
} from './types/DriftLayout';
