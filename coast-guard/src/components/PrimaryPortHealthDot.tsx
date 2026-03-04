import { usePortHealth } from '../api/hooks';
import HealthDot from './HealthDot';

interface Props {
  project: string;
  name: string;
  service?: string | null | undefined;
  size?: number;
}

export default function PrimaryPortHealthDot({ project, name, service, size = 6 }: Props) {
  const { data } = usePortHealth(project, name);
  const svc = service ?? 'web';
  const healthy = data?.ports?.find((p) => p.logical_name === svc)?.healthy;
  return <HealthDot healthy={healthy} size={size} />;
}
