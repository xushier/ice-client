import net from 'node:net';
import {
  ACTION_TARGET,
  FrameParser,
  buildFrame,
  decodeCommand,
  encodeEnv,
  encodePower,
  encodeStatus,
  fromHex,
  parseFrame,
  toHex,
} from '../protocol';
import type { DecodedAction } from '../protocol';
import type { DeviceKind, DeviceState } from '../protocol/types';
import type { FrameLog, ModuleRecord, PendingAction, RuntimeState, ServerConfig } from './types';
import type { OperationLog } from './logs';
import { AppError } from './errors';

export interface SessionDeps {
  getConfig: () => ServerConfig;
  getModule: (id: number) => ModuleRecord;
  patchModule: (id: number, mutate: (module: ModuleRecord) => void) => void;
  log: OperationLog;
  emitState: () => void;
  emitFrame: (moduleId: number, frame: FrameLog) => void;
}

export function createRuntime(): RuntimeState {
  return {
    link: 'offline',
    error: null,
    connectedAt: null,
    nextRetryAt: null,
    rx: 0,
    tx: 0,
    lastRxAt: null,
    lastTxAt: null,
    lastStateTxAt: null,
    lastPowerTxAt: null,
    lastHistoryAt: null,
    lastAckAt: null,
    lastTxType: null,
    pending: [],
  };
}

const MAX_FRAMES = 400;
const STABLE_RESET_MS = 15_000;

function isTransitionToward(current: DeviceState | undefined, target: DeviceState): boolean {
  if (!current) return false;
  if (target === 'closed') return current === 'closing';
  if (target === 'open') return current === 'opening';
  if (target === 'locked') return current === 'locking';
  if (target === 'unlocked') return current === 'unlocking';
  return false;
}

/** 到位态对应的「动作中」态：点击后先报动作中，动画走完再报到位 */
const MOVING_OF_SETTLED: Partial<Record<DeviceState, DeviceState>> = {
  closed: 'closing',
  open: 'opening',
  locked: 'locking',
  unlocked: 'unlocking',
};

/** 动作中态对应的到位态：动画期间对外仍上报动作前的到位状态 */
const SETTLED_OF_MOVING: Partial<Record<DeviceState, DeviceState>> = {
  closing: 'closed',
  opening: 'open',
  locking: 'locked',
  unlocking: 'unlocked',
};

const settledOf = (state: DeviceState | undefined) => (state ? (SETTLED_OF_MOVING[state] ?? state) : undefined);

let pendingSeq = 0;

export class ModuleSession {
  readonly runtime: RuntimeState = createRuntime();
  frames: FrameLog[] = [];

  private socket: net.Socket | null = null;
  private parser = new FrameParser();
  private manualStop = false;
  private disposed = false;
  private backoffAttempt = 0;
  private autoRunning = false;
  private autoQueue: string[] = [];
  private autoTimers = new Map<string, NodeJS.Timeout>();

  private stateTimer: NodeJS.Timeout | null = null;
  private powerTimer: NodeJS.Timeout | null = null;
  private envTimer: NodeJS.Timeout | null = null;
  private bundleTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private stateDebounce: NodeJS.Timeout | null = null;
  /** 动作中 → 到位的延时表：塔图动画播完后才上报到位。
   *  from 为该设备动作前的到位态，动画期间 0x10 仍按它上报 */
  private settleTimers = new Map<DeviceKind, { timer: NodeJS.Timeout; state: DeviceState; from?: DeviceState }>();

  constructor(
    public readonly moduleId: number,
    private readonly deps: SessionDeps,
  ) {}

  private get module(): ModuleRecord {
    return this.deps.getModule(this.moduleId);
  }

  private get config(): ServerConfig {
    return this.deps.getConfig();
  }

