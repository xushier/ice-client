import type { ControlMode, DeviceAction, DeviceKind, DeviceState, LinkType, ProtocolId } from './types';

export interface DeviceMeta {
  kind: DeviceKind;
  label: string;
  short: string;
  initial: DeviceState;
  ice: DeviceState;
  verbs: Partial<Record<DeviceAction, string>>;
  stateLabels: Partial<Record<DeviceState, string>>;
}

export const DEVICE_META: Record<DeviceKind, DeviceMeta> = {
  ground1: {
    kind: 'ground1',
    label: '接地刀闸 1',
    short: '接地 1',
    initial: 'closed',
    ice: 'open',
    verbs: { close: '合闸', open: '分闸' },
    stateLabels: { closed: '合闸到位', open: '分闸到位', closing: '合闸中', opening: '分闸中' },
  },
  ground2: {
    kind: 'ground2',
    label: '接地刀闸 2',
    short: '接地 2',
    initial: 'closed',
    ice: 'open',
    verbs: { close: '合闸', open: '分闸' },
    stateLabels: { closed: '合闸到位', open: '分闸到位', closing: '合闸中', opening: '分闸中' },
  },
  phase1: {
    kind: 'phase1',
    label: '选相刀闸 1',
    short: '选相 1',
    initial: 'open',
    ice: 'closed',
    verbs: { close: '合闸', open: '分闸' },
    stateLabels: { closed: '合闸到位', open: '分闸到位', closing: '合闸中', opening: '分闸中' },
  },
  phase2: {
    kind: 'phase2',
    label: '选相刀闸 2',
    short: '选相 2',
    initial: 'open',
    ice: 'closed',
    verbs: { close: '合闸', open: '分闸' },
    stateLabels: { closed: '合闸到位', open: '分闸到位', closing: '合闸中', opening: '分闸中' },
  },
  phase3: {
    kind: 'phase3',
    label: '选相刀闸 3',
    short: '选相 3',
    initial: 'open',
    ice: 'closed',
    verbs: { close: '合闸', open: '分闸' },
    stateLabels: { closed: '合闸到位', open: '分闸到位', closing: '合闸中', opening: '分闸中' },
  },
  iceSwitch: {
    kind: 'iceSwitch',
    label: '融冰刀闸',
    short: '融冰',
    initial: 'open',
    ice: 'closed',
    verbs: { close: '合闸', open: '分闸' },
    stateLabels: { closed: '合闸到位', open: '分闸到位', closing: '合闸中', opening: '分闸中' },
  },
  iceLock: {
    kind: 'iceLock',
    label: '融冰锁',
    short: '锁',
    initial: 'locked',
    ice: 'unlocked',
    verbs: { lock: '闭锁', unlock: '开锁' },
    stateLabels: { locked: '闭锁到位', unlocked: '开锁到位', locking: '闭锁中', unlocking: '开锁中' },
  },
  activation: {
    kind: 'activation',
    label: '电池活化',
    short: '活化',
    initial: 'off',
    ice: 'on',
    verbs: { on: '开启', off: '关闭' },
    stateLabels: { on: '活化开启', off: '活化关闭' },
  },
};

export interface CommandBit {
  byte: 0 | 1;
  bit: number;
  device: DeviceKind;
  action: DeviceAction;
  label: string;
  code: string;
}

export interface StatusBit {
  byte: 0 | 1;
  bit: number;
  device: DeviceKind;
  state: DeviceState;
  label: string;
}

export interface Profile {
  id: ProtocolId;
  label: string;
  short: string;
  description: string;
  /** 新建模块时可选设备（顺序即默认展示顺序） */
  devices: DeviceKind[];
  commandBits: CommandBit[];
  statusBits: StatusBit[];
  extras: {
    networkError?: { byte: 0 | 1; bit: number };
    controlMode?: { byte: 0 | 1; bit: number };
    linkFiber?: { byte: 0 | 1; bit: number };
    battery?: { byte: 0 | 1; high: number; low: number };
  };
}

