import { Store } from './store';
import { ModuleSession, type SessionDeps } from './session';
import type { OperationLog } from './logs';
import type {
  AppSnapshot,
  CreateModuleInput,
  FrameLog,
  ModuleRecord,
  ModuleDto,
  RuntimeState,
  ServerConfig,
  ServerEvent,
  UpdateModuleInput,
} from './types';

export class SessionManager {
  private sessions = new Map<number, ModuleSession>();
  private stateTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly log: OperationLog,
    private readonly broadcast: (event: ServerEvent) => void,
    private readonly version: string,
  ) {}

  start(): void {
    for (const module of this.store.modules) {
      this.ensure(module.id);
      if (module.autoConnect) this.connect(module.id);
    }
  }

  private createSession(id: number): ModuleSession {
    const deps: SessionDeps = {
      getConfig: () => this.store.config,
      getModule: (moduleId) => this.store.getModule(moduleId),
      patchModule: (moduleId, mutate) => {
        const module = this.store.getModule(moduleId);
        mutate(module);
        this.store.save();
      },
      log: this.log,
      emitState: () => this.queueState(),
      emitFrame: (moduleId, frame) => this.broadcast({ type: 'frame', data: { moduleId, frame } }),
    };
    return new ModuleSession(id, deps);
  }

  private ensure(id: number): ModuleSession {
    let session = this.sessions.get(id);
    if (!session) {
      session = this.createSession(id);
      this.sessions.set(id, session);
    }
    return session;
  }

  private snapshotRuntime(runtime: RuntimeState): RuntimeState {
    return { ...runtime, pending: runtime.pending.map((item) => ({ ...item })) };
  }

  snapshot(): AppSnapshot {
    const modules: ModuleDto[] = this.store.modules.map((module) => ({
      ...module,
      states: { ...module.states },
      telemetry: { ...module.telemetry },
      runtime: this.snapshotRuntime(this.ensure(module.id).runtime),
    }));
    return {
      config: { ...this.store.config },
      modules,
      version: this.version,
      serverTime: Date.now(),
    };
  }

  queueState(): void {
    if (this.stateTimer || this.stopped) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.broadcast({ type: 'state', data: this.snapshot() });
    }, 60);
  }

  createModule(input: CreateModuleInput): ModuleRecord {
    const module = this.store.createModule(input);
    const session = this.ensure(module.id);
    this.queueState();
    if (module.autoConnect) session.connect();
    return module;
  }

  updateModule(id: number, patch: UpdateModuleInput): ModuleRecord {
    const previous = this.sessions.get(id);
    const wasActive = previous ? previous.runtime.link !== 'offline' : false;
    const result = this.store.updateModule(id, patch);
    if (result.idChanged || result.transportChanged) {
      previous?.dispose();
      this.sessions.delete(id);
      const session = this.ensure(result.module.id);
      if (wasActive) session.connect();
    }
    this.queueState();
    return result.module;
  }

  deleteModule(id: number): ModuleRecord {
    const session = this.sessions.get(id);
    session?.dispose();
    this.sessions.delete(id);
    const module = this.store.removeModule(id);
    this.queueState();
    return module;
  }

  connect(id: number): void {
    this.ensure(id).connect();
  }

  disconnect(id: number): void {
    this.ensure(id).disconnect(true);
  }

  connectAll(): void {
    for (const module of this.store.modules) this.connect(module.id);
  }

  disconnectAll(): void {
    for (const module of this.store.modules) this.disconnect(module.id);
  }

  setDevice(id: number, device: Parameters<ModuleSession['setDevice']>[0], state: Parameters<ModuleSession['setDevice']>[1]): void {
    this.ensure(id).setDevice(device, state);
  }

  preset(id: number, states: Parameters<ModuleSession['preset']>[0]): void {
    this.ensure(id).preset(states);
  }

  acceptPending(id: number, pendingId: string): void {
    this.ensure(id).acceptPending(pendingId);
  }

  ignorePending(id: number, pendingId: string): void {
    this.ensure(id).ignorePending(pendingId);
  }

  reportHistory(id: number, source: 'manual' = 'manual'): void {
    this.ensure(id).reportHistory(source);
  }

  sendTyped(id: number, type: number, data: number[]): void {
    this.ensure(id).sendTyped(type, data);
  }

  sendRaw(id: number, hex: string): void {
    this.ensure(id).sendRaw(hex);
  }

  frames(id: number): FrameLog[] {
    this.store.getModule(id);
    return this.ensure(id).frames.slice();
  }

  updateConfig(patch: Partial<ServerConfig>): ServerConfig {
    const config = this.store.setConfig(patch);
    for (const session of this.sessions.values()) session.applyConfig();
    this.log.append({
      at: Date.now(),
      moduleId: 0,
      towerName: '全局',
      kind: 'config',
      detail: '更新全局设置',
    });
    this.queueState();
    return config;
  }

  patchTelemetry(id: number, patch: Parameters<Store['patchTelemetry']>[1]): ModuleRecord {
    const module = this.store.patchTelemetry(id, patch);
    this.queueState();
    return module;
  }

  importState(data: Parameters<Store['importState']>[0]): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
    this.store.importState(data);
    for (const module of this.store.modules) {
      this.ensure(module.id);
      if (module.autoConnect) this.connect(module.id);
    }
    this.queueState();
  }

  shutdown(): void {
    this.stopped = true;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = null;
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }
}
