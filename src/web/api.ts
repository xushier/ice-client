import type {
  AppSnapshot,
  FrameLog,
  ModuleRecord,
  ServerConfig,
  Telemetry,
} from '../core/types';
import type { DeviceKind, DeviceState } from '../protocol/types';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // 保留状态文本
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  state: () => request<AppSnapshot>('GET', '/state'),
  config: () => request<ServerConfig>('GET', '/config'),
  patchConfig: (patch: Partial<ServerConfig>) => request<ServerConfig>('PATCH', '/config', patch),
  exportConfig: () => request<unknown>('GET', '/config/export'),
  importConfig: (data: unknown) => request<AppSnapshot>('POST', '/config/import', data),

  createModule: (input: {
    id: number;
    towerName: string;
    protocol: string;
    host: string;
    port: number;
    devices: DeviceKind[];
    autoConnect: boolean;
  }) => request<ModuleRecord>('POST', '/modules', input),

  updateModule: (id: number, patch: Record<string, unknown>) =>
    request<ModuleRecord>('PATCH', `/modules/${id}`, patch),

  deleteModule: (id: number) => request<ModuleRecord>('DELETE', `/modules/${id}`),

  connect: (id: number) => request<{ ok: boolean }>('POST', `/modules/${id}/connect`),
  disconnect: (id: number) => request<{ ok: boolean }>('POST', `/modules/${id}/disconnect`),
  history: (id: number) => request<{ ok: boolean }>('POST', `/modules/${id}/history`),

  setDevice: (id: number, device: DeviceKind, state: DeviceState) =>
    request<{ ok: boolean }>('POST', `/modules/${id}/device`, { device, state }),

  preset: (id: number, preset: 'initial' | 'ice') =>
    request<{ ok: boolean }>('POST', `/modules/${id}/preset`, { preset }),

  acceptPending: (id: number, pendingId: string) =>
    request<{ ok: boolean }>('POST', `/modules/${id}/pending/${pendingId}/accept`),

  ignorePending: (id: number, pendingId: string) =>
    request<{ ok: boolean }>('POST', `/modules/${id}/pending/${pendingId}/ignore`),

  sendFrame: (id: number, payload: { hex: string } | { type: number; data: number[] }) =>
    request<{ ok: boolean }>('POST', `/modules/${id}/send`, payload),

  patchTelemetry: (id: number, patch: Partial<Telemetry>) =>
    request<{ ok: boolean }>('POST', `/modules/${id}/telemetry`, { patch }),

  frames: (id: number) => request<{ frames: FrameLog[] }>('GET', `/modules/${id}/frames`),

  connectAll: () => request<{ ok: boolean }>('POST', '/connect-all'),
  disconnectAll: () => request<{ ok: boolean }>('POST', '/disconnect-all'),
};