const ground1Cmd: CommandBit[] = [
  { byte: 1, bit: 7, device: 'ground1', action: 'close', label: '接地刀闸 1 合闸', code: 'A1' },
  { byte: 1, bit: 6, device: 'ground1', action: 'open', label: '接地刀闸 1 分闸', code: 'A2' },
];
const phase12Cmd: CommandBit[] = [
  { byte: 1, bit: 5, device: 'phase1', action: 'close', label: '选相刀闸 1 合闸', code: 'B1' },
  { byte: 1, bit: 4, device: 'phase1', action: 'open', label: '选相刀闸 1 分闸', code: 'B2' },
  { byte: 1, bit: 3, device: 'phase2', action: 'close', label: '选相刀闸 2 合闸', code: 'B3' },
  { byte: 1, bit: 2, device: 'phase2', action: 'open', label: '选相刀闸 2 分闸', code: 'B4' },
];
const iceCmd: CommandBit[] = [
  { byte: 0, bit: 3, device: 'iceSwitch', action: 'close', label: '融冰刀闸 合闸', code: 'C1' },
  { byte: 0, bit: 2, device: 'iceSwitch', action: 'open', label: '融冰刀闸 分闸', code: 'C2' },
  { byte: 0, bit: 1, device: 'iceLock', action: 'lock', label: '融冰锁 闭锁', code: 'D1' },
  { byte: 0, bit: 0, device: 'iceLock', action: 'unlock', label: '融冰锁 开锁', code: 'D2' },
];

const ground1Status: StatusBit[] = [
  { byte: 0, bit: 0, device: 'ground1', state: 'closed', label: '接地刀闸 1 合到位' },
  { byte: 1, bit: 7, device: 'ground1', state: 'open', label: '接地刀闸 1 分到位' },
];
const phase12Status: StatusBit[] = [
  { byte: 1, bit: 6, device: 'phase1', state: 'closed', label: '选相刀闸 1 合到位' },
  { byte: 1, bit: 5, device: 'phase1', state: 'open', label: '选相刀闸 1 分到位' },
  { byte: 1, bit: 4, device: 'phase2', state: 'closed', label: '选相刀闸 2 合到位' },
  { byte: 1, bit: 3, device: 'phase2', state: 'open', label: '选相刀闸 2 分到位' },
];
const iceStatus: StatusBit[] = [
  { byte: 0, bit: 4, device: 'iceSwitch', state: 'closed', label: '融冰刀闸 合到位' },
  { byte: 0, bit: 3, device: 'iceSwitch', state: 'open', label: '融冰刀闸 分到位' },
  { byte: 0, bit: 2, device: 'iceLock', state: 'locked', label: '融冰锁 闭锁到位' },
  { byte: 0, bit: 1, device: 'iceLock', state: 'unlocked', label: '融冰锁 开锁到位' },
];

export const PROFILES: Record<ProtocolId, Profile> = {
  mg400: {
    id: 'mg400',
    label: 'MG400',
    short: 'MG400',
    description: '单接地刀闸、两路选相、带电池活化指令',
    devices: ['ground1', 'phase1', 'phase2', 'iceLock', 'iceSwitch', 'activation'],
    commandBits: [
      ...iceCmd,
      ...ground1Cmd,
      ...phase12Cmd,
      { byte: 1, bit: 1, device: 'activation', action: 'on', label: '电池活化 开启', code: 'E1' },
    ],
    statusBits: [...iceStatus, ...ground1Status, ...phase12Status],
    extras: {
      networkError: { byte: 0, bit: 5 },
      controlMode: { byte: 1, bit: 2 },
      battery: { byte: 1, high: 1, low: 0 },
    },
  },
  mg500: {
    id: 'mg500',
    label: 'MG500',
    short: 'MG500',
    description: '双接地刀闸、三路选相、光纤/4G 链路状态',
    devices: ['ground1', 'ground2', 'phase1', 'phase2', 'phase3', 'iceLock', 'iceSwitch'],
    commandBits: [
      { byte: 0, bit: 7, device: 'ground2', action: 'close', label: '接地刀闸 2 合闸', code: 'A3' },
      { byte: 0, bit: 6, device: 'ground2', action: 'open', label: '接地刀闸 2 分闸', code: 'A4' },
      { byte: 0, bit: 5, device: 'phase3', action: 'close', label: '选相刀闸 3 合闸', code: 'B5' },
      { byte: 0, bit: 4, device: 'phase3', action: 'open', label: '选相刀闸 3 分闸', code: 'B6' },
      ...iceCmd,
      ...ground1Cmd,
      ...phase12Cmd,
    ],
    statusBits: [
      { byte: 0, bit: 6, device: 'ground2', state: 'closed', label: '接地刀闸 2 合到位' },
      { byte: 0, bit: 5, device: 'ground2', state: 'open', label: '接地刀闸 2 分到位' },
      ...iceStatus,
      ...ground1Status,
      ...phase12Status,
      { byte: 1, bit: 1, device: 'phase3', state: 'closed', label: '选相刀闸 3 合到位' },
      { byte: 1, bit: 0, device: 'phase3', state: 'open', label: '选相刀闸 3 分到位' },
    ],
    extras: {
      controlMode: { byte: 1, bit: 2 },
      linkFiber: { byte: 0, bit: 7 },
    },
  },
};

