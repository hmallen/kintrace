import { useState } from 'react';
import type { MediaType } from '@shared/api.js';
import { MediaTypeIcon } from './MediaTypeIcon';

// Same base-URL knob as web/src/api/client.ts.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export interface ThumbnailProps {
  itemId: number;
  alt: string;
  /** Drives the icon fallback when the thumbnail is missing (backend 404s). */
  mediaType: MediaType;
}

export function Thumbnail({ itemId, alt, mediaType }: ThumbnailProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span data-testid="thumbnail-fallback" className="thumb-fallback">
        <MediaTypeIcon type={mediaType} />
      </span>
    );
  }

  return (
    <img
      src={`${API_BASE}/api/items/${itemId}/thumbnail`}
      alt={alt}
      onError={() => setFailed(true)}
      className="thumb"
    />
  );
}
