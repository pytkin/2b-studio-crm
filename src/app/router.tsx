import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { SessionBoundary } from '../modules/auth';
import { ObjectPage, ObjectsPage } from '../modules/objects';
import { MyTasksPage, TaskPage } from '../modules/tasks';
import { PageHeading } from '../shared/ui/PageHeading';

const root = createRootRoute({
  component: () => (
    <SessionBoundary>
      <Outlet />
    </SessionBoundary>
  ),
  notFoundComponent: () => <PageHeading>Страница не найдена</PageHeading>,
});
const home = createRoute({
  getParentRoute: () => root,
  path: '/',
  component: () => null,
});
const login = createRoute({
  getParentRoute: () => root,
  path: '/login',
  component: () => <PageHeading>Вход</PageHeading>,
});
const objects = createRoute({
  getParentRoute: () => root,
  path: '/objects',
  component: ObjectsPage,
});
const object = createRoute({
  getParentRoute: () => root,
  path: '/objects/$objectId',
  component: () => <ObjectPage objectId={object.useParams().objectId} />,
});
const mine = createRoute({
  getParentRoute: () => root,
  path: '/my-tasks',
  component: MyTasksPage,
});
const task = createRoute({
  getParentRoute: () => root,
  path: '/tasks/$taskId',
  component: () => <TaskPage key={task.useParams().taskId} taskId={task.useParams().taskId} />,
});
const tree = root.addChildren([home, login, objects, object, mine, task]);
export const makeRouter = (history?: RouterHistory) => createRouter({ routeTree: tree, history });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