export function isProtocolId(value: string): value is ProtocolId {
  return value === 'mg400' || value === 'mg500';
}

export function supportedDevices(protocol: ProtocolId): DeviceKind[] {
  return [...PROFILES[protocol].devices];
}

export function deviceLabel(kind: DeviceKind): string {
  return DEVICE_META[kind]?.label ?? kind;
}

export function stateLabel(kind: DeviceKind, state: DeviceState | undefined): string {
  if (!state) return '未知';
  return DEVICE_META[kind]?.stateLabels[state] ?? state;
}

const TRANSITION_LABELS: Partial<Record<DeviceState, string>> = {
  closing: '合闸中',
  opening: '分闸中',
  locking: '闭锁中',
  unlocking: '开锁中',
};

/** 中间按钮文案：从初始态往融冰态动，显示向融冰态的动作；反之显示返回动作 */
export function middleLabel(kind: DeviceKind, state: DeviceState | undefined): string {
  if (!state) return '—';
  const transition = TRANSITION_LABELS[state];
  if (transition) return transition;
  const meta = DEVICE_META[kind];
  if (kind === 'activation') return '—';
  const target = state === meta.initial ? meta.ice : meta.initial;
  const action = actionForState(kind, target);
  const verb = meta.verbs[action];
  return verb ? `${verb}中` : '—';
}

export function actionForState(kind: DeviceKind, state: DeviceState): DeviceAction {
  if (kind === 'iceLock') return state === 'locked' ? 'lock' : 'unlock';
  if (kind === 'activation') return state === 'on' ? 'on' : 'off';
  return state === 'closed' ? 'close' : 'open';
}

function setBit(bytes: number[], byte: 0 | 1, bit: number): void {
  bytes[byte] |= 1 << bit;
}

function getBit(data: ArrayLike<number>, byte: 0 | 1, bit: number): boolean {
  return ((data[byte] ?? 0) & (1 << bit)) !== 0;
}

export interface StatusExtra {
  networkError?: boolean;
  controlMode?: ControlMode;
  linkType?: LinkType;
  socPct?: number;
}

export function encodeStatus(
  protocol: ProtocolId,
  states: Partial<Record<DeviceKind, DeviceState>>,
  extra: StatusExtra = {},
): Uint8Array {
  const profile = PROFILES[protocol];
  const bytes = [0, 0];
  for (const bit of profile.statusBits) {
    if (states[bit.device] === bit.state) setBit(bytes, bit.byte, bit.bit);
  }
  if (profile.extras.networkError && extra.networkError) {
    setBit(bytes, profile.extras.networkError.byte, profile.extras.networkError.bit);
  }
  if (profile.extras.controlMode && extra.controlMode === 'local') {
    setBit(bytes, profile.extras.controlMode.byte, profile.extras.controlMode.bit);
  }
  if (profile.extras.linkFiber && extra.linkType === 'fiber') {
    setBit(bytes, profile.extras.linkFiber.byte, profile.extras.linkFiber.bit);
  }
  if (profile.extras.battery) {
    const level = Math.max(0, Math.min(3, Math.floor((extra.socPct ?? 0) / 25)));
    const { byte, high, low } = profile.extras.battery;
    if (level & 2) setBit(bytes, byte, high);
    if (level & 1) setBit(bytes, byte, low);
  }
  return Uint8Array.from(bytes);
}

export interface DecodedStatus {
  states: Partial<Record<DeviceKind, DeviceState>>;
  networkError?: boolean;
  controlMode?: ControlMode;
  linkType?: LinkType;
  batteryLevel?: number;
}

