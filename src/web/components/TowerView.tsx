import { useEffect, useState } from 'react';
import type { ModuleDto } from '../../core/types';
import type { DeviceKind, DeviceState } from '../../protocol/types';
import { DEFAULT_CONFIG } from '../../core/defaults';
import { DEVICE_META, stateLabel } from '../../protocol/profiles';
import { api } from '../api';
import { useAction } from '../lib/actions';
import { countdown, sideLabel, timeAgo } from '../lib/format';
import { useNow } from '../lib/useNow';
import { useUi } from '../store';
import { HistoryIcon, LinkIcon, MonitorIcon, PlusIcon, UnplugIcon, WarnIcon } from './icons';
import { EmptyState, StatusPill } from './ui';

const MOVING_TO_SETTLED: Partial<Record<DeviceState, DeviceState>> = {
  closing: 'closed',
  opening: 'open',
  locking: 'locked',
  unlocking: 'unlocked',
};

const SWITCH_KINDS: DeviceKind[] = ['ground1', 'ground2', 'phase1', 'phase2', 'phase3'];

function settle(state: DeviceState | undefined): DeviceState | undefined {
  if (!state) return undefined;
  return MOVING_TO_SETTLED[state] ?? state;
}

function isMoving(state: DeviceState | undefined): boolean {
  return state !== undefined && MOVING_TO_SETTLED[state] !== undefined;
}

const ARM_Y = 208;
const ARM_LEFT = 100;
const ARM_RIGHT = 300;
const PIVOT_Y = ARM_Y + 4;
const ROD_LEN = 100;
const SWITCH_Y = 424;

export function TowerGrid() {
  const snapshot = useUi((state) => state.snapshot);
  const openDialog = useUi((state) => state.openDialog);
  const modules = snapshot?.modules ?? [];

  if (modules.length === 0) {
    return (
      <EmptyState
        title="还没有终端模块"
        action={
          <button type="button" className="btn btn-primary" onClick={() => openDialog({ kind: 'new' })}>
            <PlusIcon size={13} />
            新建模块
          </button>
        }
      >
        塔视图按模块绘制 2.5D 铁塔与刀闸装置。请先新建模块，再切回塔视图查看。
      </EmptyState>
    );
  }

  return (
    <div className="tower-grid">
      {modules.map((module) => (
        <TowerCard key={module.id} module={module} />
      ))}
    </div>
  );
}

