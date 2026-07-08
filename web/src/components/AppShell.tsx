import { Link, NavLink, Outlet } from 'react-router-dom';
import { ProcessQueueButton } from './ProcessQueueButton';

export function AppShell() {
  return (
    <>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '1.5rem',
          padding: '0.5rem 1rem',
          borderBottom: '1px solid #ccc',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>KinTrace</h1>
        <nav style={{ display: 'flex', gap: '1rem' }}>
          <NavLink to="/" end>
            Library
          </NavLink>
          <NavLink to="/timeline">Timeline</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/people">People</NavLink>
        </nav>
        {/* Header actions slot. */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ProcessQueueButton />
          <Link to="/import">Import media</Link>
        </div>
      </header>
      <main style={{ padding: '1rem' }}>
        <Outlet />
      </main>
    </>
  );
}