export function decodeStatus(protocol: ProtocolId, data: ArrayLike<number>): DecodedStatus {
  const profile = PROFILES[protocol];
  const states: Partial<Record<DeviceKind, DeviceState>> = {};
  const groups = new Map<DeviceKind, StatusBit[]>();
  for (const bit of profile.statusBits) {
    const list = groups.get(bit.device) ?? [];
    list.push(bit);
    groups.set(bit.device, list);
  }
  for (const [device, bits] of groups) {
    for (const bit of bits) {
      if (getBit(data, bit.byte, bit.bit)) {
        states[device] = bit.state;
        break;
      }
    }
  }
  const result: DecodedStatus = { states };
  if (profile.extras.networkError) {
    result.networkError = getBit(data, profile.extras.networkError.byte, profile.extras.networkError.bit);
  }
  if (profile.extras.controlMode) {
    result.controlMode = getBit(data, profile.extras.controlMode.byte, profile.extras.controlMode.bit) ? 'local' : 'remote';
  }
  if (profile.extras.linkFiber) {
    result.linkType = getBit(data, profile.extras.linkFiber.byte, profile.extras.linkFiber.bit) ? 'fiber' : '4g';
  }
  if (profile.extras.battery) {
    const { byte, high, low } = profile.extras.battery;
    result.batteryLevel = (getBit(data, byte, high) ? 2 : 0) + (getBit(data, byte, low) ? 1 : 0);
  }
  return result;
}

export interface DecodedAction {
  device: DeviceKind;
  action: DeviceAction;
  label: string;
  code: string;
  conflict?: boolean;
}

export function commandActionLabel(kind: DeviceKind, action: DeviceAction): string {
  const meta = DEVICE_META[kind];
  return `${meta.label} ${meta.verbs[action] ?? action}`;
}

/** 解析 0x00 命令位。全零帧表示停止/电池活化关（与生成器 C9/E9 一致） */
export function decodeCommand(protocol: ProtocolId, data: ArrayLike<number>): DecodedAction[] {
  const profile = PROFILES[protocol];
  const actions: DecodedAction[] = [];
  for (const bit of profile.commandBits) {
    if (getBit(data, bit.byte, bit.bit)) {
      actions.push({ device: bit.device, action: bit.action, label: bit.label, code: bit.code });
    }
  }
  if (actions.length === 0) {
    if (profile.devices.includes('activation')) {
      actions.push({ device: 'activation', action: 'off', label: '电池活化 关闭（全零）', code: 'E9' });
    }
    return actions;
  }
  const byDevice = new Map<DeviceKind, DecodedAction[]>();
  for (const action of actions) {
    const list = byDevice.get(action.device) ?? [];
    list.push(action);
    byDevice.set(action.device, list);
  }
  for (const list of byDevice.values()) {
    if (list.length > 1) for (const action of list) action.conflict = true;
  }
  return actions;
}

export function encodeCommand(protocol: ProtocolId, actions: Array<{ device: DeviceKind; action: DeviceAction }>): Uint8Array {
  const profile = PROFILES[protocol];
  const bytes = [0, 0];
  for (const item of actions) {
    if (protocol === 'mg400' && item.device === 'activation' && item.action === 'off') return Uint8Array.from([0, 0]);
    const bit = profile.commandBits.find((b) => b.device === item.device && b.action === item.action);
    if (bit) setBit(bytes, bit.byte, bit.bit);
  }
  return Uint8Array.from(bytes);
}

export function presetStates(devices: DeviceKind[], preset: 'initial' | 'ice'): Partial<Record<DeviceKind, DeviceState>> {
  const out: Partial<Record<DeviceKind, DeviceState>> = {};
  for (const device of devices) out[device] = preset === 'initial' ? DEVICE_META[device].initial : DEVICE_META[device].ice;
  return out;
}

export function defaultStates(devices: DeviceKind[]): Record<DeviceKind, DeviceState> {
  const out = {} as Record<DeviceKind, DeviceState>;
  for (const device of devices) out[device] = DEVICE_META[device].initial;
  return out;
}

export function isSettledState(kind: DeviceKind, state: DeviceState | undefined): boolean {
  if (!state) return false;
  const meta = DEVICE_META[kind];
  return state === meta.initial || state === meta.ice;
}
