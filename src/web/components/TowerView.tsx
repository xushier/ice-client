import { useEffect, useRef, useState } from 'react';
import type { ModuleDto, ServerConfig } from '../../core/types';
import type { DeviceKind, DeviceState } from '../../protocol/types';
import { DEFAULT_CONFIG } from '../../core/defaults';
import { DEVICE_META, middleLabel, stateLabel } from '../../protocol/profiles';
import { api } from '../api';
import { useAction } from '../lib/actions';
import { countdown, sideLabel, timeAgo } from '../lib/format';
import { useNow } from '../lib/useNow';
import { useUi, type ThemeMode } from '../store';
import type { TowerViewKey } from '../three/tower';
import { HistoryIcon, LinkIcon, MonitorIcon, PlusIcon, UnplugIcon, WarnIcon } from './icons';
import { TowerScene } from './TowerScene';
import { EmptyState, StatusPill } from './ui';

const MOVING_TO_SETTLED: Partial<Record<DeviceState, DeviceState>> = {
  closing: 'closed',
  opening: 'open',
  locking: 'locked',
  unlocking: 'unlocked',
};

function settle(state: DeviceState | undefined): DeviceState | undefined {
  if (!state) return undefined;
  return MOVING_TO_SETTLED[state] ?? state;
}

function isMoving(state: DeviceState | undefined): boolean {
  return state !== undefined && MOVING_TO_SETTLED[state] !== undefined;
}

/** 各设备与设置里「塔视图动画」对应的时长：接地 / 选相 animSwitchSec，融冰锁 animLockSec，融冰刀闸 animIceSec */
function durationFor(kind: DeviceKind, config: ServerConfig): number {
  if (kind === 'iceLock') return config.animLockSec;
  if (kind === 'iceSwitch') return config.animIceSec;
  return config.animSwitchSec;
}

/**
 * 设备按钮过渡：模型上的动作要 animLockSec / animIceSec / animSwitchSec 秒才完成，
 * 按钮若瞬间跳变会与模型割裂，因此这里按同样的时长、同样的缓动给按钮一个进度过程
 * （文案显示「合闸中 / 分闸中 / 开锁中…」）。
 */
function useDeviceTransition(target: DeviceState | undefined, durationSec: number) {
  const prev = useRef<DeviceState | undefined>(target);
  const [anim, setAnim] = useState<{ progress: number; from: DeviceState } | null>(null);

  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (!from || !target || from === target) return;
    const duration = Math.max(0.25, durationSec) * 1000;
    const start = performance.now();
    let raf = 0;
    setAnim({ progress: 0, from });
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      if (t >= 1) {
        setAnim(null);
        return;
      }
      /* 与模型同一缓动（正弦），进度条才和实物动作同步 */
      setAnim({ progress: 0.5 - 0.5 * Math.cos(Math.PI * t), from });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationSec]);

  return anim;
}

interface DeviceChipProps {
  kind: DeviceKind;
  state: DeviceState | undefined;
  durationSec: number;
  disabled?: boolean;
  onClick: () => void;
}

function DeviceChip({ kind, state, durationSec, disabled, onClick }: DeviceChipProps) {
  const meta = DEVICE_META[kind];
  const target = settle(state);
  const anim = useDeviceTransition(kind === 'activation' ? undefined : target, durationSec);
  const moving = anim !== null || isMoving(state);
  const text = anim ? middleLabel(kind, anim.from) : stateLabel(kind, state);
  const cls = moving ? 'moving' : target === meta.ice ? 'ice' : 'initial';
  return (
    <button
      type="button"
      className={`tower-chip ${cls}`}
      disabled={disabled}
      title={`点击切换 ${meta.label}`}
      onClick={onClick}
    >
      <span className="chip-bar" style={{ width: `${Math.round((anim?.progress ?? 0) * 100)}%` }} />
      <span className="chip-label">
        {meta.short} · {text}
      </span>
    </button>
  );
}

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
        塔视图按模块加载真型铁塔三维模型，可旋转、缩放并点击设备切换状态。请先新建模块，再切回塔视图查看。
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
  const theme = useUi((state) => state.theme);
  const { busy, run } = useAction();
  useNow();
  const [focusOpen, setFocusOpen] = useState(false);

  const config = snapshot?.config ?? DEFAULT_CONFIG;

  const runtime = module.runtime;
  const online = runtime.link === 'online';
  const devices = module.devices;
  const pending = runtime.pending;

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

  return (
    <>
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

        <TowerScene
          module={module}
          animIceSec={config.animIceSec}
          animSwitchSec={config.animSwitchSec}
          animLockSec={config.animLockSec}
          theme={theme}
          onToggle={toggleDevice}
        />
        <div className="tower-hint">拖动旋转 · 滚轮缩放 · 右键平移 · 点击设备切换</div>
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
          {devices.map((kind) => (
            <DeviceChip
              key={kind}
              kind={kind}
              state={module.states[kind]}
              durationSec={durationFor(kind, config)}
              disabled={busy}
              onClick={() => toggleDevice(kind)}
            />
          ))}
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
          <button type="button" className="btn btn-sm" onClick={() => setFocusOpen(true)}>
            全屏
          </button>
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

      {focusOpen ? (
        <TowerFocus
          module={module}
          config={config}
          theme={theme}
          onToggle={toggleDevice}
          onClose={() => setFocusOpen(false)}
        />
      ) : null}
    </>
  );
}