function TowerCard({ module }: { module: ModuleDto }) {
  const snapshot = useUi((state) => state.snapshot);
  const monitorOpen = useUi((state) => state.monitorOpen);
  const toggleMonitor = useUi((state) => state.toggleMonitor);
  const setActiveId = useUi((state) => state.setActiveId);
  const openDialog = useUi((state) => state.openDialog);
  const { busy, run } = useAction();
  useNow();

  const config = snapshot?.config ?? DEFAULT_CONFIG;
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const runtime = module.runtime;
  const online = runtime.link === 'online';
  const devices = module.devices;
  const pending = runtime.pending;
  const sideRight = (module.id & 1) === 1;

  const endX = sideRight ? ARM_RIGHT : ARM_LEFT;
  const inward = sideRight ? -1 : 1;
  const outward = -inward;
  const ringX = endX + inward * ROD_LEN;
  const lockX = endX + inward * 112;
  const otherEndX = sideRight ? ARM_LEFT : ARM_RIGHT;

  const iceIncluded = devices.includes('iceSwitch');
  const lockIncluded = devices.includes('iceLock');
  const activationIncluded = devices.includes('activation');

  const iceState = module.states.iceSwitch;
  const iceSettled = settle(iceState);
  const iceClosed = iceSettled === 'closed';
  const iceAngle = iceClosed ? 0 : inward > 0 ? -90 : 90;

  const lockState = module.states.iceLock;
  const lockSettled = settle(lockState);
  const locked = lockSettled === 'locked';

  const switchKinds = devices.filter((kind) => SWITCH_KINDS.includes(kind));
  const switchPositions = switchKinds.map((_, index) => 200 + (index - (switchKinds.length - 1) / 2) * 46);

  const toggleDevice = (kind: DeviceKind) => {
    const meta = DEVICE_META[kind];
    const current = settle(module.states[kind]);
    const target = current === meta.ice ? meta.initial : meta.ice;
    void run(() => api.setDevice(module.id, kind, target));
  };

  const openMonitor = () => {
    setActiveId(module.id);
    if (!monitorOpen) toggleMonitor();
  };

  const preset = (kind: 'initial' | 'ice') => {
    void run(() => api.preset(module.id, kind), kind === 'initial' ? '已切换为初始态' : '已切换为融冰态');
  };

  const transitionFor = (base: number) => (animate ? `transform ${base}s cubic-bezier(0.4, 0, 0.2, 1)` : 'none');

  return (
    <article className="tower-card" id={`module-${module.id}`} onClick={() => setActiveId(module.id)}>
      <div className="tower-stage">
        <div className="tower-label">
          <StatusPill link={runtime.link} error={runtime.error} />
          <span className="card-title" style={{ fontSize: 13 }}>
            {module.towerName}
          </span>
          <span className={`tag${module.protocol === 'mg500' ? ' tag-purple' : ''}`}>
            {module.protocol.toUpperCase()}
          </span>
        </div>
        <div className="tower-side">
          #{module.id} · {sideLabel(module.id)} · 收 {runtime.rx} / 发 {runtime.tx}
        </div>

        <svg viewBox="0 0 400 500" role="img" aria-label={`${module.towerName} 铁塔视图`}>
          <defs>
            <linearGradient id="tw-steel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7a92ad" />
              <stop offset="1" stopColor="#3f5674" />
            </linearGradient>
          </defs>

          {/* 地线 */}
          <path d="M 200 70 Q 110 106 10 66" stroke="#3f5674" strokeWidth={1.4} fill="none" />
          <path d="M 200 70 Q 290 106 390 66" stroke="#3f5674" strokeWidth={1.4} fill="none" />

          {/* 塔身 */}
          <line x1="170" y1="470" x2="188" y2="70" stroke="url(#tw-steel)" strokeWidth={3.5} />
          <line x1="230" y1="470" x2="212" y2="70" stroke="url(#tw-steel)" strokeWidth={3.5} />
          {Array.from({ length: 11 }, (_, index) => {
            const y = 90 + index * 38;
            const half = 13 + 17 * ((y - 70) / 400);
            return <line key={`r-${index}`} x1={200 - half} y1={y} x2={200 + half} y2={y} stroke="#3f5674" strokeWidth={1} />;
          })}
          {Array.from({ length: 10 }, (_, index) => {
            const y1 = 90 + index * 38;
            const y2 = y1 + 38;
            const half1 = 13 + 17 * ((y1 - 70) / 400);
            const half2 = 13 + 17 * ((y2 - 70) / 400);
            return (
              <g key={`x-${index}`}>
                <line x1={200 - half1} y1={y1} x2={200 + half2} y2={y2} stroke="#2b3d52" strokeWidth={1} />
                <line x1={200 + half1} y1={y1} x2={200 - half2} y2={y2} stroke="#2b3d52" strokeWidth={1} />
              </g>
            );
          })}
          <rect x={190} y={62} width={20} height={10} rx={2} fill="#5b7695" />

          {/* 横担 */}
          <line x1={ARM_LEFT} y1={ARM_Y} x2={ARM_RIGHT} y2={ARM_Y} stroke="url(#tw-steel)" strokeWidth={5} />
          <line x1={200} y1={ARM_Y - 30} x2={ARM_LEFT} y2={ARM_Y} stroke="#3f5674" strokeWidth={2} />
          <line x1={200} y1={ARM_Y - 30} x2={ARM_RIGHT} y2={ARM_Y} stroke="#3f5674" strokeWidth={2} />

          {/* 两侧跳线 */}
          <path
            d={`M ${ARM_LEFT} ${ARM_Y} Q ${ARM_LEFT - 18} 258 ${ARM_LEFT - 8} ${PIVOT_Y + ROD_LEN + 6}`}
            stroke="#7c93ad"
            strokeWidth={2}
            fill="none"
          />
          <path
            d={`M ${ARM_RIGHT} ${ARM_Y} Q ${ARM_RIGHT + 18} 258 ${ARM_RIGHT + 8} ${PIVOT_Y + ROD_LEN + 6}`}
            stroke="#7c93ad"
            strokeWidth={2}
            fill="none"
          />

          {!iceIncluded ? (
            <text x={otherEndX} y={ARM_Y + 26} textAnchor="middle" fontSize={8} fill="#5f7290">
              该侧无本模块装置
            </text>
          ) : null}

          {/* 融冰刀闸 */}
          {iceIncluded ? (
            <g className="tower-clickable" onClick={() => toggleDevice('iceSwitch')}>
              <rect className="tw-hit" x={endX - 22} y={ARM_Y - 22} width={44} height={28} rx={5} />
              <rect x={endX - 15} y={ARM_Y - 16} width={30} height={16} rx={3} fill="#33475e" stroke="#5b7695" strokeWidth={0.9} />
              <text x={endX} y={ARM_Y - 4} textAnchor="middle" fontSize={7.5} fill="#93a6c0">
                电机
              </text>
              <circle cx={endX} cy={PIVOT_Y} r={6.5} fill="#25384e" stroke="#7dd3fc" strokeWidth={1.2} />
              <g
                style={{
                  transformBox: 'view-box',
                  transformOrigin: `${endX}px ${PIVOT_Y}px`,
                  transform: `rotate(${iceAngle}deg)`,
                  transition: transitionFor(config.animIceSec),
                }}
              >
                <rect x={endX - 3} y={PIVOT_Y} width={6} height={ROD_LEN} rx={2.5} fill="#7dd3fc" opacity={0.88} />
                <circle cx={endX} cy={PIVOT_Y + ROD_LEN} r={6} fill="none" stroke="#7dd3fc" strokeWidth={2} />
                <rect className="tw-hit" x={endX - 11} y={PIVOT_Y + 12} width={22} height={ROD_LEN - 12} rx={6} />
              </g>
              <text x={endX} y={ARM_Y + 34} textAnchor="middle" fontSize={8} fill={isMoving(iceState) ? '#fbbf24' : '#93a6c0'}>
                融冰刀闸 · {stateLabel('iceSwitch', iceState)}
              </text>
            </g>
          ) : null}

          {/* 融冰锁 */}
          {lockIncluded ? (
            <g className="tower-clickable" onClick={() => toggleDevice('iceLock')}>
              <rect
                className="tw-hit"
                x={Math.min(ringX, lockX) - 6}
                y={ARM_Y - 16}
                width={Math.abs(lockX - ringX) + 34}
                height={32}
                rx={5}
              />
              <rect
                x={lockX + inward * 10 - 10}
                y={PIVOT_Y - 7}
                width={20}
                height={14}
                rx={3}
                fill="#33475e"
                stroke="#5b7695"
                strokeWidth={0.9}
              />
              <rect
                x={Math.min(ringX, lockX)}
                y={PIVOT_Y - 3}
                width={Math.abs(lockX - ringX)}
                height={6}
                rx={2}
                fill="#f59e0b"
                style={{
                  transformBox: 'view-box',
                  transformOrigin: `${lockX}px ${PIVOT_Y}px`,
                  transform: `scaleX(${locked ? 1 : 0.15})`,
                  transition: transitionFor(config.animLockSec),
                }}
              />
              <text x={lockX + inward * 10} y={PIVOT_Y + 30} textAnchor="middle" fontSize={8} fill={isMoving(lockState) ? '#fbbf24' : '#93a6c0'}>
                融冰锁 · {stateLabel('iceLock', lockState)}
              </text>
            </g>
          ) : null}

          {/* 接地 / 选相刀闸 */}
          <line
            x1={(switchPositions[0] ?? 200) - 28}
            y1={SWITCH_Y}
            x2={(switchPositions[switchPositions.length - 1] ?? 200) + 28}
            y2={SWITCH_Y}
            stroke="#2b3d52"
            strokeWidth={2}
          />
          {switchKinds.map((kind, index) => {
            const x = switchPositions[index] ?? 200;
            const meta = DEVICE_META[kind];
            const state = module.states[kind];
            const settled = settle(state);
            const open = settled === 'open';
            const moving = isMoving(state);
            const color = moving ? '#fbbf24' : open ? '#64748b' : '#4ade80';
            return (
              <g key={kind} className="tower-clickable" onClick={() => toggleDevice(kind)}>
                <rect className="tw-hit" x={x - 24} y={SWITCH_Y - 16} width={48} height={50} rx={6} />
                <rect x={x + 12} y={SWITCH_Y - 4} width={14} height={8} rx={1.5} fill="#33475e" stroke="#5b7695" strokeWidth={0.8} />
                <g
                  style={{
                    transformBox: 'view-box',
                    transformOrigin: `${x - 18}px ${SWITCH_Y}px`,
                    transform: `rotate(${open ? -42 : 0}deg)`,
                    transition: transitionFor(config.animSwitchSec),
                  }}
                >
                  <rect x={x - 18} y={SWITCH_Y - 3} width={36} height={6} rx={2} fill={color} />
                </g>
                <circle cx={x - 18} cy={SWITCH_Y} r={3.2} fill="#93a6c0" />
                <text x={x} y={SWITCH_Y + 24} textAnchor="middle" fontSize={8.5} fill="#93a6c0">
                  {meta.short}
                </text>
                <text x={x} y={SWITCH_Y + 35} textAnchor="middle" fontSize={8} fill={color}>
                  {stateLabel(kind, state)}
                </text>
              </g>
            );
          })}

          {/* 电池活化 */}
          {activationIncluded ? (
            <g className="tower-clickable" onClick={() => toggleDevice('activation')}>
              <rect className="tw-hit" x={sideRight ? 310 : 58} y={416} width={64} height={40} rx={6} />
              <rect
                x={sideRight ? 324 : 66}
                y={426}
                width={28}
                height={16}
                rx={3}
                fill="#0d1725"
                stroke={module.states.activation === 'on' ? '#f87171' : '#4ade80'}
                strokeWidth={1.2}
              />
              <path
                d={`M ${sideRight ? 338 : 80} 429 l -4 6 h 4 l -2 5 l 5 -7 h -4 z`}
                fill={module.states.activation === 'on' ? '#f87171' : '#4ade80'}
              />
              <text
                x={sideRight ? 352 : 94}
                y={450}
                textAnchor="middle"
                fontSize={8}
                fill={module.states.activation === 'on' ? '#f87171' : '#4ade80'}
              >
                活化 {module.states.activation === 'on' ? '开' : '关'}
              </text>
            </g>
          ) : null}

          <text x={200} y={492} textAnchor="middle" fontSize={8} fill="#3f5674">
            40m
          </text>
        </svg>
      </div>

      {runtime.error ? (
        <div className="error-strip">
          <WarnIcon size={13} />
          <span>{runtime.error}</span>
        </div>
      ) : null}

      <div className="tower-controls">
        {pending.map((item) => (
          <div className="pending-item" key={item.id} style={{ marginBottom: 6 }}>
            <WarnIcon size={12} />
            <span className="grow">
              {item.label} <span className="mono faint">({item.code})</span>
              {item.conflict ? ' · 位冲突' : ''}
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

        <div className="tower-devices">
          {devices.map((kind) => {
            const meta = DEVICE_META[kind];
            const state = module.states[kind];
            const settled = settle(state);
            const moving = isMoving(state);
            const cls = moving ? 'moving' : settled === meta.ice ? 'ice' : 'initial';
            return (
              <button
                type="button"
                key={kind}
                className={`tower-chip ${cls}`}
                disabled={busy}
                title={`点击切换 ${meta.label}`}
                onClick={() => toggleDevice(kind)}
              >
                {meta.short} · {stateLabel(kind, state)}
              </button>
            );
          })}
        </div>

        <div className="row wrap">
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
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => preset('initial')}>
            初始态
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => preset('ice')}>
            融冰态
          </button>
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
          <button type="button" className="btn btn-sm" onClick={openMonitor}>
            <MonitorIcon size={12} />
            监视
          </button>
          <span className="grow" />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => openDialog({ kind: 'edit', moduleId: module.id })}
          >
            编辑
          </button>
        </div>

        <div className="card-foot" style={{ padding: '8px 0 0', borderTop: 'none', marginTop: 8 }}>
          <span>
            最后收帧 <b>{timeAgo(runtime.lastRxAt)}</b>
          </span>
          <span>
            平台回包 <b>{timeAgo(runtime.lastAckAt)}</b>
          </span>
          <span className="mono">
            {module.host}:{module.port}
          </span>
        </div>
      </div>
    </article>
  );
}
