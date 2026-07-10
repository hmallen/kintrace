import type { ReactNode } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { Import } from './routes/Import';
import { Library } from './routes/Library';
import { People } from './routes/People';
import { Timeline } from './routes/Timeline';
import { Workspace } from './routes/Workspace';
import { GedcomReview } from './routes/GedcomReview';

// Each route's primary data query runs with `throwOnError`; wrapping the route
// element in a boundary turns a failed query into a retryable error UI (or the
// full-page BackendDown for a network failure) instead of a broken render.
function guarded(element: ReactNode): ReactNode {
  return <RouteErrorBoundary>{element}</RouteErrorBoundary>;
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: guarded(<Library />) },
      { path: 'items/:id', element: guarded(<Workspace />) },
      { path: 'timeline', element: guarded(<Timeline />) },
      { path: 'import', element: guarded(<Import />) },
      { path: 'people', element: guarded(<People />) },
      { path: 'gedcom-review', element: guarded(<GedcomReview />) },
    ],
  },
];

export function makeRouter() {
  return createBrowserRouter(routes);
}
