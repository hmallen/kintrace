// Self-hosted Fraunces (OFL) — bundled woff2 via @fontsource, no CDN requests.
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/fraunces/latin-600.css';
// react-chrono's stylesheet includes a global reset; load it FIRST so the
// KinTrace globals below win the cascade on shared element selectors while
// chrono's class-scoped component styles keep working (used by StoryView).
import 'react-chrono/dist/style.css';
import './styles/theme.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { makeQueryClient } from './queryClient';
import { makeRouter } from './router';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={makeRouter()} />
    </QueryClientProvider>
  </StrictMode>,
);
