import { useState, useCallback } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { projectName, instanceName } from '../types/branded';
import {
  useServices,
  usePorts,
  usePortHealth,
  useBareServiceStopMutation,
  useBareServiceStartMutation,
  useBareServiceRestartMutation,
} from '../api/hooks';
import { ApiError } from '../api/client';
import Breadcrumb from '../components/Breadcrumb';
import Modal from '../components/Modal';
import HealthDot from '../components/HealthDot';
import ServiceLogsTab from './ServiceLogsTab';

export default function BareServiceDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{
    project: string;
    name: string;
    service: string;
  }>();
  const project = projectName(params.project ?? '');
  const name = instanceName(params.name ?? '');
  const service = params.service ?? '';

  const { data } = useServices(project, name);
  const svcInfo = data?.services.find((s) => s.name === service);
  const { data: portsData } = usePorts(project, name);
  const { data: healthData } = usePortHealth(project as string, name as string);

  const portMapping = portsData?.ports?.find((p) => p.logical_name === service);
  const portHealthy = healthData?.ports?.find((p) => p.logical_name === service)?.healthy;
  const isRunning = svcInfo != null && svcInfo.status === 'running';

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const stopMut = useBareServiceStopMutation();
  const startMut = useBareServiceStartMutation();
  const restartMut = useBareServiceRestartMutation();

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setLoading(true);
      try {
        await fn();
      } catch (e) {
        setErrorMsg(e instanceof ApiError ? e.body.error : String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const vars = { project: project as string, name: name as string, service };

  return (
    <div className="page-shell">
      <Breadcrumb
        items={[
          { label: t('nav.projects'), to: '/' },
          { label: project, to: `/project/${project}` },
          { label: name, to: `/instance/${project}/${name}` },
          { label: 'Bare Services', to: `/instance/${project}/${name}/services` },
          { label: service },
        ]}
      />

      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold text-main">{service}</h1>
        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
          bare
        </span>
        {svcInfo != null && (
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${
            isRunning
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              : 'bg-slate-500/10 text-subtle-ui border-[var(--border)]'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {svcInfo.status}
          </span>
        )}
      </div>

      {/* Port info */}
      {portMapping != null && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <HealthDot healthy={portHealthy} />
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono bg-slate-500/10 text-subtle-ui border border-[var(--border)]">
            :{portMapping.canonical_port}
          </span>
          <span className="text-xs text-subtle-ui">/</span>
          <a
            href={`http://localhost:${portMapping.dynamic_port}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono bg-blue-500/10 text-[var(--primary)] border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
          >
            :{portMapping.dynamic_port}
          </a>
        </div>
      )}

      <p className="text-sm text-subtle-ui mb-4">
        Bare process service on the DinD host. Managed by the coast-supervisor.
      </p>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mb-6">
        {isRunning ? (
          <button
            className="btn btn-outline"
            disabled={loading}
            onClick={() => void act(() => stopMut.mutateAsync(vars))}
          >
            {t('action.stop')}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={loading}
            onClick={() => void act(() => startMut.mutateAsync(vars))}
          >
            {t('action.start')}
          </button>
        )}
        <button
          className="btn btn-outline"
          disabled={loading}
          onClick={() => void act(() => restartMut.mutateAsync(vars))}
        >
          {t('service.restart')}
        </button>
      </div>

      {/* Logs */}
      <h2 className="text-sm font-semibold text-subtle-ui uppercase tracking-wider mb-2">
        {t('tab.logs')}
      </h2>
      <ServiceLogsTab project={project} name={name} service={service} />

      <Modal open={errorMsg != null} title={t('error.title')} onClose={() => setErrorMsg(null)}>
        <p className="text-rose-600 dark:text-rose-400">{errorMsg}</p>
      </Modal>
    </div>
  );
}