  connect(): void {
    if (this.disposed) return;
    if (this.socket) return;
    this.manualStop = false;
    this.clearReconnect();
    const module = this.module;
    this.runtime.link = 'connecting';
    this.runtime.error = null;
    this.runtime.nextRetryAt = null;
    this.deps.emitState();

    const socket = net.createConnection({ host: module.host, port: module.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket.once('connect', () => {
      if (this.socket !== socket || this.disposed) return;
      this.runtime.link = 'online';
      this.runtime.connectedAt = Date.now();
      this.runtime.error = null;
      this.runtime.rx = 0;
      this.runtime.tx = 0;
      this.runtime.nextRetryAt = null;
      this.backoffAttempt = 0;
      this.parser.reset();
      this.stableTimer = setTimeout(() => {
        if (this.runtime.link === 'online') this.backoffAttempt = 0;
      }, STABLE_RESET_MS);
      this.deps.log.append({
        at: Date.now(),
        moduleId: module.id,
        towerName: module.towerName,
        kind: 'connect',
        detail: `${module.host}:${module.port}`,
      });
      if (this.config.registration) this.send(0x05, [0xff, 0xff]);
      this.reportHistory('connect');
      this.setupTimers();
      this.deps.emitState();
    });
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (error) => {
      if (this.socket !== socket) return;
      this.runtime.error = this.describeSocketError(error);
      this.deps.emitState();
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onClose();
    });
  }

  disconnect(manual = true): void {
    if (manual) this.manualStop = true;
    this.clearReconnect();
    this.clearTimers();
    this.clearPending();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.destroy();
    }
    this.runtime.link = 'offline';
    this.runtime.connectedAt = null;
    this.runtime.nextRetryAt = null;
    if (manual) this.runtime.error = null;
    /* 断链时把还在「动作中」的设备直接落到到位态，避免按钮一直停在「合闸中」 */
    this.flushSettleTimers();
    this.deps.emitState();
  }

  dispose(): void {
    this.disposed = true;
    this.disconnect(false);
  }

  applyConfig(): void {
    if (this.runtime.link === 'online') this.setupTimers();
  }

  setDevice(device: DeviceKind, state: DeviceState): void {
    this.removePendingForDevice(device);
    this.cancelSettle(device);
    /* 已经是该状态：不重复播一遍动作 */
    if (this.module.states[device] === state) return;
    /* 两种写法都接受：目标到位态（closed…）或动作中态（closing…），统一按「动作中 → 到位」播放，
     * 到位信号等塔图动画（与设置里的时长一致）播放结束之后再发 */
    const moving = MOVING_OF_SETTLED[state] ?? state;
    const target = MOVING_OF_SETTLED[state] ?? SETTLED_OF_MOVING[moving];
    if (!target) {
      this.applyDeviceState(device, state, 'manual');
      return;
    }
    /* 动作开始：设备切到「合闸中 / 分闸中 / 闭锁中 / 开锁中」，塔图动画同步启动；
     * 此时不发 0x10 到位帧（对外仍按动作前的到位态上报） */
    const from = settledOf(this.module.states[device]);
    this.applyDeviceState(device, moving, 'manual', undefined, false);
    this.settleTimers.set(device, {
      state: target,
      from,
      timer: setTimeout(() => {
        this.settleTimers.delete(device);
        if (this.disposed) return;
        this.applyDeviceState(device, target, 'manual');
      }, this.animMsFor(device)),
    });
  }

  /** 塔图里该设备的动画时长（毫秒）：融冰锁 animLockSec、融冰刀闸 animIceSec、其余 animSwitchSec */
  private animMsFor(device: DeviceKind): number {
    const config = this.config;
    const sec = device === 'iceLock' ? config.animLockSec : device === 'iceSwitch' ? config.animIceSec : config.animSwitchSec;
    return Math.max(300, sec * 1000);
  }

  /** 取消某设备尚未播完的到位延时（重新下发指令 / 平台确认到位时） */
  private cancelSettle(device: DeviceKind): void {
    const running = this.settleTimers.get(device);
    if (running) clearTimeout(running.timer);
    this.settleTimers.delete(device);
  }

  /** 立即把还在等待到位的设备落到目标态（断链时用，不再发帧） */
  private flushSettleTimers(): void {
    if (this.settleTimers.size === 0) return;
    const entries = [...this.settleTimers];
    this.settleTimers.clear();
    for (const [device, entry] of entries) {
      clearTimeout(entry.timer);
      this.deps.patchModule(this.moduleId, (module) => {
        module.states = { ...module.states, [device]: entry.state };
      });
    }
  }

  preset(states: Partial<Record<DeviceKind, DeviceState>>): void {
    this.clearPending();
    this.settleTimers.forEach((entry) => clearTimeout(entry.timer));
    this.settleTimers.clear();
    this.deps.patchModule(this.moduleId, (module) => {
      module.states = { ...module.states, ...states };
    });
    this.deps.log.append({
      at: Date.now(),
      moduleId: this.moduleId,
      towerName: this.module.towerName,
      kind: 'device',
      detail: '一键切换设备状态',
    });
    this.queueStatus();
    this.deps.emitState();
  }

