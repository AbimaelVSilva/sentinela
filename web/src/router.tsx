import { createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { StoresPage } from '@/pages/StoresPage';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [{ path: '/', element: <StoresPage /> }],
  },
]);
