import type { ControlMode, DeviceKind, DeviceState, LinkType, ProtocolId } from '../protocol/types';

export interface Telemetry {
  socPct: number;
  batteryVolt: number;
  loadVolt: number;
  loadCurrent: number;
  solarVolt: number;
  solarCurrent: number;
  chargeState: number;
  faultHigh: number;
  faultLow: number;
  envTemp: number | null;
  envHumidity: number | null;
  cell1Temp: number | null;
  cell2Temp: number | null;
  acState: number;
  acAlarmLow: number;
  acAlarm17: boolean;
  fireUsed: boolean;
}

export interface ServerConfig {
  registration: boolean;
  envReport: boolean;
  stateIntervalSec: number;
  powerIntervalSec: number;
  envIntervalSec: number;
  hourlyBundle: boolean;
  alignHourly: boolean;
  autoMode: boolean;
  autoDelaySec: number;
  autoReconnect: boolean;
  controlMode: ControlMode;
  linkType: LinkType;
  networkError: boolean;
  animSwitchSec: number;
  animLockSec: number;
  animIceSec: number;
}

export interface ModuleRecord {
  id: number;
  towerName: string;
  protocol: ProtocolId;
  host: string;
  port: number;
  devices: DeviceKind[];
  autoConnect: boolean;
  createdAt: number;
  states: Partial<Record<DeviceKind, DeviceState>>;
  telemetry: Telemetry;
}

export type LinkStatus = 'offline' | 'connecting' | 'online';

export interface PendingAction {
  id: string;
  device: DeviceKind;
  action: 'close' | 'open' | 'lock' | 'unlock' | 'on' | 'off';
  code: string;
  label: string;
  conflict: boolean;
  source: 'platform' | 'manual';
  at: number;
  dueAt?: number;
}

export interface RuntimeState {
  link: LinkStatus;
  error: string | null;
  connectedAt: number | null;
  nextRetryAt: number | null;
  rx: number;
  tx: number;
  lastRxAt: number | null;
  lastTxAt: number | null;
  lastStateTxAt: number | null;
  lastPowerTxAt: number | null;
  lastHistoryAt: number | null;
  lastAckAt: number | null;
  lastTxType: number | null;
  pending: PendingAction[];
}

export interface ModuleDto extends ModuleRecord {
  runtime: RuntimeState;
}

export interface AppSnapshot {
  config: ServerConfig;
  modules: ModuleDto[];
  version: string;
  serverTime: number;
}

export interface FrameLog {
  dir: 'tx' | 'rx';
  at: number;
  hex: string;
  type: number;
  id: number;
  crcOk: boolean;
  error?: string;
}

export type ServerEvent =
  | { type: 'state'; data: AppSnapshot }
  | { type: 'frame'; data: { moduleId: number; frame: FrameLog } }
  | { type: 'frames'; data: { moduleId: number; frames: FrameLog[] } };

export interface CreateModuleInput {
  id: number;
  towerName?: string;
  protocol?: ProtocolId;
  host?: string;
  port?: number;
  devices?: DeviceKind[];
  autoConnect?: boolean;
}

export interface UpdateModuleInput {
  id?: number;
  towerName?: string;
  protocol?: ProtocolId;
  host?: string;
  port?: number;
  devices?: DeviceKind[];
  autoConnect?: boolean;
  states?: Partial<Record<DeviceKind, DeviceState>>;
  telemetry?: Partial<Telemetry>;
}
