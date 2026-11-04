import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { makeQueryClient } from './query';
import { makeRouter } from './router';

it('S1-02 /login renders the Вход heading', async () => {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/login'] }));
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'Вход', level: 1 })).toBeVisible();
});
