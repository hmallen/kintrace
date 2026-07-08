import { useRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { FlagsSidebar } from './FlagsSidebar';
import { TranscriptionEditor, type TranscriptionEditorHandle } from './TranscriptionEditor';

function getView(container: HTMLElement): EditorView {
  const editorDom = container.querySelector<HTMLElement>('.cm-editor');
  expect(editorDom).not.toBeNull();
  const view = EditorView.findFromDOM(editorDom!);
  expect(view).not.toBeNull();
  return view!;
}

describe('TranscriptionEditor', () => {
  it('renders flagged text with class', () => {
    const { container } = render(
      <TranscriptionEditor
        value={'Dear famly\nI am well'}
        onChange={() => {}}
        flaggedSpans={[{ text: 'famly', reason: 'possible misspelling of family' }]}
      />,
    );

    const flagged = container.querySelector('.cm-flagged');
    expect(flagged).not.toBeNull();
    expect(flagged).toHaveTextContent('famly');
    // Hover tooltip carries the reason.
    expect(flagged).toHaveAttribute('title', 'possible misspelling of family');
  });

  it('renders uncertainty marker with class', () => {
    const { container } = render(
      <TranscriptionEditor
        value="I am [illegible] well"
        onChange={() => {}}
        flaggedSpans={[]}
      />,
    );

    const marker = container.querySelector('.cm-uncertain');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent('[illegible]');
  });

  it('edit calls onChange', async () => {
    const changes: string[] = [];
    function Harness() {
      const [value, setValue] = useState('hello');
      return (
        <TranscriptionEditor
          value={value}
          onChange={(next) => {
            changes.push(next);
            setValue(next);
          }}
          flaggedSpans={[]}
        />
      );
    }
    const { container } = render(<Harness />);
    const view = getView(container);

    const editor = screen.getByRole('textbox');
    await userEvent.click(editor);
    await userEvent.keyboard('!');

    await waitFor(() => expect(changes).toContain('!hello'));
    expect(view.state.doc.toString()).toBe('!hello');
  });

  it('sidebar strike-through when resolved', () => {
    const spans = [
      { text: 'famly', reason: 'possible misspelling' },
      { text: 'smudged word', reason: 'ink smudge' },
    ];
    // Current diplomatic text still contains 'famly' but no longer 'smudged word'.
    render(<FlagsSidebar spans={spans} value="Dear famly, I am well" onSpanClick={() => {}} />);

    const present = screen.getByRole('button', { name: /famly/ });
    const resolved = screen.getByRole('button', { name: /smudged word/ });
    expect(resolved).toHaveStyle({ textDecoration: 'line-through' });
    expect(resolved).toHaveAccessibleName(/resolved/i);
    expect(present).not.toHaveStyle({ textDecoration: 'line-through' });
  });

  it('sidebar click selects span', async () => {
    const spans = [{ text: 'famly', reason: 'possible misspelling' }];
    function Harness() {
      const ref = useRef<TranscriptionEditorHandle>(null);
      const [value, setValue] = useState('Dear famly\nI am well');
      return (
        <>
          <TranscriptionEditor
            ref={ref}
            value={value}
            onChange={setValue}
            flaggedSpans={spans}
          />
          <FlagsSidebar
            spans={spans}
            value={value}
            onSpanClick={(text) => ref.current?.selectSpan(text)}
          />
        </>
      );
    }
    const { container } = render(<Harness />);
    const view = getView(container);

    await userEvent.click(screen.getByRole('button', { name: /famly/ }));

    // 'Dear famly' → span occupies offsets 5..10.
    expect(view.state.selection.main.from).toBe(5);
    expect(view.state.selection.main.to).toBe(10);
  });

  it('external value change updates the doc without firing onChange', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <TranscriptionEditor value="first" onChange={onChange} flaggedSpans={[]} />,
    );
    const view = getView(container);
    expect(view.state.doc.toString()).toBe('first');

    rerender(<TranscriptionEditor value="second" onChange={onChange} flaggedSpans={[]} />);

    await waitFor(() => expect(view.state.doc.toString()).toBe('second'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