  acceptPending(id: string): void {
    const item = this.runtime.pending.find((entry) => entry.id === id);
    if (!item) return;
    this.removePending(id);
    this.cancelSettle(item.device);
    this.applyDeviceState(item.device, ACTION_TARGET[item.action], 'platform', item.label);
  }

  ignorePending(id: string): void {
    const item = this.runtime.pending.find((entry) => entry.id === id);
    if (!item) return;
    this.removePending(id);
    this.deps.log.append({
      at: Date.now(),
      moduleId: this.moduleId,
      towerName: this.module.towerName,
      kind: 'pending',
      device: item.device,
      state: item.action,
      detail: `忽略待动作 ${item.label}`,
    });
    this.deps.emitState();
  }

  reportHistory(source: 'connect' | 'auto' | 'manual'): void {
    if (this.runtime.link !== 'online') {
      if (source === 'manual') throw new AppError('模块未连接，无法上报历史整包');
      return;
    }
    this.sendStatus();
    this.sendPower();
    if (this.config.envReport) this.sendEnv();
    this.runtime.lastHistoryAt = Date.now();
    this.deps.log.append({
      at: Date.now(),
      moduleId: this.moduleId,
      towerName: this.module.towerName,
      kind: 'history',
      detail: `历史整包（${source}）：0x10${this.config.envReport ? ' + 0x20 + 0x30' : ' + 0x20'}`,
    });
    this.deps.emitState();
  }

  sendTyped(type: number, data: number[]): void {
    if (this.runtime.link !== 'online') throw new AppError('模块未连接，无法发送帧');
    this.send(type, data);
    this.deps.log.append({
      at: Date.now(),
      moduleId: this.moduleId,
      towerName: this.module.towerName,
      kind: 'send',
      detail: `手动发送 0x${type.toString(16).padStart(2, '0').toUpperCase()}`,
    });
  }

  sendRaw(hexText: string): void {
    if (this.runtime.link !== 'online') throw new AppError('模块未连接，无法发送帧');
    let raw: Uint8Array;
    try {
      raw = fromHex(hexText);
    } catch (error) {
      throw new AppError((error as Error).message);
    }
    const parsed = parseFrame(raw);
    if (!parsed) throw new AppError('不是合法的 5A47 帧（帧头 / 长度 / CRC 不匹配）');
    this.writeRaw(raw, parsed.type);
    this.deps.log.append({
      at: Date.now(),
      moduleId: this.moduleId,
      towerName: this.module.towerName,
      kind: 'send',
      detail: `手动发送整帧 ${toHex(raw)}`,
    });
  }

  private applyDeviceState(
    device: DeviceKind,
    state: DeviceState,
    source: 'platform' | 'manual',
    label?: string,
    report = true,
  ): void {
    this.deps.patchModule(this.moduleId, (module) => {
      module.states = { ...module.states, [device]: state };
    });
    this.deps.log.append({
      at: Date.now(),
      moduleId: this.moduleId,
      towerName: this.module.towerName,
      kind: 'device',
      device,
      state,
      detail: label ?? `${device} → ${state}（${source}）`,
    });
    if (report) this.queueStatus();
    this.deps.emitState();
  }

  private onData(chunk: Buffer): void {
    const parsed = this.parser.push(new Uint8Array(chunk));
    if (parsed.length === 0) {
      this.deps.emitState();
      return;
    }
    for (const frame of parsed) {
      this.runtime.rx += 1;
      this.runtime.lastRxAt = Date.now();
      this.record('rx', frame.raw, frame.type, frame.crcOk, frame.crcOk ? undefined : 'CRC 校验失败');
      this.handleFrame(frame.type, Array.from(frame.data));
    }
    this.deps.emitState();
  }

  private handleFrame(type: number, data: number[]): void {
    switch (type) {
      case 0x00:
        this.send(0x01, [0x00]);
        this.handleCommand(data);
        break;
      case 0x02:
        this.send(0x03, [0x00]);
        this.deps.log.append({
          at: Date.now(),
          moduleId: this.moduleId,
          towerName: this.module.towerName,
          kind: 'command',
          detail: `空调命令：${data[0] === 1 ? '打开' : '关闭'}`,
        });
        break;
      case 0x01:
      case 0x11:
      case 0x21:
      case 0x31:
        this.runtime.lastAckAt = Date.now();
        break;
      default:
        break;
    }
  }