const FOCUS_VIEWS: Array<{ view: TowerViewKey; label: string }> = [
  { view: 'overview', label: '全景' },
  { view: 'mid', label: '中景' },
  { view: 'iceSwitch', label: '融冰刀闸' },
  { view: 'iceLock', label: '融冰锁' },
  { view: 'jumper', label: '跳线 / 引流器' },
  { view: 'ground1', label: '接地刀闸' },
  { view: 'phase1', label: '选相 1' },
];

interface TowerFocusProps {
  module: ModuleDto;
  config: ServerConfig;
  theme: ThemeMode;
  onToggle: (kind: DeviceKind) => void;
  onClose: () => void;
}

/** 全屏塔视图：进入浏览器全屏 + 设备快捷视角 + 动作自动跟随 */
function TowerFocus({ module, config, theme, onToggle, onClose }: TowerFocusProps) {
  /* 打开即进入浏览器全屏（点击「全屏」即用户手势，可直接申请）；关闭时退出全屏 */
  const [focus, setFocus] = useState<{ view: TowerViewKey; seq: number }>({ view: 'overview', seq: 0 });
  const [panMode, setPanMode] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    root?.requestFullscreen?.().catch(() => {
      /* 用户或权限拒绝时保持覆盖层（本身已是整屏） */
    });
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tower-focus" ref={rootRef} onClick={(event) => event.stopPropagation()}>
      <div className="tower-focus-head">
        <StatusPill link={module.runtime.link} error={module.runtime.error} />
        <span className="card-title" style={{ fontSize: 14 }}>
          {module.towerName}
        </span>
        <span className={`tag${module.protocol === 'mg500' ? ' tag-purple' : ''}`}>
          {module.protocol.toUpperCase()}
        </span>
        <span className="faint mono">
          #{module.id} · {sideLabel(module.id)}
        </span>
        <span className="grow" />
        <button type="button" className="btn btn-sm" onClick={onClose}>
          关闭
        </button>
      </div>

      <div className="tower-focus-stage">
        <TowerScene
          module={module}
          animIceSec={config.animIceSec}
          animSwitchSec={config.animSwitchSec}
          animLockSec={config.animLockSec}
          theme={theme}
          onToggle={onToggle}
          focus={focus}
          autoFollow={config.autoMode}
          panMode={panMode}
        />
        <div className="tower-hint">
          {panMode ? '拖动平移 · 滚轮缩放 · 点击设备切换' : '拖动旋转 · 滚轮缩放 · 右键平移 · 点击设备切换'}
        </div>
      </div>

      <div className="tower-focus-bar">
        <button
          type="button"
          className={`btn btn-sm${panMode ? ' btn-primary' : ''}`}
          title="切换左键拖动为平移，便于把塔顶 / 塔底拖到画面中心再放大"
          onClick={() => setPanMode((value) => !value)}
        >
          平移
        </button>
        {FOCUS_VIEWS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`btn btn-sm${focus.view === item.view ? ' btn-primary' : ''}`}
            onClick={() => setFocus((prev) => ({ view: item.view, seq: prev.seq + 1 }))}
          >
            {item.label}
          </button>
        ))}
        <span className="grow" />
        {module.devices.map((kind) => (
          <DeviceChip
            key={kind}
            kind={kind}
            state={module.states[kind]}
            durationSec={durationFor(kind, config)}
            onClick={() => onToggle(kind)}
          />
        ))}
      </div>
    </div>
  );
}
