import type { MediaType } from '@shared/api.js';

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
    <span role="img" aria-label={`${type} icon`} title={type} className="media-type-icon">
      {GLYPHS[type]}
    </span>
  );
}
