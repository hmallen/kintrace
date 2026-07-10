import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Uppy from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import Dashboard from '@uppy/react/dashboard';
import { ImportResultSchema, MediaTypeSchema } from '@shared/api.js';
import type { GedcomImportResult, ImportResult, MediaType } from '@shared/api.js';
import { API_BASE } from '../api/client';
import { useUpdateItem } from '../api/hooks';
import { useImportGedcom } from '../api/hooks';
import { summarizeImport } from '../import/summarize';
import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';

const MEDIA_TYPES = MediaTypeSchema.options;

const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  photo: 'Photograph',
  letter: 'Letter or correspondence',
  article: 'Newspaper or magazine article',
  pdf: 'General document (certificate, diploma, form, or record)',
  audio: 'Audio recording',
  video: 'Video recording',
};

const MEDIA_TYPE_IMPLICATIONS: Record<MediaType, { label: string; description: string }> = {
  photo: {
    label: 'Photo',
    description:
      'Treated as a photograph. AI describes the image and only transcribes visible captions or inscriptions.',
  },
  letter: {
    label: 'Letter',
    description:
      'Treated as handwritten correspondence. AI preserves original spelling, punctuation, and line breaks.',
  },
  article: {
    label: 'Article',
    description:
      'Treated as a newspaper or magazine clipping. AI transcribes the headline and full article text.',
  },
  audio: {
    label: 'Audio',
    description:
      'Stored as an audio recording and opened in the audio player. Image-based AI transcription does not extract its speech.',
  },
  video: {
    label: 'Video',
    description:
      'Stored as a video recording and opened in the video player. Image-based AI transcription does not extract its speech.',
  },
  pdf: {
    label: 'General document',
    description:
      'Use for certificates, diplomas, forms, official records, and other text-bearing documents—printed or handwritten. AI attempts to transcribe all legible text.',
  },
};

export function MediaTypeImplications({ selected }: { selected: MediaType }) {
  return (
    <aside className="media-type-implications" aria-labelledby="media-type-implications-title">
      <h3 id="media-type-implications-title">What this selection changes</h3>
      <p>The document type controls how KinTrace processes and presents every file in this batch.</p>
      <dl>
        {MEDIA_TYPES.map((type) => {
          const implication = MEDIA_TYPE_IMPLICATIONS[type];
          return (
            <div key={type} className={type === selected ? 'is-selected' : undefined}>
              <dt>
                {implication.label}
                {type === selected && <span className="selected-type-label">Selected</span>}
              </dt>
              <dd>{implication.description}</dd>
            </div>
          );
        })}
      </dl>
    </aside>
  );
}

