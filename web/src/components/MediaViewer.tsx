import { useState } from 'react';
import type { MediaType } from '@shared/api.js';
import { API_BASE } from '../api/client';

export interface MediaViewerProps {
  itemId: number;
  alt: string;
  mediaType: MediaType;
  filePath?: string;
}

const IMAGE_FILE_PATTERN = /\.(?:jpe?g|png|tiff?|webp)$/i;

// Branches by media type; all viewers point at the same file endpoint.
export function MediaViewer({ itemId, alt, mediaType, filePath }: MediaViewerProps) {
  const src = `${API_BASE}/api/items/${itemId}/file`;

  // The type describes the document's role in the archive, not necessarily
  // its file format. An image categorized as an article, letter, or even an
  // incorrectly labeled queue item should still get the fitted image viewer.
  if (filePath !== undefined && IMAGE_FILE_PATTERN.test(filePath)) {
    return <ImageViewer src={src} alt={alt} />;
  }

  switch (mediaType) {
    case 'photo':
    case 'letter':
    case 'article':
      return <ImageViewer src={src} alt={alt} />;
    case 'audio':
      return (
        <figure style={{ margin: 0 }} className="print-frame">
          <audio controls src={src} aria-label={alt}>
            Your browser does not support audio playback.
          </audio>
        </figure>
      );
    case 'video':
      return (
        <figure style={{ margin: 0 }} className="print-frame">
          <video controls src={src} aria-label={alt} style={{ maxWidth: '100%', maxHeight: '80vh' }}>
            Your browser does not support video playback.
          </video>
        </figure>
      );
    case 'pdf':
      return (
        <figure style={{ margin: 0 }} className="print-frame">
          <iframe src={src} title={alt} style={{ width: '100%', height: '80vh', border: 0 }} />
        </figure>
      );
    default:
      return (
        <figure style={{ margin: 0 }}>
          <a href={src} download>
            Download {alt}
          </a>
        </figure>
      );
  }
}

// Image viewer with zoom controls (photo/letter/article).
function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const fitted = zoom === 1;

  return (
    <figure style={{ margin: 0 }}>
      {/* The scan sits on a near-white mat with a print shadow — a photograph
          laid on the desk, not a UI panel. */}
      <div className="print-frame">
        <div className="viewer-controls" role="toolbar" aria-label="Photo view controls">
          <button type="button" disabled={fitted} onClick={() => setZoom(1)}>
            Fit
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
            Zoom out
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
            Zoom in
          </button>
          <span className="zoom-level" aria-label="Zoom level">{Math.round(zoom * 100)}%</span>
        </div>
        <div className={`print-scroll${fitted ? ' is-fitted' : ''}`}>
          <img
            src={src}
            alt={alt}
            style={fitted ? undefined : { width: `${zoom * 100}%`, maxWidth: 'none' }}
          />
        </div>
      </div>
    </figure>
  );
}
