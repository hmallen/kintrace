import { useRef } from 'react';
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useVirtualWindow, type Orientation } from './useVirtualWindow';

function Harness({
  orientation,
  lengthPx,
  overscanPx,
}: {
  orientation: Orientation;
  lengthPx: number;
  overscanPx?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const win = useVirtualWindow({ containerRef, orientation, lengthPx, overscanPx });
  return createElement(
    'div',
    { ref: containerRef, 'data-testid': 'scroller' },
    createElement('span', { 'data-testid': 'window' }, `${win.startPx},${win.endPx}`),
  );
}

function sizeScroller(el: HTMLElement, size: { clientWidth?: number; clientHeight?: number }) {
  for (const [prop, value] of Object.entries(size)) {
    Object.defineProperty(el, prop, { value, configurable: true });
  }
}

describe('useVirtualWindow', () => {
  it('covers the viewport plus overscan on both sides (horizontal)', () => {
    render(createElement(Harness, { orientation: 'horizontal', lengthPx: 10_000, overscanPx: 100 }));
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { clientWidth: 500 });

    fireEvent.scroll(scroller);

    expect(screen.getByTestId('window').textContent).toBe('0,600');
  });

  it('tracks the scroll offset', () => {
    render(createElement(Harness, { orientation: 'horizontal', lengthPx: 10_000, overscanPx: 100 }));
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { clientWidth: 500 });
    scroller.scrollLeft = 1000;

    fireEvent.scroll(scroller);

    expect(screen.getByTestId('window').textContent).toBe('900,1600');
  });

  it('reads the vertical scroll axis when orientation is vertical', () => {
    render(createElement(Harness, { orientation: 'vertical', lengthPx: 10_000, overscanPx: 100 }));
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { clientHeight: 400 });
    scroller.scrollTop = 2000;

    fireEvent.scroll(scroller);

    expect(screen.getByTestId('window').textContent).toBe('1900,2500');
  });

  it('clamps the window to [0, lengthPx]', () => {
    render(createElement(Harness, { orientation: 'horizontal', lengthPx: 10_000, overscanPx: 100 }));
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { clientWidth: 500 });
    scroller.scrollLeft = 9900;

    fireEvent.scroll(scroller);

    expect(screen.getByTestId('window').textContent).toBe('9800,10000');
  });
});
