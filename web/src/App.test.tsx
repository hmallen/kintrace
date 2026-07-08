import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { makeQueryClient } from './queryClient';
import { routes } from './router';

describe('App', () => {
  it('renders app shell', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'KinTrace' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
