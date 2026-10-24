import { useEffect, useState } from 'react';
import type { ModuleDto, Telemetry } from '../../core/types';
import type { DeviceKind, DeviceState } from '../../protocol/types';
import { DEVICE_META, middleLabel, stateLabel } from '../../protocol/profiles';
import { api } from '../api';
import { useAction } from '../lib/actions';
import { countdown, duration, sideLabel, timeAgo } from '../lib/format';
import { useNow } from '../lib/useNow';
import { useUi } from '../store';
import {
  BatteryIcon,
  GripIcon,
  HistoryIcon,
  LinkIcon,
  MonitorIcon,
  SunIcon,
  TrashIcon,
  UnplugIcon,
  WarnIcon,
  EditIcon,
} from './icons';
import { CounterChip, Stat, StatusPill } from './ui';

type NumKey =
  | 'socPct'
  | 'batteryVolt'
  | 'loadVolt'
  | 'loadCurrent'
  | 'solarVolt'
  | 'solarCurrent'
  | 'chargeState'
  | 'faultHigh'
  | 'faultLow'
  | 'envTemp'
  | 'envHumidity'
  | 'cell1Temp'
  | 'cell2Temp'
  | 'acState'
  | 'acAlarmLow';

const TELEMETRY_FIELDS: Array<{ key: NumKey; label: string; step: number; nullable?: boolean }> = [
  { key: 'socPct', label: '电量 %', step: 1 },
  { key: 'batteryVolt', label: '电池电压 V', step: 0.1 },
  { key: 'loadVolt', label: '负载电压 V', step: 0.1 },
  { key: 'loadCurrent', label: '负载电流 A', step: 0.01 },
  { key: 'solarVolt', label: '光伏电压 V', step: 0.1 },
  { key: 'solarCurrent', label: '光伏电流 A', step: 0.01 },
  { key: 'chargeState', label: '充电状态', step: 1 },
  { key: 'faultHigh', label: '故障高位', step: 1 },
  { key: 'faultLow', label: '故障低位', step: 1 },
  { key: 'envTemp', label: '机柜温度 ℃', step: 0.1, nullable: true },
  { key: 'envHumidity', label: '机柜湿度 %', step: 0.1, nullable: true },
  { key: 'cell1Temp', label: '电池舱 1 ℃', step: 0.1, nullable: true },
  { key: 'cell2Temp', label: '电池舱 2 ℃', step: 0.1, nullable: true },
  { key: 'acState', label: '空调状态', step: 1 },
  { key: 'acAlarmLow', label: '空调告警 1~16', step: 1 },
];

const MOVING_TO_SETTLED: Partial<Record<DeviceState, DeviceState>> = {
  closing: 'closed',
  opening: 'open',
  locking: 'locked',
  unlocking: 'unlocked',
};

function isMoving(state: DeviceState | undefined): boolean {
  return state !== undefined && MOVING_TO_SETTLED[state] !== undefined;
}

function middleTarget(device: DeviceKind, state: DeviceState | undefined): DeviceState {
  const settled = state ? MOVING_TO_SETTLED[state] : undefined;
  if (settled) return settled;
  const meta = DEVICE_META[device];
  const target = state === meta.ice ? meta.initial : meta.ice;
  if (device === 'iceLock') return target === 'locked' ? 'locking' : 'unlocking';
  if (device === 'activation') return target;
  return target === 'closed' ? 'closing' : 'opening';
}

