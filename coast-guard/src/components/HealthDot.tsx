interface Props {
  healthy: boolean | undefined;
  size?: number;
}

export default function HealthDot({ healthy, size = 6 }: Props) {
  if (healthy === undefined) {
    return (
      <span
        className="inline-block rounded-full bg-slate-400/50"
        style={{ width: size, height: size }}
        title="Checking..."
      />
    );
  }
  return (
    <span
      className={`inline-block rounded-full ${healthy ? 'bg-emerald-500' : 'bg-rose-500'}`}
      style={{ width: size, height: size }}
      title={healthy ? 'Port is up' : 'Port is down'}
    />
  );
}
