import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Person } from '@shared/api.js';
import { TimelineControls } from './TimelineControls';

const people: Person[] = [
  { id: 3, name: 'Ada Voss', notes: null },
  { id: 4, name: 'Ben Voss', notes: null },
];

function renderControls(overrides: Partial<Parameters<typeof TimelineControls>[0]> = {}) {
  const handlers = {
    onViewChange: vi.fn(),
    onScaleChange: vi.fn(),
    onOrientationChange: vi.fn(),
    onPersonChange: vi.fn(),
  };
  render(
    <TimelineControls
      view="explore"
      scale="chronological"
      orientation="horizontal"
      people={people}
      personId={undefined}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('TimelineControls', () => {
  it('exposes toggle state through aria-pressed', () => {
    renderControls({ scale: 'sequential', orientation: 'vertical' });

    expect(screen.getByRole('button', { name: /chronological/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: /sequential/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /vertical/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reports scale, orientation, and view changes', async () => {
    const user = userEvent.setup();
    const handlers = renderControls({});

    await user.click(screen.getByRole('button', { name: /sequential/i }));
    expect(handlers.onScaleChange).toHaveBeenCalledWith('sequential');

    await user.click(screen.getByRole('button', { name: /vertical/i }));
    expect(handlers.onOrientationChange).toHaveBeenCalledWith('vertical');

    await user.click(screen.getByRole('button', { name: /table/i }));
    expect(handlers.onViewChange).toHaveBeenCalledWith('table');
  });

  it('drops the orientation toggle when the viewport forces vertical', () => {
    renderControls({ orientationLocked: true });

    expect(screen.queryByRole('button', { name: /vertical/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sequential/i })).toBeInTheDocument();
  });

  it('hides the scale and orientation toggles outside the Explore view', () => {
    renderControls({ view: 'table' });

    expect(screen.queryByRole('button', { name: /sequential/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /vertical/i })).not.toBeInTheDocument();
  });

  it('lists people with an All people default and reports selection', async () => {
    const user = userEvent.setup();
    const handlers = renderControls({});

    const select = screen.getByLabelText(/person/i);
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All people',
      'Ada Voss',
      'Ben Voss',
    ]);

    await user.selectOptions(select, '4');
    expect(handlers.onPersonChange).toHaveBeenCalledWith(4);

    await user.selectOptions(select, '');
    expect(handlers.onPersonChange).toHaveBeenCalledWith(undefined);
  });
});
