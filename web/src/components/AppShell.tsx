import { Link, NavLink, Outlet } from 'react-router-dom';
import { ProcessQueueButton } from './ProcessQueueButton';

export function AppShell() {
  return (
    <>
      <header className="masthead">
        <h1>KinTrace</h1>
        <nav className="masthead-nav">
          <NavLink to="/" end>
            Library
          </NavLink>
          <NavLink to="/timeline">Timeline</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/people">People</NavLink>
          <NavLink to="/gedcom-review">GEDCOM review</NavLink>
        </nav>
        {/* Header actions slot. */}
        <div className="masthead-actions">
          <ProcessQueueButton />
          <Link to="/import">Import media</Link>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
