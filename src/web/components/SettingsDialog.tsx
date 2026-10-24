import { useRef, useState } from 'react';
import type { ServerConfig } from '../../core/types';
import { api } from '../api';
import { useAction } from '../lib/actions';
import { useUi } from '../store';
import { CloseIcon, DownloadIcon, UploadIcon } from './icons';

export function SettingsDialog() {
  const snapshot = useUi((state) => state.snapshot);
  const closeDialog = useUi((state) => state.closeDialog);
  const refresh = useUi((state) => state.refresh);
  const toast = useUi((state) => state.toast);
  const { busy, run } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);

  const initial = snapshot?.config;
  const [draft, setDraft] = useState<ServerConfig | null>(initial ? { ...initial } : null);

  if (!draft) {
    return (
      <div className="overlay" onClick={closeDialog}>
        <div className="dialog" onClick={(event) => event.stopPropagation()}>
          <div className="dialog-head">
            <span className="dialog-title">全局设置</span>
            <span className="grow" />
            <button type="button" className="icon-btn" onClick={closeDialog}>
              <CloseIcon size={15} />
            </button>
          </div>
          <div className="dialog-body">
            <div className="loading">
              <span className="spinner" />
              正在读取配置…
            </div>
          </div>
        </div>
      </div>
    );
  }

  const update = <K extends keyof ServerConfig>(key: K, value: ServerConfig[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const numberField = (
    key: keyof ServerConfig,
    label: string,
    min: number,
    max: number,
    step = 1,
  ) => (
    <div className="field" key={key}>
      <label>{label}</label>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft[key] as number}
        onChange={(event) => update(key, Number(event.target.value) as ServerConfig[typeof key])}
      />
    </div>
  );

  const save = () => {
    void run(() => api.patchConfig(draft), '设置已保存').then((ok) => {
      if (ok) closeDialog();
    });
  };

  const exportConfig = async () => {
    try {
      const data = await api.exportConfig();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ice-client-config.json';
      anchor.click();
      URL.revokeObjectURL(url);
      toast('配置已导出');
    } catch (error) {
      toast((error as Error).message, 'err');
    }
  };

  const importConfig = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      await api.importConfig(data);
      toast('配置已导入，正在重连模块');
      await refresh();
    } catch (error) {
      toast(`导入失败：${(error as Error).message}`, 'err');
    }
  };

  return (
    <div className="overlay" onClick={closeDialog}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <span className="dialog-title">全局设置</span>
          <span className="tag">v{snapshot?.version ?? '—'}</span>
          <span className="grow" />
          <button type="button" className="icon-btn" onClick={closeDialog} title="关闭">
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="form-section">
            <div className="section-title">连接与上报</div>
            <div className="row wrap" style={{ marginBottom: 10 }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.registration}
                  onChange={(event) => update('registration', event.target.checked)}
                />
                连接后发送 0x05 上线注册（FF FF）
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.hourlyBundle}
                  onChange={(event) => update('hourlyBundle', event.target.checked)}
                />
                整点历史整包（0x10 + 0x20）
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.alignHourly}
                  onChange={(event) => update('alignHourly', event.target.checked)}
                />
                对齐整点 :00:05
              </label>
            </div>
            <div className="field-grid">
              {numberField('stateIntervalSec', '0x10 周期（秒）', 5, 3600)}
              {numberField('powerIntervalSec', '整包 / 0x20 周期（秒）', 60, 86400)}
              {numberField('envIntervalSec', '0x30 周期（秒）', 60, 3600)}
            </div>
            <label className="check" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={draft.envReport}
                onChange={(event) => update('envReport', event.target.checked)}
              />
              上报 0x30 环境状态（实测本平台收到后会断开连接）
            </label>
          </div>

          <div className="form-section">
            <div className="section-title">指令响应</div>
            <div className="row wrap" style={{ marginBottom: 10 }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.autoMode}
                  onChange={(event) => update('autoMode', event.target.checked)}
                />
                自动模式：平台指令延时后自动到位
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.autoParallel}
                  onChange={(event) => update('autoParallel', event.target.checked)}
                />
                并行执行（否则串行）
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.autoReconnect}
                  onChange={(event) => update('autoReconnect', event.target.checked)}
                />
                断线自动重连（退避 0.8s → 30s）
              </label>
            </div>
            <div className="field-grid">
              {numberField('autoDelaySec', '自动到位延时（秒）', 0, 600)}
            </div>
          </div>

          <div className="form-section">
            <div className="section-title">状态上报模拟值</div>
            <div className="seg-line" style={{ marginBottom: 10 }}>
              {(['remote', 'local'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={`seg-option${draft.controlMode === value ? ' on' : ''}`}
                  onClick={() => update('controlMode', value)}
                >
                  <b>{value === 'remote' ? '远程控制' : '本地控制'}</b>
                  <span>0x10 Byte1 b2（1 = 本地）</span>
                </button>
              ))}
            </div>
            <div className="row wrap">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.linkType === 'fiber'}
                  onChange={(event) => update('linkType', event.target.checked ? 'fiber' : '4g')}
                />
                光纤链路（MG500 0x10 Byte0 b7）
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.networkError}
                  onChange={(event) => update('networkError', event.target.checked)}
                />
                置位网络错误（MG400 0x10 Byte0 b5）
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="section-title">塔视图动画</div>
            <div className="field-grid">
              {numberField('animSwitchSec', '接地 / 选相（秒）', 1, 120)}
              {numberField('animLockSec', '融冰锁（秒）', 1, 120)}
              {numberField('animIceSec', '融冰刀闸（秒）', 1, 120)}
            </div>
          </div>

          <div className="form-section">
            <div className="section-title">配置备份</div>
            <div className="row wrap">
              <button type="button" className="btn btn-sm" onClick={() => void exportConfig()}>
                <DownloadIcon size={12} />
                导出配置
              </button>
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <UploadIcon size={12} />
                导入配置
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void importConfig(file);
                }}
              />
              <span className="faint" style={{ fontSize: 10.5 }}>
                导入会替换当前全部模块与设置
              </span>
            </div>
          </div>
        </div>

        <div className="dialog-foot">
          <span className="faint" style={{ fontSize: 10.5 }}>
            配置保存在服务端 /data/config.json
          </span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
