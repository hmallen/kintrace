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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
