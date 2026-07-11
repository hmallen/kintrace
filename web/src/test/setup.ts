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

// jsdom does not implement IntersectionObserver, which react-chrono uses to
// lazy-reveal slides; a stub that reports everything visible keeps all cards
// rendered in tests.
if (typeof globalThis.IntersectionObserver !== 'function') {
  globalThis.IntersectionObserver = class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// jsdom does not implement matchMedia, which react-chrono queries for its
// responsive breakpoint; "no match" is fine — tests get the desktop layout.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
