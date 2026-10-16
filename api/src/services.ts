import type { WorkerManager } from './pipeline/worker-manager';
import type { VisionProvider } from './vision/provider';

/** Serviços de longa duração compartilhados pelas rotas (inicializados no server.ts). */
export interface Services {
  workers: WorkerManager;
  vision: VisionProvider;
}

let services: Services | null = null;

export function setServices(s: Services) {
  services = s;
}

export function getServices(): Services {
  if (!services) throw new Error('Serviços não inicializados');
  return services;
}
