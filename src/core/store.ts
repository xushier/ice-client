import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors';
import { DEFAULT_CONFIG, DEFAULT_HOST, DEFAULT_PORT, DEFAULT_PROTOCOL, DEFAULT_TELEMETRY } from './defaults';
import { PROFILES, defaultStates, isProtocolId, supportedDevices } from '../protocol';
import type { DeviceKind, DeviceState, ProtocolId } from '../protocol/types';
import type {
  CreateModuleInput,
  ModuleRecord,
  ServerConfig,
  Telemetry,
  UpdateModuleInput,
} from './types';

export interface PersistedState {
  version: number;
  config: ServerConfig;
  modules: ModuleRecord[];
}

const ALLOWED_STATES: Record<'switch' | 'lock' | 'activation', DeviceState[]> = {
  switch: ['closed', 'open', 'closing', 'opening'],
  lock: ['locked', 'unlocked', 'locking', 'unlocking'],
  activation: ['on', 'off'],
};

function deviceGroup(kind: DeviceKind): keyof typeof ALLOWED_STATES {
  if (kind === 'iceLock') return 'lock';
  if (kind === 'activation') return 'activation';
  return 'switch';
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeConfig(input: Partial<ServerConfig> | undefined, base: ServerConfig): ServerConfig {
  const src = input ?? {};
  return {
    registration: asBool(src.registration, base.registration),
    envReport: asBool(src.envReport, base.envReport),
    stateIntervalSec: clampInt(src.stateIntervalSec, 5, 3600, base.stateIntervalSec),
    powerIntervalSec: clampInt(src.powerIntervalSec, 60, 86400, base.powerIntervalSec),
    envIntervalSec: clampInt(src.envIntervalSec, 60, 3600, base.envIntervalSec),
    hourlyBundle: asBool(src.hourlyBundle, base.hourlyBundle),
    alignHourly: asBool(src.alignHourly, base.alignHourly),
    autoMode: asBool(src.autoMode, base.autoMode),
    autoDelaySec: clampInt(src.autoDelaySec, 0, 600, base.autoDelaySec),
    autoReconnect: asBool(src.autoReconnect, base.autoReconnect),
    controlMode: src.controlMode === 'local' || src.controlMode === 'remote' ? src.controlMode : base.controlMode,
    linkType: src.linkType === 'fiber' || src.linkType === '4g' ? src.linkType : base.linkType,
    networkError: asBool(src.networkError, base.networkError),
    animSwitchSec: clampInt(src.animSwitchSec, 1, 120, base.animSwitchSec),
    animLockSec: clampInt(src.animLockSec, 1, 120, base.animLockSec),
    animIceSec: clampInt(src.animIceSec, 1, 120, base.animIceSec),
  };
}

function normalizeTelemetry(input: Partial<Telemetry> | undefined, base: Telemetry): Telemetry {
  const src = input ?? {};
  const temp = (value: unknown, fallback: number | null): number | null => {
    if (value === null) return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(-50, Math.min(150, n));
  };
  return {
    socPct: clampNumber(src.socPct, 0, 100, base.socPct),
    batteryVolt: clampNumber(src.batteryVolt, 0, 200, base.batteryVolt),
    loadVolt: clampNumber(src.loadVolt, 0, 200, base.loadVolt),
    loadCurrent: clampNumber(src.loadCurrent, 0, 100, base.loadCurrent),
    solarVolt: clampNumber(src.solarVolt, 0, 200, base.solarVolt),
    solarCurrent: clampNumber(src.solarCurrent, 0, 100, base.solarCurrent),
    chargeState: clampInt(src.chargeState, 0, 65535, base.chargeState),
    faultHigh: clampInt(src.faultHigh, 0, 65535, base.faultHigh),
    faultLow: clampInt(src.faultLow, 0, 65535, base.faultLow),
    envTemp: temp(src.envTemp, base.envTemp),
    envHumidity: src.envHumidity === null ? null : clampNumber(src.envHumidity, 0, 100, base.envHumidity ?? 0),
    cell1Temp: temp(src.cell1Temp, base.cell1Temp),
    cell2Temp: temp(src.cell2Temp, base.cell2Temp),
    acState: clampInt(src.acState, 0, 3, base.acState),
    acAlarmLow: clampInt(src.acAlarmLow, 0, 65535, base.acAlarmLow),
    acAlarm17: asBool(src.acAlarm17, base.acAlarm17),
    fireUsed: asBool(src.fireUsed, base.fireUsed),
  };
}

function normalizeDevices(protocol: ProtocolId, devices: unknown): DeviceKind[] {
  const supported = supportedDevices(protocol);
  if (!Array.isArray(devices) || devices.length === 0) return supported;
  const out: DeviceKind[] = [];
  for (const item of devices) {
    if (typeof item !== 'string') continue;
    const kind = item as DeviceKind;
    if (supported.includes(kind) && !out.includes(kind)) out.push(kind);
  }
  return out.length ? out : supported;
}

function normalizeStates(
  devices: DeviceKind[],
  states: Partial<Record<DeviceKind, DeviceState>> | undefined,
): Partial<Record<DeviceKind, DeviceState>> {
  const base = defaultStates(devices);
  if (!states) return base;
  const out: Partial<Record<DeviceKind, DeviceState>> = {};
  for (const device of devices) {
    const state = states[device];
    out[device] = state && ALLOWED_STATES[deviceGroup(device)].includes(state) ? state : base[device];
  }
  return out;
}

export class Store {
  readonly dataDir: string;
  readonly configPath: string;
  config: ServerConfig = { ...DEFAULT_CONFIG };
  modules: ModuleRecord[] = [];
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.configPath = path.join(dataDir, 'config.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      this.config = normalizeConfig(parsed.config, DEFAULT_CONFIG);
      if (Array.isArray(parsed.modules)) {
        const seen = new Set<number>();
        for (const item of parsed.modules) {
          const normalized = this.normalizeModule(item);
          if (normalized && !seen.has(normalized.id)) {
            seen.add(normalized.id);
            this.modules.push(normalized);
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[store] 读取配置失败，使用空配置：', (error as Error).message);
      }
    }
  }

  private normalizeModule(input: Partial<ModuleRecord>): ModuleRecord | null {
    if (typeof input.id !== 'number' || !Number.isInteger(input.id) || input.id < 0 || input.id > 4095) {
      return null;
    }
    const protocol: ProtocolId = isProtocolId(String(input.protocol)) ? (input.protocol as ProtocolId) : DEFAULT_PROTOCOL;
    const devices = normalizeDevices(protocol, input.devices);
    return {
      id: input.id,
      towerName: typeof input.towerName === 'string' && input.towerName.trim() ? input.towerName.trim() : `铁塔 ${input.id}`,
      protocol,
      host: typeof input.host === 'string' && input.host.trim() ? input.host.trim() : DEFAULT_HOST,
      port: clampInt(input.port, 1, 65535, DEFAULT_PORT),
      devices,
      autoConnect: asBool(input.autoConnect, true),
      createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(),
      states: normalizeStates(devices, input.states),
      telemetry: normalizeTelemetry(input.telemetry, DEFAULT_TELEMETRY),
    };
  }

  getModule(id: number): ModuleRecord {
    const module = this.modules.find((item) => item.id === id);
    if (!module) throw new AppError(`模块 ${id} 不存在`, 404);
    return module;
  }

  private assertIdFree(id: number, except?: number): void {
    if (!Number.isInteger(id) || id < 0 || id > 4095) throw new AppError('模块 ID 必须是 0~4095 的整数（12bit）');
    if (this.modules.some((item) => item.id === id && item.id !== except)) {
      throw new AppError(`模块 ID ${id} 已被占用`);
    }
  }

  createModule(input: CreateModuleInput): ModuleRecord {
    this.assertIdFree(input.id);
    const protocol: ProtocolId = isProtocolId(String(input.protocol)) ? (input.protocol as ProtocolId) : DEFAULT_PROTOCOL;
    const devices = normalizeDevices(protocol, input.devices);
    const module: ModuleRecord = {
      id: input.id,
      towerName: (input.towerName ?? '').trim() || `铁塔 ${input.id}`,
      protocol,
      host: (input.host ?? '').trim() || DEFAULT_HOST,
      port: clampInt(input.port, 1, 65535, DEFAULT_PORT),
      devices,
      autoConnect: input.autoConnect ?? true,
      createdAt: Date.now(),
      states: defaultStates(devices),
      telemetry: { ...DEFAULT_TELEMETRY },
    };
    this.modules.push(module);
    this.save();
    return module;
  }

  updateModule(id: number, patch: UpdateModuleInput): { module: ModuleRecord; idChanged: boolean; transportChanged: boolean; wasOnlineWanted: boolean } {
    const module = this.getModule(id);
    const nextId = typeof patch.id === 'number' ? patch.id : module.id;
    if (nextId !== module.id) this.assertIdFree(nextId, module.id);
    const nextProtocol: ProtocolId =
      patch.protocol && isProtocolId(patch.protocol) ? patch.protocol : module.protocol;
    const protocolChanged = nextProtocol !== module.protocol;
    const devices = protocolChanged
      ? normalizeDevices(nextProtocol, patch.devices)
      : patch.devices !== undefined
        ? normalizeDevices(nextProtocol, patch.devices)
        : module.devices;
    const transportChanged =
      nextId !== module.id ||
      protocolChanged ||
      (patch.host !== undefined && patch.host.trim() !== module.host) ||
      (patch.port !== undefined && clampInt(patch.port, 1, 65535, module.port) !== module.port);

    module.id = nextId;
    module.towerName = patch.towerName !== undefined ? patch.towerName.trim() || module.towerName : module.towerName;
    module.protocol = nextProtocol;
    if (patch.host !== undefined && patch.host.trim()) module.host = patch.host.trim();
    if (patch.port !== undefined) module.port = clampInt(patch.port, 1, 65535, module.port);
    module.devices = devices;
    if (patch.autoConnect !== undefined) module.autoConnect = patch.autoConnect;
    module.states = normalizeStates(devices, { ...module.states, ...(patch.states ?? {}) });
    module.telemetry = normalizeTelemetry({ ...module.telemetry, ...(patch.telemetry ?? {}) }, module.telemetry);
    this.save();
    return { module, idChanged: nextId !== id, transportChanged, wasOnlineWanted: module.autoConnect };
  }

  removeModule(id: number): ModuleRecord {
    const module = this.getModule(id);
    this.modules = this.modules.filter((item) => item.id !== id);
    this.save();
    return module;
  }

  setDeviceState(id: number, device: DeviceKind, state: DeviceState): ModuleRecord {
    const module = this.getModule(id);
    if (!module.devices.includes(device)) throw new AppError(`模块 ${id} 不包含设备 ${device}`);
    if (!ALLOWED_STATES[deviceGroup(device)].includes(state)) {
      throw new AppError(`设备 ${device} 不支持状态 ${state}`);
    }
    module.states = { ...module.states, [device]: state };
    this.save();
    return module;
  }

  setStates(id: number, states: Partial<Record<DeviceKind, DeviceState>>): ModuleRecord {
    const module = this.getModule(id);
    const merged = { ...module.states };
    for (const [device, state] of Object.entries(states) as Array<[DeviceKind, DeviceState]>) {
      if (!module.devices.includes(device)) continue;
      if (!ALLOWED_STATES[deviceGroup(device)].includes(state)) continue;
      merged[device] = state;
    }
    module.states = merged;
    this.save();
    return module;
  }

  patchTelemetry(id: number, patch: Partial<Telemetry>): ModuleRecord {
    const module = this.getModule(id);
    module.telemetry = normalizeTelemetry({ ...module.telemetry, ...patch }, module.telemetry);
    this.save();
    return module;
  }

  setConfig(patch: Partial<ServerConfig>): ServerConfig {
    this.config = normalizeConfig({ ...this.config, ...patch }, this.config);
    this.save();
    return this.config;
  }

  exportState(): PersistedState {
    return { version: 1, config: this.config, modules: this.modules };
  }

  importState(data: Partial<PersistedState>): void {
    const modules: ModuleRecord[] = [];
    const seen = new Set<number>();
    if (Array.isArray(data.modules)) {
      for (const item of data.modules) {
        const normalized = this.normalizeModule(item);
        if (normalized && !seen.has(normalized.id)) {
          seen.add(normalized.id);
          modules.push(normalized);
        }
      }
    }
    this.config = normalizeConfig(data.config, DEFAULT_CONFIG);
    this.modules = modules;
    this.saveNow();
  }

  scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 300);
  }

  save(): void {
    this.scheduleSave();
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const tmp = `${this.configPath}.tmp`;
    let payload: string;
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      payload = JSON.stringify(this.exportState(), null, 2);
      await fs.writeFile(tmp, payload, 'utf8');
    } catch {
      return;
    }
    /* Windows 上目标文件可能被杀软、同步盘或编辑器短暂占用，rename 会抛 EPERM/EACCES。
       重试几次后退化为直接覆盖写：持久化失败不应该让整个服务进程退出。 */
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await fs.rename(tmp, this.configPath);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
      }
    }
    try {
      await fs.writeFile(this.configPath, payload, 'utf8');
    } catch {
      // 实在写不进去就保留内存状态
    }
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export { PROFILES };
