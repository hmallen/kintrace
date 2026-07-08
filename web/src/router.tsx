import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Library } from './routes/Library';
import { Timeline } from './routes/Timeline';
import { Workspace } from './routes/Workspace';

// Placeholder route components — real pages land in later tasks.
function Import() {
  return <p>Import</p>;
}

function People() {
  return <p>People</p>;
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Library /> },
      { path: 'items/:id', element: <Workspace /> },
      { path: 'timeline', element: <Timeline /> },
      { path: 'import', element: <Import /> },
      { path: 'people', element: <People /> },
    ],
  },
];

export function makeRouter() {
  return createBrowserRouter(routes);
}
