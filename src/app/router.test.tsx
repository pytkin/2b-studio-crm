import { render, screen } from '@testing-library/react';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { expect, it } from 'vitest';
import { makeRouter } from './router';

it('S1-02 /login renders the Вход heading', async () => {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/login'] }));
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('heading', { name: 'Вход', level: 1 })).toBeVisible();
});
