import { useUi } from './store';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { CardGrid } from './components/CardGrid';
import { TowerGrid } from './components/TowerView';
import { FrameMonitor } from './components/FrameMonitor';
import { FrameBuilder } from './components/FrameBuilder';
import { ModuleDialog } from './components/ModuleDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Toasts } from './components/Toasts';

export function App() {
  const booted = useUi((state) => state.booted);
  const snapshot = useUi((state) => state.snapshot);
  const view = useUi((state) => state.view);
  const dialog = useUi((state) => state.dialog);

  if (!booted) {
    return (
      <div className="loading">
        <span className="spinner" />
        正在读取服务端状态…
      </div>
    );
  }

  const modules = snapshot?.modules ?? [];
  const editModule = dialog?.kind === 'edit' ? modules.find((module) => module.id === dialog.moduleId) : undefined;

  return (
    <div className="app">
      <TopBar />
      <div className="shell">
        <Sidebar />
        <main className="main">{view === 'card' ? <CardGrid /> : <TowerGrid />}</main>
        <FrameMonitor />
      </div>

      {dialog?.kind === 'new' ? <ModuleDialog /> : null}
      {dialog?.kind === 'edit' && editModule ? <ModuleDialog key={editModule.id} module={editModule} /> : null}
      {dialog?.kind === 'settings' ? <SettingsDialog /> : null}
      {dialog?.kind === 'builder' ? <FrameBuilder initialModuleId={dialog.moduleId} /> : null}

      <Toasts />
    </div>
  );
}
