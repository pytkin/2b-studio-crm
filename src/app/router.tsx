import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { PageHeading } from '../shared/ui/PageHeading';

const root = createRootRoute({
  component: Outlet,
  notFoundComponent: () => <PageHeading>Страница не найдена</PageHeading>,
});
const home = createRoute({
  getParentRoute: () => root,
  path: '/',
  component: () => <Navigate to="/login" replace />,
});
const login = createRoute({
  getParentRoute: () => root,
  path: '/login',
  component: () => <PageHeading>Вход</PageHeading>,
});
const objects = createRoute({
  getParentRoute: () => root,
  path: '/objects',
  component: () => <PageHeading>Объекты</PageHeading>,
});
const object = createRoute({
  getParentRoute: () => root,
  path: '/objects/$objectId',
  component: () => <PageHeading>Объект</PageHeading>,
});
const mine = createRoute({
  getParentRoute: () => root,
  path: '/my-tasks',
  component: () => <PageHeading>Мои задачи</PageHeading>,
});
const task = createRoute({
  getParentRoute: () => root,
  path: '/tasks/$taskId',
  component: () => <PageHeading>Задача</PageHeading>,
});
const tree = root.addChildren([home, login, objects, object, mine, task]);
export const makeRouter = (history?: RouterHistory) => createRouter({ routeTree: tree, history });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
