import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeRouter } from './app/router';
import { makeQueryClient } from './app/query';
import './styles.css';

const router = makeRouter();
const client = makeQueryClient();
const mount = document.getElementById('root');
if (mount)
  createRoot(mount).render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