  private handleCommand(data: number[]): void {
    const module = this.module;
    const actions = decodeCommand(module.protocol, data).filter((action) => module.devices.includes(action.device));
    if (actions.length === 0) return;
    this.deps.log.append({
      at: Date.now(),
      moduleId: module.id,
      towerName: module.towerName,
      kind: 'command',
      detail: actions.map((action: DecodedAction) => `${action.label}${action.conflict ? '（冲突）' : ''}`).join('、'),
    });
    const config = this.config;
    const now = Date.now();
    for (const action of actions) {
      const target = ACTION_TARGET[action.action];
      const current = module.states[action.device];
      if (current === target || isTransitionToward(current, target)) continue;
      this.removePendingForDevice(action.device);
      const item: PendingAction = {
        id: `p${++pendingSeq}`,
        device: action.device,
        action: action.action,
        code: action.code,
        label: action.label,
        conflict: Boolean(action.conflict),
        source: 'platform',
        at: now,
      };
      this.runtime.pending.push(item);
      if (config.autoMode && !item.conflict) {
        this.autoQueue.push(item.id);
        this.pumpAutoQueue();
      }
    }
    this.deps.emitState();
  }

  private pumpAutoQueue(): void {
    if (this.autoRunning) return;
    this.autoRunning = true;
    const advance = () => {
      const id = this.autoQueue.shift();
      if (!id) {
        this.autoRunning = false;
        return;
      }
      const item = this.runtime.pending.find((entry) => entry.id === id);
      if (!item) {
        advance();
        return;
      }
      const delay = this.config.autoDelaySec * 1000;
      item.dueAt = Date.now() + delay;
      const timer = setTimeout(() => {
        this.autoTimers.delete(id);
        this.acceptPending(id);
        advance();
      }, delay);
      this.autoTimers.set(id, timer);
      this.deps.emitState();
    };
    advance();
  }

  private removePending(id: string): void {
    const timer = this.autoTimers.get(id);
    if (timer) clearTimeout(timer);
    this.autoTimers.delete(id);
    this.autoQueue = this.autoQueue.filter((entry) => entry !== id);
    this.runtime.pending = this.runtime.pending.filter((entry) => entry.id !== id);
  }

  private removePendingForDevice(device: DeviceKind): void {
    for (const item of [...this.runtime.pending]) {
      if (item.device === device) this.removePending(item.id);
    }
  }

  private clearPending(): void {
    for (const timer of this.autoTimers.values()) clearTimeout(timer);
    this.autoTimers.clear();
    this.autoQueue = [];
    this.runtime.pending = [];
  }

  private setupTimers(): void {
    this.clearTimers();
    const config = this.config;
    this.stateTimer = setInterval(() => {
      if (this.runtime.link === 'online') this.sendStatus();
    }, config.stateIntervalSec * 1000);
    if (config.hourlyBundle) {
      this.scheduleBundle();
    } else {
      this.powerTimer = setInterval(() => {
        if (this.runtime.link === 'online') this.sendPower();
      }, config.powerIntervalSec * 1000);
    }
    if (config.envReport) {
      this.envTimer = setInterval(() => {
        if (this.runtime.link === 'online') this.sendEnv();
      }, config.envIntervalSec * 1000);
    }
  }

  private scheduleBundle(): void {
    if (this.bundleTimer) clearTimeout(this.bundleTimer);
    const config = this.config;
    const delay = config.alignHourly ? this.msToNextAlignedBundle() : config.powerIntervalSec * 1000;
    this.bundleTimer = setTimeout(() => {
      if (this.runtime.link === 'online') this.reportHistory('auto');
      this.scheduleBundle();
    }, delay);
  }

