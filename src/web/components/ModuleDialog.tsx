import { useState } from 'react';
import type { ProtocolId } from '../../protocol/types';
import type { DeviceKind } from '../../protocol/types';
import { DEVICE_META, PROFILES } from '../../protocol/profiles';
import type { ModuleDto } from '../../core/types';
import { api } from '../api';
import { useAction } from '../lib/actions';
import { useUi } from '../store';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, TrashIcon } from './icons';

export function ModuleDialog({ module }: { module?: ModuleDto }) {
  const closeDialog = useUi((state) => state.closeDialog);
  const setActiveId = useUi((state) => state.setActiveId);
  const toast = useUi((state) => state.toast);
  const { busy, run } = useAction();

  const editing = module !== undefined;
  const [protocol, setProtocol] = useState<ProtocolId>(module?.protocol ?? 'mg500');
  const [idText, setIdText] = useState(String(module?.id ?? ''));
  const [towerName, setTowerName] = useState(module?.towerName ?? '');
  const [host, setHost] = useState(module?.host ?? '10.10.10.143');
  const [portText, setPortText] = useState(String(module?.port ?? 3000));
  const [devices, setDevices] = useState<DeviceKind[]>(module?.devices ?? [...PROFILES.mg500.devices]);
  const [autoConnect, setAutoConnect] = useState(module?.autoConnect ?? true);

  const supported = PROFILES[protocol].devices;

  const changeProtocol = (next: ProtocolId) => {
    setProtocol(next);
    const nextSupported = PROFILES[next].devices;
    setDevices((prev) => {
      const kept = prev.filter((kind) => nextSupported.includes(kind));
      return kept.length ? kept : [...nextSupported];
    });
  };

  const toggleDevice = (kind: DeviceKind) => {
    setDevices((prev) => {
      if (prev.includes(kind)) {
        const next = prev.filter((item) => item !== kind);
        return next;
      }
      return [...prev, kind];
    });
  };

  const move = (index: number, delta: number) => {
    setDevices((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const submit = async () => {
    const id = Number(idText);
    const port = Number(portText);
    if (!Number.isInteger(id) || id < 0 || id > 4095) {
      toast('模块 ID 必须是 0~4095 的整数（12bit）', 'err');
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast('端口必须是 1~65535 的整数', 'err');
      return;
    }
    if (devices.length === 0) {
      toast('至少选择一台设备', 'err');
      return;
    }
    let nextId: number | null = null;
    const payload = {
      id,
      towerName: towerName.trim() || `铁塔 ${id}`,
      protocol,
      host: host.trim(),
      port,
      devices,
      autoConnect,
    };
    const ok = await run(async () => {
      if (editing && module) {
        const updated = await api.updateModule(module.id, payload);
        nextId = updated.id;
      } else {
        const created = await api.createModule(payload);
        nextId = created.id;
      }
    }, editing ? '模块已更新' : '模块已创建');
    if (ok) {
      if (nextId !== null) setActiveId(nextId);
      closeDialog();
    }
  };

  const remove = () => {
    if (!module) return;
    if (!window.confirm(`确定删除模块 #${module.id}（${module.towerName}）？该操作不可撤销。`)) return;
    void run(() => api.deleteModule(module.id), '模块已删除').then((ok) => {
      if (ok) closeDialog();
    });
  };

  return (
    <div className="overlay" onClick={closeDialog}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <span className="dialog-title">{editing ? `编辑模块 #${module?.id}` : '新建终端模块'}</span>
          {editing && module ? <span className="tag">{module.protocol.toUpperCase()}</span> : null}
          <span className="grow" />
          <button type="button" className="icon-btn" onClick={closeDialog} title="关闭">
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="form-section">
            <div className="section-title">通信协议</div>
            <div className="seg-line">
              {(['mg400', 'mg500'] as ProtocolId[]).map((value) => {
                const item = PROFILES[value];
                return (
                  <button
                    type="button"
                    key={value}
                    className={`seg-option${protocol === value ? ' on' : ''}`}
                    onClick={() => changeProtocol(value)}
                  >
                    <b>{item.label}</b>
                    <span>{item.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="form-section">
            <div className="section-title">模块与平台</div>
            <div className="form-grid">
              <div className="field">
                <label>模块 ID（12bit，bit0 = 大小号侧）</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={4095}
                  value={idText}
                  placeholder="例如 13"
                  onChange={(event) => setIdText(event.target.value)}
                />
              </div>
              <div className="field">
                <label>铁塔名称</label>
                <input
                  className="input"
                  value={towerName}
                  placeholder="例如 猫儿山 3 号塔"
                  onChange={(event) => setTowerName(event.target.value)}
                />
              </div>
              <div className="field">
                <label>平台地址</label>
                <input className="input" value={host} onChange={(event) => setHost(event.target.value)} />
              </div>
              <div className="field">
                <label>平台端口</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={65535}
                  value={portText}
                  onChange={(event) => setPortText(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="section-title">设备与展示顺序</div>
            <div className="device-picker">
              {supported.map((kind) => {
                const on = devices.includes(kind);
                return (
                  <label key={kind} className={`device-pick${on ? ' on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleDevice(kind)} />
                    <span>
                      {DEVICE_META[kind].label}
                      <span className="faint" style={{ marginLeft: 5, fontSize: 10 }}>
                        {DEVICE_META[kind].short}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {devices.length > 0 ? (
              <div className="device-picker" style={{ marginTop: 8 }}>
                {devices.map((kind, index) => (
                  <div key={kind} className="device-pick on" style={{ justifyContent: 'space-between' }}>
                    <span>
                      {index + 1}. {DEVICE_META[kind].label}
                    </span>
                    <span className="row" style={{ gap: 2 }}>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 22, height: 22 }}
                        disabled={index === 0}
                        title="上移"
                        onClick={() => move(index, -1)}
                      >
                        <ChevronUpIcon size={11} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 22, height: 22 }}
                        disabled={index === devices.length - 1}
                        title="下移"
                        onClick={() => move(index, 1)}
                      >
                        <ChevronDownIcon size={11} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
                至少选择一台设备
              </div>
            )}

            {editing && module && module.protocol !== protocol ? (
              <div className="error-strip" style={{ margin: '10px 0 0' }}>
                切换协议会移除新协议不支持的设备，并重置这些设备的状态。
              </div>
            ) : null}
          </div>

          <div className="form-section">
            <label className="check">
              <input
                type="checkbox"
                checked={autoConnect}
                onChange={(event) => setAutoConnect(event.target.checked)}
              />
              保存后立即连接（服务端建模块时直接发起 TCP 会话）
            </label>
          </div>
        </div>

        <div className="dialog-foot">
          {editing ? (
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={remove}>
              <TrashIcon size={12} />
              删除模块
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void submit()}>
            {editing ? '保存修改' : '创建并连接'}
          </button>
        </div>
      </div>
    </div>
  );
}
