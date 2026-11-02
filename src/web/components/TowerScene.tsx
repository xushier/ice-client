import { useEffect, useRef } from 'react';
import type { ModuleDto } from '../../core/types';
import type { DeviceKind, DeviceState } from '../../protocol/types';
import type { ThemeMode } from '../store';
import { createTowerView, type TowerHandle, type TowerViewKey } from '../three/tower';

interface TowerSceneProps {
  module: ModuleDto;
  animIceSec: number;
  animSwitchSec: number;
  animLockSec: number;
  theme: ThemeMode;
  onToggle: (kind: DeviceKind) => void;
  /** 快捷视角请求：seq 变化即飞向指定视角 */
  focus?: { view: TowerViewKey; seq: number };
  /** 设备状态变化时自动飞到该设备 */
  autoFollow?: boolean;
  /** 左键拖动切换为平移 */
  panMode?: boolean;
}

/** three.js 真 3D 塔视图：命令式创建场景，React 只负责挂载与状态同步 */
export function TowerScene({
  module,
  animIceSec,
  animSwitchSec,
  animLockSec,
  theme,
  onToggle,
  focus,
  autoFollow = false,
  panMode = false,
}: TowerSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TowerHandle | null>(null);

  const optionsRef = useRef({
    onToggle: (_kind: DeviceKind) => {},
    animIceSec,
    animSwitchSec,
    animLockSec,
    theme,
  });
  optionsRef.current.onToggle = onToggle;
  optionsRef.current.animIceSec = animIceSec;
  optionsRef.current.animSwitchSec = animSwitchSec;
  optionsRef.current.animLockSec = animLockSec;
  optionsRef.current.theme = theme;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = createTowerView(host, optionsRef.current);
    handleRef.current = view;
    return () => {
      handleRef.current = null;
      view.dispose();
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setModule(module);
  }, [module]);

  useEffect(() => {
    handleRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    handleRef.current?.setPanMode(panMode);
  }, [panMode]);

  const lastSeq = useRef(0);
  useEffect(() => {
    if (!focus || focus.seq === lastSeq.current) return;
    lastSeq.current = focus.seq;
    handleRef.current?.flyTo(focus.view);
  }, [focus]);

  const prevStates = useRef<Partial<Record<DeviceKind, DeviceState>>>({});
  useEffect(() => {
    const before = prevStates.current;
    const next: Partial<Record<DeviceKind, DeviceState>> = {};
    let changed: DeviceKind | undefined;
    module.devices.forEach((kind) => {
      const state = module.states[kind];
      if (!state) return;
      next[kind] = state;
      if (!changed && before[kind] && before[kind] !== state) changed = kind;
    });
    prevStates.current = next;
    if (autoFollow && changed && changed !== 'activation') {
      handleRef.current?.flyTo(changed);
    }
  }, [module, autoFollow]);

  return <div className="tower-canvas" ref={hostRef} />;
}
