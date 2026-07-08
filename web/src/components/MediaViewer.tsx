import { useState } from 'react';
import type { MediaType } from '@shared/api.js';
import { API_BASE } from '../api/client';

export interface MediaViewerProps {
  itemId: number;
  alt: string;
  mediaType: MediaType;
}

// Branches by media type; all viewers point at the same file endpoint.
export function MediaViewer({ itemId, alt, mediaType }: MediaViewerProps) {
  const src = `${API_BASE}/api/items/${itemId}/file`;

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

  return (
    <figure style={{ margin: 0 }}>
      <div className="viewer-controls">
        <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
          Zoom out
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
          Zoom in
        </button>
      </div>
      {/* The scan sits on a near-white mat with a print shadow — a photograph
          laid on the desk, not a UI panel. */}
      <div className="print-frame">
        <div className="print-scroll">
          <img src={src} alt={alt} style={{ width: `${zoom * 100}%` }} />
        </div>
      </div>
    </figure>
  );
}
