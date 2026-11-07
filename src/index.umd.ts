import * as core from './core';
import { createDriftEditor, createDriftManager, DriftEditor, DriftManager } from './editor';
import { renderViewer, renderViewerPage } from './viewer';

// 브라우저 전역에 등록 (window.Daracl.drift)
declare global {
  interface Window {
    Daracl?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

if (typeof window !== 'undefined') {
  window.Daracl = window.Daracl || {};
  window.Daracl.drift = {
    ...core,
    createDriftEditor,
    DriftEditor,
    createDriftManager,
    DriftManager,
    renderViewer,
    renderViewerPage,
  };
}
