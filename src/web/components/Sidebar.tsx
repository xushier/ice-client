import { useUi } from '../store';
import { sideLabel } from '../lib/format';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

export function Sidebar() {
  const snapshot = useUi((state) => state.snapshot);
  const collapsed = useUi((state) => state.sidebarCollapsed);
  const toggleSidebar = useUi((state) => state.toggleSidebar);
  const activeId = useUi((state) => state.activeId);
  const setActiveId = useUi((state) => state.setActiveId);
  const modules = snapshot?.modules ?? [];

  const select = (id: number) => {
    setActiveId(id);
    document.getElementById(`module-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-head">
        {collapsed ? null : (
          <span style={{ flex: 1 }}>
            模块 <span className="faint">({modules.length})</span>
          </span>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={toggleSidebar}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
        </button>
      </div>

      <div className="sidebar-list">
        {modules.map((module) => {
          const dot = module.runtime.error && module.runtime.link !== 'online'
            ? 'error'
            : module.runtime.link === 'online'
              ? 'online'
              : module.runtime.link === 'connecting'
                ? 'connecting'
                : '';
          return (
            <button
              type="button"
              key={module.id}
              className={`module-item${module.id === activeId ? ' active' : ''}`}
              title={`${module.towerName} · #${module.id} · ${sideLabel(module.id)}`}
              onClick={() => select(module.id)}
            >
              <span className={`dot ${dot}`} />
              {collapsed ? null : (
                <span className="module-item-main">
                  <span className="module-item-name">{module.towerName}</span>
                  <span className="module-item-sub">
                    #{module.id} · {sideLabel(module.id)} · {module.protocol.toUpperCase()}
                  </span>
                </span>
              )}
            </button>
          );
        })}
        {modules.length === 0 ? (
          <div className="faint" style={{ padding: '10px 8px', fontSize: 11 }}>
            还没有模块
          </div>
        ) : null}
      </div>
    </aside>
  );
}
