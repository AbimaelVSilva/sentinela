import { createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { LoginPage } from '@/pages/LoginPage';
import { UsersPage } from '@/pages/UsersPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { CameraPage } from '@/pages/CameraPage';
import { StorePage } from '@/pages/StorePage';
import { StoresPage } from '@/pages/StoresPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { path: '/usuarios', element: <UsersPage /> },
      { path: '/', element: <StoresPage /> },
      { path: '/lojas/:storeId', element: <StorePage /> },
      { path: '/lojas/:storeId/cameras/:cameraId', element: <CameraPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
