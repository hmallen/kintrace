import { useState } from 'react';
import type { MediaType } from '@shared/api.js';
import { API_BASE } from '../api/client';
import { MediaTypeIcon } from './MediaTypeIcon';

export interface ThumbnailProps {
  itemId: number;
  alt: string;
  /** Drives the icon fallback when the thumbnail is missing (backend 404s). */
  mediaType: MediaType;
  /** Pass 'lazy' in long virtualized lists; defaults to the browser's eager load. */
  loading?: 'lazy' | 'eager';
}

export function Thumbnail({ itemId, alt, mediaType, loading }: ThumbnailProps) {
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
      loading={loading}
      onError={() => setFailed(true)}
      className="thumb"
    />
  );
}