// Per-file outcomes plus the summary line. Duplicates are informational only
// (no skip/replace prompts) — the badge links to the item already in the
// archive; errors are shown inline without blocking the other files.
function ImportedDocument({ result }: { result: Exclude<ImportResult, { error: string }> }) {
  const update = useUpdateItem(result.itemId);
  const [mediaType, setMediaType] = useState(result.mediaType);
  const editable = result.status === 'pending';
  return (
    <li className="import-preview-card">
      <div className="import-preview-image">
        <img src={`${API_BASE}/api/items/${result.itemId}/thumbnail`} alt="" />
      </div>
      <div>
        <Link to={`/items/${result.itemId}`}>{result.path}</Link>
        {result.duplicate && <> — already in archive</>}
        <label>
          Document type{' '}
          <select
            aria-label={`Document type for ${result.path}`}
            value={mediaType}
            disabled={!editable || update.isPending}
            onChange={async (event) => {
              const next = MediaTypeSchema.parse(event.target.value);
              const previous = mediaType;
              setMediaType(next);
              try {
                await update.mutateAsync({ media_type: next });
              } catch {
                setMediaType(previous);
              }
            }}
          >
            {MEDIA_TYPES.map((type) => <option key={type} value={type}>{MEDIA_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        {result.autoSelected && <small>Automatically selected from the file format. Review before processing.</small>}
        {!editable && <small>Type is locked because this item has already been processed.</small>}
        {update.isError && <small role="alert">Could not update the document type.</small>}
      </div>
    </li>
  );
}

export function ImportResults({ results }: { results: ImportResult[] }) {
  if (results.length === 0) return null;
  const summary = summarizeImport(results);
  return (
    <section aria-label="Import results">
      <p>{summary.line}</p>
      <ul>
        {results.map((result, index) =>
          'error' in result ? (
            // Composite key: two files in one batch can share a filename.
            <li key={`${index}-${result.path}`}>
              <>
                {result.path} — {result.error}
              </>
            </li>
          ) : (
            <ImportedDocument key={`${index}-${result.path}`} result={result} />
          )
        )}
      </ul>
    </section>
  );
}

export function GedcomImportResults({ result }: { result: GedcomImportResult | null }) {
  if (result === null) return null;
  return (
    <section aria-label="GEDCOM import results">
      <p>
        {result.duplicate ? 'Already queued' : 'Queued'} GEDCOM tree for review:{' '}
        {result.counts.peopleQueued} people, {result.counts.relationshipsQueued} relationships,{' '}
        {result.counts.eventsQueued} events, {result.counts.warnings} warnings.{' '}
        <Link to="/gedcom-review">Open review queue</Link>
      </p>
      {result.warnings.length > 0 && (
        <ul>
          {result.warnings.map((warning, index) => (
            <li key={`${warning.code}-${warning.line ?? index}`}>
              {warning.line !== undefined ? `Line ${warning.line}: ` : ''}
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Import() {
  const [mode, setMode] = useState<'media' | 'gedcom'>('media');
  const [mediaType, setMediaType] = useState<MediaType>('pdf');
  const [autoDetect, setAutoDetect] = useState(true);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [gedcomFile, setGedcomFile] = useState<File | null>(null);
  const [gedcomResult, setGedcomResult] = useState<GedcomImportResult | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const importGedcom = useImportGedcom();

  // The Uppy instance is created in an effect (not a useState initializer) so
  // StrictMode's mount/unmount/mount cycle never renders the Dashboard against
  // a destroyed instance; the cleanup destroys whichever instance is live.
  const [uppy, setUppy] = useState<Uppy | null>(null);
  useEffect(() => {
    const instance = new Uppy().use(XHRUpload, {
      endpoint: `${API_BASE}/api/upload`,
      formData: true,
      // One bundled request carries all files, so the backend answers with a
      // single ImportResult[] covering the whole batch.
      bundle: true,
      // With bundle:true the Uppy-level meta (set via setMeta below) is
      // appended to the same multipart body, so `mediaType` arrives as a
      // plain form field alongside the file parts.
      allowedMetaFields: ['mediaType', 'imageFallback'],
      onAfterResponse: (xhr) => {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          const raw: unknown = JSON.parse(xhr.responseText);
          setResults(ImportResultSchema.array().parse(raw));
          setResponseError(null);
        } catch {
          setResponseError('Unexpected response from the server.');
        }
      },
    });
    // A fresh batch replaces the previous results view.
    instance.on('upload', () => {
      setResults([]);
      setResponseError(null);
    });
    setUppy(instance);
    return () => {
      instance.destroy();
    };
  }, []);

  // Keep the upload's mediaType form field in sync with the selector.
  useEffect(() => {
    uppy?.setMeta({ mediaType: autoDetect ? 'auto' : mediaType, imageFallback: mediaType });
  }, [uppy, mediaType, autoDetect]);

  return (
    <section>
      <h2>Import</h2>
      <div className="import-controls">
        <label>
          <input
            type="radio"
            name="import-mode"
            checked={mode === 'media'}
            onChange={() => setMode('media')}
          />{' '}
          Archival media
        </label>{' '}
        <label>
          <input
            type="radio"
            name="import-mode"
            checked={mode === 'gedcom'}
            onChange={() => setMode('gedcom')}
          />{' '}
          GEDCOM family tree
        </label>
      </div>
      {mode === 'media' && (
        <>
          <div className="import-controls">
            <label>
              {autoDetect ? 'Type to use for image files' : 'Type for every file in this batch'}{' '}
              <select
                value={mediaType}
                onChange={(e) => setMediaType(MediaTypeSchema.parse(e.target.value))}
              >
                {MEDIA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {MEDIA_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="import-controls">
            <label>
              <input type="checkbox" checked={autoDetect} onChange={(e) => setAutoDetect(e.target.checked)} />{' '}
              Automatically identify PDF, audio, and video files
            </label>
          </div>
          <MediaTypeImplications selected={mediaType} />
          {uppy && <Dashboard uppy={uppy} />}
          <ImportResults results={results} />
        </>
      )}
      {mode === 'gedcom' && (
        <form
          className="filter-bar"
          onSubmit={async (event) => {
            event.preventDefault();
            if (gedcomFile === null) return;
            setResponseError(null);
            setGedcomResult(null);
            try {
              setGedcomResult(await importGedcom.mutateAsync(gedcomFile));
            } catch (error) {
              setResponseError(error instanceof Error ? error.message : 'Failed to import GEDCOM.');
            }
          }}
        >
          <label>
            GEDCOM file{' '}
            <input
              type="file"
              accept=".ged,.gedcom"
              onChange={(event) => {
                setGedcomFile(event.currentTarget.files?.[0] ?? null);
                setGedcomResult(null);
              }}
            />
          </label>{' '}
          <button type="submit" disabled={gedcomFile === null || importGedcom.isPending}>
            Queue GEDCOM for review
          </button>
          <GedcomImportResults result={gedcomResult} />
        </form>
      )}
      {responseError && <p role="alert">{responseError}</p>}
    </section>
  );
}
