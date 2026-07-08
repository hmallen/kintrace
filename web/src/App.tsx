import { NavLink, Outlet } from 'react-router-dom';

export function App() {
  return (
    <>
      <header>
        <h1>KinTrace</h1>
        <nav>
          <NavLink to="/" end>
            Library
          </NavLink>{' '}
          <NavLink to="/timeline">Timeline</NavLink>{' '}
          <NavLink to="/import">Import</NavLink>{' '}
          <NavLink to="/people">People</NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
