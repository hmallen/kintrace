import type { MediaType } from '@shared/api.js';

// Placeholder text glyphs — the visual design pass replaces these later.
const GLYPHS: Record<MediaType, string> = {
  photo: 'IMG',
  letter: 'LTR',
  article: 'ART',
  audio: 'AUD',
  video: 'VID',
  pdf: 'PDF',
};

export function MediaTypeIcon({ type }: { type: MediaType }) {
  return (
    <span
      role="img"
      aria-label={`${type} icon`}
      title={type}
      style={{
        display: 'inline-block',
        padding: '0 0.35em',
        border: '1px solid #666',
        borderRadius: '3px',
        fontSize: '0.7rem',
        letterSpacing: '0.05em',
      }}
    >
      {GLYPHS[type]}
    </span>
  );
}