  private msToNextAlignedBundle(): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(now.getHours() + 1, 0, 5, 0);
    return Math.max(1000, next.getTime() - now.getTime());
  }

  private clearTimers(): void {
    for (const timer of [this.stateTimer, this.powerTimer, this.envTimer, this.bundleTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.stateTimer = null;
    this.powerTimer = null;
    this.envTimer = null;
    this.bundleTimer = null;
  }

  private queueStatus(): void {
    if (this.stateDebounce) clearTimeout(this.stateDebounce);
    this.stateDebounce = setTimeout(() => {
      this.stateDebounce = null;
      if (this.runtime.link === 'online') this.sendStatus();
    }, 80);
  }

  private sendStatus(): void {
    const module = this.module;
    const config = this.config;
    /* 动作中的设备仍按动作前的到位态上报，周期帧与到位帧都只在动画结束后翻转 */
    const states = { ...module.states };
    this.settleTimers.forEach((entry, device) => {
      if (entry.from) states[device] = entry.from;
    });
    const data = encodeStatus(module.protocol, states, {
      networkError: config.networkError,
      controlMode: config.controlMode,
      linkType: config.linkType,
      socPct: module.telemetry.socPct,
    });
    this.send(0x10, Array.from(data));
    this.runtime.lastStateTxAt = Date.now();
  }

  private sendPower(): void {
    const telemetry = this.module.telemetry;
    const data = encodePower({
      socPct: telemetry.socPct,
      batteryVolt: telemetry.batteryVolt,
      loadVolt: telemetry.loadVolt,
      loadCurrent: telemetry.loadCurrent,
      solarVolt: telemetry.solarVolt,
      solarCurrent: telemetry.solarCurrent,
      chargeState: telemetry.chargeState,
      faultHigh: telemetry.faultHigh,
      faultLow: telemetry.faultLow,
    });
    this.send(0x20, Array.from(data));
    this.runtime.lastPowerTxAt = Date.now();
  }

  private sendEnv(): void {
    const telemetry = this.module.telemetry;
    const data = encodeEnv({
      temp: telemetry.envTemp,
      humidity: telemetry.envHumidity,
      cell1Temp: telemetry.cell1Temp,
      cell2Temp: telemetry.cell2Temp,
      acState: telemetry.acState,
      acAlarmLow: telemetry.acAlarmLow,
      acAlarm17: telemetry.acAlarm17,
      fireUsed: telemetry.fireUsed,
    });
    this.send(0x30, Array.from(data));
  }

  private send(type: number, data: number[]): void {
    if (this.runtime.link !== 'online' || !this.socket) {
      throw new AppError('模块未连接，无法发送帧');
    }
    const frame = buildFrame(this.moduleId, type, data);
    this.writeRaw(frame, type);
  }

  private writeRaw(raw: Uint8Array, type: number): void {
    if (!this.socket) throw new AppError('模块未连接，无法发送帧');
    this.socket.write(raw);
    this.runtime.tx += 1;
    this.runtime.lastTxAt = Date.now();
    this.runtime.lastTxType = type;
    this.record('tx', raw, type, true);
    this.deps.emitState();
  }

  private record(dir: 'tx' | 'rx', raw: Uint8Array, type: number, crcOk: boolean, error?: string): void {
    const frame: FrameLog = {
      dir,
      at: Date.now(),
      hex: toHex(raw),
      type,
      id: ((raw[3] & 0x0f) << 8) | raw[4],
      crcOk,
      error,
    };
    this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) this.frames.splice(0, this.frames.length - MAX_FRAMES);
    this.deps.emitFrame(this.moduleId, frame);
  }

  private onClose(): void {
    this.clearTimers();
    this.clearPending();
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    const duration = this.runtime.connectedAt ? Date.now() - this.runtime.connectedAt : 0;
    const wasOnline = this.runtime.link === 'online';
    this.runtime.link = 'offline';
    this.runtime.connectedAt = null;
    if (!this.manualStop && wasOnline) {
      const lastType = this.runtime.lastTxType;
      this.runtime.error = `服务端在连接后 ${duration}ms 主动断开${lastType !== null ? `，最后发送 0x${lastType.toString(16).padStart(2, '0').toUpperCase()}` : ''}。可能是同 ID 会话，或平台不接受该帧类型`;
      this.deps.log.append({
        at: Date.now(),
        moduleId: this.moduleId,
        towerName: this.module.towerName,
        kind: 'disconnect',
        detail: this.runtime.error,
      });
    }
    this.scheduleReconnect();
    this.deps.emitState();
  }

  private describeSocketError(error: NodeJS.ErrnoException): string {
    switch (error.code) {
      case 'ECONNREFUSED':
        return '连接被拒绝：平台未监听该端口，或 TCP 端口错误';
      case 'ETIMEDOUT':
        return '连接超时：检查终端到平台 / 加密盒的网络与端口放行';
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return '网络不可达：当前服务端无法路由到平台地址';
      case 'ENOTFOUND':
        return '地址解析失败：检查平台地址';
      default:
        return `连接错误：${error.message}`;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.manualStop) return;
    if (!this.config.autoReconnect) return;
    const delay = Math.min(30_000, 800 * 2 ** this.backoffAttempt);
    this.backoffAttempt += 1;
    this.runtime.nextRetryAt = Date.now() + delay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.runtime.nextRetryAt = null;
      if (!this.manualStop) this.connect();
    }, delay);
    this.deps.emitState();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.runtime.nextRetryAt = null;
  }
}
