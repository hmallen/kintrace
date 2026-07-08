import '@testing-library/jest-dom';
import { server } from './msw';

// jsdom does not implement Range#getClientRects / #getBoundingClientRect, which
// CodeMirror's measure cycle calls (asynchronously, via requestAnimationFrame)
// after focus/typing. Zero-size rects are fine — layout is irrelevant in jsdom.
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = function getClientRects() {
    return {
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    } as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return new DOMRect(0, 0, 0, 0);
  };
}

// jsdom does not implement ResizeObserver, which Uppy's Dashboard uses to pick
// its layout; a no-op stub is fine — the Dashboard falls back to mobile view.
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
