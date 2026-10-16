import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { CameraStatusBadge } from '@/components/StatusBadges';
import { api, queryKeys } from '@/lib/api';

export function CameraPage() {
  const { cameraId = '' } = useParams();
  const { data } = useQuery({
    queryKey: queryKeys.camera(cameraId),
    queryFn: () => api.getCamera(cameraId),
  });
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">{data?.name}</h1>
      <CameraStatusBadge status={data?.status} />
    </div>
  );
}
