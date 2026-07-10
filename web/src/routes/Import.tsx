import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Uppy from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import Dashboard from '@uppy/react/dashboard';
import { ImportResultSchema, MediaTypeSchema } from '@shared/api.js';
import type { GedcomImportResult, ImportResult, MediaType } from '@shared/api.js';
import { API_BASE } from '../api/client';
import { useImportGedcom } from '../api/hooks';
import { summarizeImport } from '../import/summarize';
import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';

const MEDIA_TYPES = MediaTypeSchema.options;

// Per-file outcomes plus the summary line. Duplicates are informational only
// (no skip/replace prompts) — the badge links to the item already in the
// archive; errors are shown inline without blocking the other files.
export function ImportResults({ results }: { results: ImportResult[] }) {
  if (results.length === 0) return null;
  const summary = summarizeImport(results);
  return (
    <section aria-label="Import results">
      <p>{summary.line}</p>
      <ul>
        {results.map((result, index) => (
          // Composite key: two files in one batch can share a filename.
          <li key={`${index}-${result.path}`}>
            {'error' in result ? (
              <>
                {result.path} — {result.error}
              </>
            ) : result.duplicate ? (
              <>
                {result.path} — <Link to={`/items/${result.itemId}`}>already in archive</Link>
              </>
            ) : (
              <Link to={`/items/${result.itemId}`}>{result.path}</Link>
            )}
          </li>
        ))}
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
  const [mediaType, setMediaType] = useState<MediaType>('photo');
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
      allowedMetaFields: ['mediaType'],
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
    uppy?.setMeta({ mediaType });
  }, [uppy, mediaType]);

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
              Media type{' '}
              <select
                value={mediaType}
                onChange={(e) => setMediaType(MediaTypeSchema.parse(e.target.value))}
              >
                {MEDIA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
