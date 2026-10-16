import {
  ArrowRightLeftIcon,
  CircleAlertIcon,
  PackageMinusIcon,
  UserCheckIcon,
  type LucideProps,
} from 'lucide-react';
import type { EventType } from '@/lib/api';

const ICONS = {
  removed: PackageMinusIcon,
  moved: ArrowRightLeftIcon,
  no_change: UserCheckIcon,
  analysis_failed: CircleAlertIcon,
} satisfies Record<EventType, unknown>;

export function EventIcon({ type, ...props }: { type: EventType } & LucideProps) {
  const Icon = ICONS[type];
  return <Icon {...props} />;
}
