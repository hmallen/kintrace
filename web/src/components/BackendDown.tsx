interface BackendDownProps {
  onRetry: () => void;
}

// Full-page state shown when a top-level query fails at the network level — the
// fetch itself rejected (TypeError), meaning the KinTrace backend could not be
// reached at all (e.g. the dev server on :3271 is down). Distinct from a
// route-level ApiError/parse error, which stays inside the route boundary.
export function BackendDown({ onRetry }: BackendDownProps) {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '2rem',
        textAlign: 'center',
        background: '#fff',
        zIndex: 1000,
      }}
    >
      <h1 style={{ fontSize: '1.5rem', margin: 0 }}>
        Can't reach the KinTrace backend on :3271
      </h1>
      <p style={{ maxWidth: '32rem', color: '#444', margin: 0 }}>
        The app couldn't connect to the KinTrace server. Make sure it's running,
        then try again.
      </p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
