import { useState } from 'react';
import type { FrameLog } from '../../core/types';
import { describeFrame, fromHex, parseFrame, typeName } from '../../protocol';
import { copyText } from '../lib/clipboard';
import { clock } from '../lib/format';
import { useUi } from '../store';
import { CloseIcon, CopyIcon, PauseIcon, PlayIcon, TrashIcon } from './icons';

function detailLines(frame: FrameLog, protocol: 'mg400' | 'mg500'): string[] {
  try {
    const parsed = parseFrame(fromHex(frame.hex));
    if (!parsed) return ['无法解析帧结构'];
    return describeFrame(parsed.type, parsed.data, protocol).lines;
  } catch {
    return ['无法解析帧结构'];
  }
}

export function FrameMonitor() {
  const snapshot = useUi((state) => state.snapshot);
  const frames = useUi((state) => state.frames);
  const framesPaused = useUi((state) => state.framesPaused);
  const activeId = useUi((state) => state.activeId);
  const monitorOpen = useUi((state) => state.monitorOpen);
  const toggleMonitor = useUi((state) => state.toggleMonitor);
  const togglePause = useUi((state) => state.togglePause);
  const setActiveId = useUi((state) => state.setActiveId);
  const setFrames = useUi((state) => state.setFrames);
  const toast = useUi((state) => state.toast);

  const [dir, setDir] = useState<'all' | 'tx' | 'rx'>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (!monitorOpen) return null;

  const modules = snapshot?.modules ?? [];
  const module = modules.find((item) => item.id === activeId) ?? modules[0];
  const list = module ? frames[module.id] ?? [] : [];
  const filtered = list.filter((frame) => dir === 'all' || frame.dir === dir).slice(-200).reverse();

  const copy = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? '帧内容已复制' : '复制失败，请手动选择文本', ok ? 'ok' : 'err');
  };

  return (
    <aside className="monitor">
      <div className="monitor-head">
        <span className="monitor-title">
          帧监视
          {module ? <span className="faint" style={{ fontWeight: 500 }}>· {module.towerName}</span> : null}
          <span className="counter">
            <b>{filtered.length}</b>
          </span>
        </span>
        <button
          type="button"
          className={`icon-btn${framesPaused ? ' danger' : ''}`}
          title={framesPaused ? '恢复接收' : '暂停接收'}
          onClick={togglePause}
        >
          {framesPaused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          title="清空当前模块的本地帧"
          disabled={!module}
          onClick={() => {
            if (module) setFrames(module.id, []);
            setOpenKey(null);
          }}
        >
          <TrashIcon size={13} />
        </button>
        <button type="button" className="icon-btn" title="关闭帧监视" onClick={toggleMonitor}>
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="monitor-tools">
        <select
          className="select"
          value={module?.id ?? ''}
          onChange={(event) => setActiveId(Number(event.target.value))}
          style={{ flex: 1 }}
        >
          {modules.map((item) => (
            <option key={item.id} value={item.id}>
              {item.towerName} · #{item.id}
            </option>
          ))}
        </select>
        <select className="select" value={dir} onChange={(event) => setDir(event.target.value as 'all' | 'tx' | 'rx')} style={{ width: 92 }}>
          <option value="all">全部方向</option>
          <option value="tx">上行 TX</option>
          <option value="rx">下行 RX</option>
        </select>
      </div>

      <div className="frame-list">
        {filtered.length === 0 ? (
          <div className="faint" style={{ padding: 14, textAlign: 'center', fontSize: 11 }}>
            {module ? '暂无帧记录' : '请先新建模块'}
          </div>
        ) : null}
        {filtered.map((frame, index) => {
          const key = `${frame.at}-${index}-${frame.hex}`;
          const open = openKey === key;
          return (
            <div className={`frame-row${open ? ' open' : ''}`} key={key}>
              <button
                type="button"
                className="frame-sum"
                onClick={() => setOpenKey(open ? null : key)}
                title="展开查看解析"
              >
                <span className={`dir ${frame.dir}`}>{frame.dir === 'tx' ? 'TX' : 'RX'}</span>
                <span className="frame-type">{typeName(frame.type)}</span>
                {!frame.crcOk ? <span className="bad-crc">CRC</span> : null}
                <span className="frame-hex">{frame.hex}</span>
                <span className="frame-time">{clock(frame.at).slice(-8)}</span>
              </button>
              {open ? (
                <div className="frame-detail">
                  <div className="kv">
                    长度 <b>{frame.hex.split(' ').length}</b> · 模块 ID <b>{frame.id}</b> · 类型{' '}
                    <b>0x{frame.type.toString(16).padStart(2, '0').toUpperCase()}</b> · CRC{' '}
                    <b style={{ color: frame.crcOk ? 'var(--ok)' : 'var(--danger)' }}>{frame.crcOk ? '通过' : '错误'}</b>
                  </div>
                  {detailLines(frame, module?.protocol ?? 'mg500').map((line, lineIndex) => (
                    <div key={lineIndex}>{line}</div>
                  ))}
                  {frame.error ? <div style={{ color: 'var(--danger-soft)' }}>{frame.error}</div> : null}
                  <code>{frame.hex}</code>
                  <button type="button" className="btn btn-sm" style={{ marginTop: 5 }} onClick={() => void copy(frame.hex)}>
                    <CopyIcon size={11} />
                    复制整帧
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="monitor-foot">
        <div>
          <b>帧结构</b> <code>5A 47</code> · LEN = 3 + 数据长 · ID 12bit（b0 大小号侧）· TYPE · DATA · CRC16
        </div>
        <div>
          最近状态 <b>{module ? `${module.runtime.rx} 收 / ${module.runtime.tx} 发` : '—'}</b>
          {framesPaused ? <span style={{ color: 'var(--warn)' }}> · 已暂停</span> : null}
        </div>
      </div>
    </aside>
  );
}
