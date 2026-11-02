import { api } from '../api';
import { useAction } from '../lib/actions';
import { useUi } from '../store';
import {
  CodeIcon,
  GridIcon,
  IceDropIcon,
  LinkIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  ServerIcon,
  SettingsIcon,
  SunIcon,
  TowerIcon,
  UnplugIcon,
} from './icons';

export function TopBar() {
  const snapshot = useUi((state) => state.snapshot);
  const wsState = useUi((state) => state.wsState);
  const view = useUi((state) => state.view);
  const setView = useUi((state) => state.setView);
  const monitorOpen = useUi((state) => state.monitorOpen);
  const toggleMonitor = useUi((state) => state.toggleMonitor);
  const openDialog = useUi((state) => state.openDialog);
  const activeId = useUi((state) => state.activeId);
  const theme = useUi((state) => state.theme);
  const toggleTheme = useUi((state) => state.toggleTheme);
  const { busy, run } = useAction();

  const modules = snapshot?.modules ?? [];
  const online = modules.filter((module) => module.runtime.link === 'online').length;
  const active = modules.find((module) => module.id === activeId) ?? modules[0];

  const wsClass = wsState === 'open' ? 'pill-online' : wsState === 'connecting' ? 'pill-connecting' : 'pill-error';
  const wsText = wsState === 'open' ? '实时通道' : wsState === 'connecting' ? '连接通道…' : '通道断开';

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <IceDropIcon size={17} />
        </div>
        <div>
          <div className="brand-title">融冰终端模拟器</div>
          <div className="brand-sub">MELTICE SIMULATOR</div>
        </div>
      </div>

      <div className="topbar-group">
        <span className="server-chip" title="浏览器与服务端的连接地址">
          <ServerIcon size={12} />
          {location.host || 'localhost'}
        </span>
        {active ? (
          <span className="server-chip" title={`当前模块 ${active.towerName} 的操作平台地址`}>
            <LinkIcon size={12} />
            <span className="mono">
              {active.host}:{active.port}
            </span>
          </span>
        ) : null}
      </div>

      <div className="topbar-spacer" />

      <div className="topbar-group">
        <span className={`pill ${wsClass}`}>{wsText}</span>
        <span className="pill pill-offline no-dot" title="该数字为在线模块数 / 模块总数">
          在线 {online}/{modules.length}
        </span>
      </div>

      <div className="seg" role="tablist" aria-label="视图切换">
        <button type="button" className={view === 'card' ? 'on' : ''} onClick={() => setView('card')}>
          <GridIcon size={12} />
          卡片
        </button>
        <button type="button" className={view === 'tower' ? 'on' : ''} onClick={() => setView('tower')}>
          <TowerIcon size={12} />
          塔视图
        </button>
      </div>

      <div className="topbar-group">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || modules.length === 0}
          onClick={() => void run(() => api.connectAll(), '已发起全部连接')}
        >
          <LinkIcon size={12} />
          全部连接
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || modules.length === 0}
          onClick={() => void run(() => api.disconnectAll(), '已断开全部连接')}
        >
          <UnplugIcon size={12} />
          全部断开
        </button>
        <button
          type="button"
          className={`btn btn-sm ${monitorOpen ? 'btn-primary' : ''}`}
          onClick={toggleMonitor}
          title="停靠式帧监视侧栏"
        >
          <MonitorIcon size={12} />
          帧监视
        </button>
        <button type="button" className="btn btn-sm" onClick={() => openDialog({ kind: 'builder' })}>
          <CodeIcon size={12} />
          帧构造器
        </button>
        <button
          type="button"
          className="icon-btn"
          title={theme === 'dark' ? '切换到主体（浅色）模式' : '切换到深色模式'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
        </button>
        <button type="button" className="icon-btn" title="全局设置" onClick={() => openDialog({ kind: 'settings' })}>
          <SettingsIcon size={15} />
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => openDialog({ kind: 'new' })}>
          <PlusIcon size={12} />
          新建模块
        </button>
      </div>
    </header>
  );
}
