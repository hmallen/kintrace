import { useState } from 'react';

// Same base-URL knob as web/src/api/client.ts.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export interface MediaViewerProps {
  itemId: number;
  alt: string;
}

// Image-only viewer for this task; other media types come later.
export function MediaViewer({ itemId, alt }: MediaViewerProps) {
  const [zoom, setZoom] = useState(1);

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
          Zoom out
        </button>{' '}
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
          Zoom in
        </button>
      </div>
      <div style={{ overflow: 'auto', maxHeight: '80vh' }}>
        <img
          src={`${API_BASE}/api/items/${itemId}/file`}
          alt={alt}
          style={{ width: `${zoom * 100}%` }}
        />
      </div>
    </figure>
  );
}
