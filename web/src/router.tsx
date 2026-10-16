import { createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { CameraPage } from '@/pages/CameraPage';
import { StorePage } from '@/pages/StorePage';
import { StoresPage } from '@/pages/StoresPage';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <StoresPage /> },
      { path: '/lojas/:storeId', element: <StorePage /> },
      { path: '/lojas/:storeId/cameras/:cameraId', element: <CameraPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