export function ModuleCard({ module }: { module: ModuleDto }) {
  const snapshot = useUi((state) => state.snapshot);
  const activeId = useUi((state) => state.activeId);
  const setActiveId = useUi((state) => state.setActiveId);
  const monitorOpen = useUi((state) => state.monitorOpen);
  const toggleMonitor = useUi((state) => state.toggleMonitor);
  const openDialog = useUi((state) => state.openDialog);
  const { busy, run } = useAction();
  const now = useNow();

  const [telOpen, setTelOpen] = useState(false);
  const [draft, setDraft] = useState<Telemetry | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useEffect(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, [module.devices]);

  const runtime = module.runtime;
  const online = runtime.link === 'online';
  const config = snapshot?.config;
  const pending = runtime.pending;

  const setDevice = (device: DeviceKind, state: DeviceState) => {
    void run(() => api.setDevice(module.id, device, state));
  };

  const preset = (kind: 'initial' | 'ice') => {
    void run(() => api.preset(module.id, kind), kind === 'initial' ? '已切换为初始态' : '已切换为融冰态');
  };

  const remove = () => {
    if (!window.confirm(`确定删除模块 #${module.id}（${module.towerName}）？该操作不可撤销。`)) return;
    void run(() => api.deleteModule(module.id), '模块已删除');
  };

  const toggleTel = () => {
    if (telOpen) {
      setTelOpen(false);
      setDraft(null);
    } else {
      setDraft({ ...module.telemetry });
      setTelOpen(true);
    }
  };

  const saveTelemetry = () => {
    if (!draft) return;
    void run(() => api.patchTelemetry(module.id, draft), '遥测数据已保存').then((ok) => {
      if (ok) {
        setTelOpen(false);
        setDraft(null);
      }
    });
  };

  const openMonitor = () => {
    setActiveId(module.id);
    if (!monitorOpen) toggleMonitor();
  };

  const reorder = (target: number) => {
    if (dragIndex === null || dragIndex === target) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    const next = [...module.devices];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    setDragIndex(null);
    setDropIndex(null);
    void run(() => api.updateModule(module.id, { devices: next }), '设备顺序已更新');
  };

  const updateNum = (key: NumKey, value: number | null) => {
    setDraft((prev) => (prev ? ({ ...prev, [key]: value } as Telemetry) : prev));
  };

  return (
    <article className="card" id={`module-${module.id}`} onClick={() => setActiveId(module.id)}>
      <div className="card-head">
        <div className="card-title-wrap">
          <div className="card-title-line">
            <span className="card-title">{module.towerName}</span>
            <span className={`tag${module.protocol === 'mg500' ? ' tag-purple' : ''}`}>
              {module.protocol.toUpperCase()}
            </span>
            <span className="tag">#{module.id}</span>
            <span className="faint" style={{ fontSize: 10.5 }}>
              {sideLabel(module.id)}
            </span>
          </div>
          <div className="card-sub">
            <StatusPill link={runtime.link} error={runtime.error} />
            <CounterChip label="收" value={runtime.rx} />
            <CounterChip label="发" value={runtime.tx} />
            <span>最后收帧 {timeAgo(runtime.lastRxAt)}</span>
            {online && runtime.connectedAt ? <span>稳定 {duration(now - runtime.connectedAt)}</span> : null}
            <span className="mono">
              {module.host}:{module.port}
            </span>
          </div>
        </div>
        <div className="card-head-right">
          <button
            type="button"
            className="icon-btn"
            title="编辑模块"
            onClick={() => openDialog({ kind: 'edit', moduleId: module.id })}
          >
            <EditIcon size={14} />
          </button>
          <button type="button" className="icon-btn danger" title="删除模块" onClick={remove}>
            <TrashIcon size={14} />
          </button>
        </div>
      </div>

      {runtime.error ? (
        <div className="error-strip">
          <WarnIcon size={13} />
          <span>{runtime.error}</span>
        </div>
      ) : null}

      <div className="cmd-bar">
        {online ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void run(() => api.disconnect(module.id), '已断开连接')}
          >
            <UnplugIcon size={12} />
            断开
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => void run(() => api.connect(module.id), '已发起连接')}
          >
            <LinkIcon size={12} />
            连接
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          disabled={!online || busy}
          title="立即发送 0x10 + 0x20 历史整包"
          onClick={() => void run(() => api.history(module.id), '历史整包已发送')}
        >
          <HistoryIcon size={12} />
          历史
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => preset('initial')}>
          初始态
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => preset('ice')}>
          融冰态
        </button>
        <span className="spacer" />
        <button
          type="button"
          className={`btn btn-sm${telOpen ? ' btn-primary' : ''}`}
          onClick={toggleTel}
        >
          {telOpen ? '收起遥测' : '遥测'}
        </button>
        <button type="button" className="btn btn-sm" onClick={openMonitor}>
          <MonitorIcon size={12} />
          监视
        </button>
      </div>

      {pending.length > 0 ? (
        <div className="card-section">
          {pending.map((item) => (
            <div className="pending-item" key={item.id}>
              <WarnIcon size={12} />
              <span className="grow">
                {item.label} <span className="mono faint">({item.code})</span>
                {item.conflict ? ' · 位冲突' : ''} · {item.source === 'platform' ? '平台下发' : '手动'}
              </span>
              {item.dueAt ? <span className="pending-due">{countdown(item.dueAt)}</span> : null}
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => void run(() => api.acceptPending(module.id, item.id), '已确认到位并上报')}
              >
                已到位
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void run(() => api.ignorePending(module.id, item.id), '已忽略该指令')}
              >
                忽略
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {module.devices.length > 0 ? (
        <div className="card-section">
          {module.devices.map((device, index) => {
            const meta = DEVICE_META[device];
            const state = module.states[device];
            const moving = isMoving(state);
            const isInitial = state === meta.initial;
            const isIce = state === meta.ice;
            const hasPending = pending.some((item) => item.device === device);
            return (
              <div
                key={device}
                className={[
                  'device-row',
                  moving ? 'pending' : '',
                  dragIndex === index ? 'dragging' : '',
                  dropIndex === index && dragIndex !== null && dragIndex !== index ? 'drop-target' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropIndex(index);
                }}
                onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  reorder(index);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
              >
                <span className="drag-handle" title="拖拽调整顺序">
                  <GripIcon size={13} />
                </span>
                <div className="device-name">
                  {meta.label}
                  <small>
                    {meta.short}
                    {hasPending ? ' · 待确认' : ''}
                  </small>
                </div>
                <div className="tri">
                  <button
                    type="button"
                    className={`tri-btn is-initial${isInitial ? ' active' : ''}`}
                    disabled={busy}
                    title={`设置为${stateLabel(device, meta.initial)}`}
                    onClick={() => setDevice(device, meta.initial)}
                  >
                    {stateLabel(device, meta.initial)}
                  </button>
                  <button
                    type="button"
                    className={`tri-mid${moving ? ' active' : ''}`}
                    disabled={busy || device === 'activation'}
                    title={device === 'activation' ? '活化无动作中状态' : '模拟动作中（上报为双位 0）'}
                    onClick={() => setDevice(device, middleTarget(device, state))}
                  >
                    {middleLabel(device, state)}
                  </button>
                  <button
                    type="button"
                    className={`tri-btn is-ice${isIce ? ' active' : ''}`}
                    disabled={busy}
                    title={`设置为${stateLabel(device, meta.ice)}`}
                    onClick={() => setDevice(device, meta.ice)}
                  >
                    {stateLabel(device, meta.ice)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="telemetry">
        <div className="stat-grid">
          <Stat
            label="电池电压"
            icon={BatteryIcon}
            value={module.telemetry.batteryVolt.toFixed(1)}
            unit="V"
            ratio={module.telemetry.batteryVolt / 60}
            hint={`负载 ${module.telemetry.loadVolt.toFixed(1)}V · ${module.telemetry.loadCurrent.toFixed(2)}A`}
          />
          <Stat
            label="电量"
            icon={BatteryIcon}
            value={module.telemetry.socPct}
            unit="%"
            ratio={module.telemetry.socPct / 100}
            hint={`充电状态 ${module.telemetry.chargeState}`}
          />
          <Stat
            label="光伏电压"
            icon={SunIcon}
            value={module.telemetry.solarVolt.toFixed(1)}
            unit="V"
            ratio={module.telemetry.solarVolt / 100}
            hint={`光伏电流 ${module.telemetry.solarCurrent.toFixed(2)}A`}
          />
          <Stat
            label="控制模式"
            icon={LinkIcon}
            value={config?.controlMode === 'local' ? '本地' : '远程'}
            hint={`${config?.linkType === 'fiber' ? '光纤链路' : '4G 链路'} · ${config?.networkError ? '网络异常' : '网络正常'}`}
          />
        </div>

        {telOpen && draft ? (
          <div className="tel-editor">
            <div className="field-grid">
              {TELEMETRY_FIELDS.map((field) => (
                <div className="field" key={field.key}>
                  <label>{field.label}</label>
                  <input
                    className="input"
                    type="number"
                    step={field.step}
                    value={draft[field.key] === null ? '' : (draft[field.key] as number)}
                    placeholder={field.nullable ? '留空=异常(FFFF)' : undefined}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (raw === '') {
                        updateNum(field.key, field.nullable ? null : 0);
                      } else {
                        const value = Number(raw);
                        updateNum(field.key, Number.isFinite(value) ? value : 0);
                      }
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="row wrap" style={{ marginTop: 10 }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.acAlarm17}
                  onChange={(event) =>
                    setDraft((prev) => (prev ? { ...prev, acAlarm17: event.target.checked } : prev))
                  }
                />
                空调告警 17
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.fireUsed}
                  onChange={(event) =>
                    setDraft((prev) => (prev ? { ...prev, fireUsed: event.target.checked } : prev))
                  }
                />
                灭火装置已用
              </label>
              <span className="grow" />
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => {
                  setTelOpen(false);
                  setDraft(null);
                }}
              >
                取消
              </button>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={saveTelemetry}>
                保存遥测
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card-foot">
        <span>
          历史整包 <b>{timeAgo(runtime.lastHistoryAt)}</b>
        </span>
        <span>
          平台回包 <b>{timeAgo(runtime.lastAckAt)}</b>
        </span>
        <span>
          状态帧 <b>{timeAgo(runtime.lastStateTxAt)}</b>
        </span>
        <span>
          供电帧 <b>{timeAgo(runtime.lastPowerTxAt)}</b>
        </span>
        {runtime.nextRetryAt ? (
          <span>
            重连 <b>{countdown(runtime.nextRetryAt)}</b>
          </span>
        ) : null}
      </div>
    </article>
  );
}
