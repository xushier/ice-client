import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';

let dir = '';

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-client-test-'));
});

afterEach(async () => {
  // 等待 300ms 防抖落盘完成，避免 Windows 下 rename 与清理目录竞争
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('Store', () => {
  it('新建 MG500 模块使用协议默认设备与初始态', () => {
    const store = new Store(dir);
    const module = store.createModule({ id: 13, towerName: '13 号塔', protocol: 'mg500' });
    expect(module.devices).toEqual(['ground1', 'ground2', 'phase1', 'phase2', 'phase3', 'iceLock', 'iceSwitch']);
    expect(module.states.ground1).toBe('closed');
    expect(module.states.ground2).toBe('closed');
    expect(module.states.phase1).toBe('open');
    expect(module.states.iceLock).toBe('locked');
    expect(module.states.iceSwitch).toBe('open');
    expect(module.telemetry.socPct).toBe(86);
  });

  it('拒绝重复 / 越界 ID', () => {
    const store = new Store(dir);
    store.createModule({ id: 13 });
    expect(() => store.createModule({ id: 13 })).toThrow(/已被占用/);
    expect(() => store.createModule({ id: 4096 })).toThrow(/0~4095/);
  });

  it('切换协议时过滤不支持设备并补齐状态', () => {
    const store = new Store(dir);
    store.createModule({ id: 7, protocol: 'mg500' });
    const result = store.updateModule(7, { protocol: 'mg400' });
    expect(result.module.devices).not.toContain('ground2');
    expect(result.module.devices).not.toContain('phase3');
    expect(result.module.devices).toContain('activation');
    expect(result.module.states.activation).toBe('off');
  });

  it('自定义设备顺序被保留', () => {
    const store = new Store(dir);
    const module = store.createModule({ id: 9, protocol: 'mg400', devices: ['phase1', 'ground1'] });
    expect(module.devices).toEqual(['phase1', 'ground1']);
    expect(module.states.phase1).toBe('open');
  });

  it('设备状态校验与遥测裁剪', () => {
    const store = new Store(dir);
    store.createModule({ id: 5, protocol: 'mg400' });
    expect(() => store.setDeviceState(5, 'ground1', 'unlocked')).toThrow();
    store.setDeviceState(5, 'ground1', 'opening');
    expect(store.getModule(5).states.ground1).toBe('opening');
    store.patchTelemetry(5, { socPct: 300, batteryVolt: -1 });
    expect(store.getModule(5).telemetry.socPct).toBe(100);
    expect(store.getModule(5).telemetry.batteryVolt).toBe(0);
  });

  it('配置裁剪', () => {
    const store = new Store(dir);
    const config = store.setConfig({ stateIntervalSec: 1, animIceSec: 999, autoMode: true });
    expect(config.stateIntervalSec).toBe(5);
    expect(config.animIceSec).toBe(120);
    expect(config.autoMode).toBe(true);
  });

  it('持久化并恢复模块', async () => {
    const store = new Store(dir);
    store.createModule({ id: 13, towerName: '13 号塔', protocol: 'mg500' });
    store.setDeviceState(13, 'iceSwitch', 'closing');
    await store.saveNow();
    const restored = new Store(dir);
    await restored.init();
    expect(restored.modules).toHaveLength(1);
    expect(restored.getModule(13).towerName).toBe('13 号塔');
    expect(restored.getModule(13).states.iceSwitch).toBe('closing');
  });

  it('导入导出保留协议字段', () => {
    const store = new Store(dir);
    store.createModule({ id: 3, protocol: 'mg400' });
    const exported = store.exportState();
    const other = new Store(path.join(dir, 'other'));
    other.importState(exported);
    expect(other.getModule(3).protocol).toBe('mg400');
  });
});
