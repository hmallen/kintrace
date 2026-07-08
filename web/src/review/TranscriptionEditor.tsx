import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { Annotation, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { buildDecorations } from './decorations';

export interface TranscriptionEditorProps {
  value: string;
  onChange: (next: string) => void;
  flaggedSpans: { text: string; reason: string }[]; // from ai_confidence (diplomatic tab only)
  /** Accessible name for the editor's textbox (defaults to "Transcription"). */
  label?: string;
  /** Imperative handle for sidebar-driven navigation. */
  ref?: Ref<TranscriptionEditorHandle>;
}

export interface TranscriptionEditorHandle {
  /** Scroll to and select the first occurrence of `text` in the document. */
  selectSpan: (text: string) => void;
}

// Marks transactions that sync external prop changes into the editor so the
// update listener can distinguish them from user edits.
const externalChange = Annotation.define<boolean>();

const setFlaggedSpans = StateEffect.define<{ text: string; reason: string }[]>();

const flaggedSpansField = StateField.define<{ text: string; reason: string }[]>({
  create: () => [],
  update(spans, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFlaggedSpans)) spans = effect.value;
    }
    return spans;
  },
});

function computeDecorations(
  doc: string,
  spans: { text: string; reason: string }[],
): DecorationSet {
  const ranges = buildDecorations(doc, spans).map((match) =>
    Decoration.mark({
      class: match.kind === 'flagged' ? 'cm-flagged' : 'cm-uncertain',
      attributes: { title: match.reason },
    }).range(match.from, match.to),
  );
  // `true` sorts; flagged spans and markers may overlap (e.g. "famly [?]").
  return Decoration.set(ranges, true);
}

// Decorations are recomputed from the full doc on every doc change (and when
// the flagged-span list is swapped), per the Task 10 contract.
const decorationsField = StateField.define<DecorationSet>({
  create: (state) => computeDecorations(state.doc.toString(), state.field(flaggedSpansField)),
  update(decorations, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setFlaggedSpans))) {
      return computeDecorations(tr.newDoc.toString(), tr.state.field(flaggedSpansField));
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const highlightTheme = EditorView.baseTheme({
  '.cm-flagged': {
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
    borderBottom: '2px solid #d97706',
  },
  '.cm-uncertain': {
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
    fontStyle: 'italic',
  },
});

export function TranscriptionEditor({
  value,
  onChange,
  flaggedSpans,
  label,
  ref,
}: TranscriptionEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Mount effect owns the EditorView lifecycle; initial doc/spans/label are
  // read once here, later prop changes are synced by the effects below.
  useEffect(() => {
    const view = new EditorView({
      parent: containerRef.current!,
      doc: value,
      extensions: [
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label ?? 'Transcription' }),
        flaggedSpansField.init(() => flaggedSpans),
        decorationsField,
        highlightTheme,
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((tr) => tr.annotation(externalChange))
          ) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; see above
  }, []);

  // Controlled value: external changes replace the doc; user edits already
  // match `value` (they produced it via onChange) so this is a no-op for them.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: externalChange.of(true),
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setFlaggedSpans.of(flaggedSpans),
      annotations: externalChange.of(true),
    });
  }, [flaggedSpans]);

  useImperativeHandle(ref, () => ({
    selectSpan(text: string) {
      const view = viewRef.current;
      if (!view || text === '') return;
      const index = view.state.doc.toString().indexOf(text);
      if (index === -1) return;
      view.dispatch({
        selection: { anchor: index, head: index + text.length },
        scrollIntoView: true,
      });
      view.focus();
    },
  }));

  return <div ref={containerRef} data-testid="transcription-editor" />;
}
