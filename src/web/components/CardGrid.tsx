import { useUi } from '../store';
import { ModuleCard } from './ModuleCard';
import { EmptyState } from './ui';
import { PlusIcon } from './icons';

export function CardGrid() {
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
        新建一个模块来模拟现场融冰终端：填写模块 ID 与平台地址，服务端会为每个模块建立一条独立 TCP 会话。
      </EmptyState>
    );
  }

  return (
    <div className="card-grid">
      {modules.map((module) => (
        <ModuleCard key={module.id} module={module} />
      ))}
    </div>
  );
}
