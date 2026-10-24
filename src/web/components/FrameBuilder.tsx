import { useEffect, useMemo, useState } from 'react';
import type { EnvFields, PowerFields } from '../../protocol';
import {
  PROFILES,
  buildFrame,
  describeFrame,
  encodeCommand,
  encodeEnv,
  encodePower,
  encodeStatus,
  fromHex,
  parseFrame,
  toHex,
  typeName,
} from '../../protocol';
import type { DeviceAction, DeviceKind, DeviceState } from '../../protocol/types';
import { api } from '../api';
import { useAction } from '../lib/actions';
import { useUi } from '../store';
import { CloseIcon, SendIcon } from './icons';

type Tab = 'cmd' | 'status' | 'power' | 'env' | 'ac' | 'raw';

const TABS: Array<{ key: Tab; label: string; type: number }> = [
  { key: 'cmd', label: '动作命令 0x00', type: 0x00 },
  { key: 'status', label: 'DI 状态 0x10', type: 0x10 },
  { key: 'power', label: '直流供电 0x20', type: 0x20 },
  { key: 'env', label: '环境状态 0x30', type: 0x30 },
  { key: 'ac', label: '空调命令 0x02', type: 0x02 },
  { key: 'raw', label: '整帧 Hex', type: 0 },
];

function bitKey(byte: number, bit: number): string {
  return `${byte}-${bit}`;
}

export function FrameBuilder({ initialModuleId }: { initialModuleId?: number }) {
  const snapshot = useUi((state) => state.snapshot);
  const activeId = useUi((state) => state.activeId);
  const closeDialog = useUi((state) => state.closeDialog);
  const { busy, run } = useAction();

  const modules = snapshot?.modules ?? [];
  const [targetId, setTargetId] = useState<number | null>(initialModuleId ?? activeId ?? modules[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>('cmd');
  const [commandBits, setCommandBits] = useState<Set<string>>(() => new Set());
  const [statusBits, setStatusBits] = useState<Set<string>>(() => new Set());
  const [statusExtra, setStatusExtra] = useState({
    networkError: false,
    local: false,
    fiber: false,
    batteryLevel: 3,
  });
  const [power, setPower] = useState<PowerFields | null>(null);
  const [env, setEnv] = useState<EnvFields | null>(null);
  const [acCommand, setAcCommand] = useState<'on' | 'off'>('on');
  const [rawHex, setRawHex] = useState('');

  const module = modules.find((item) => item.id === targetId) ?? modules[0];
  const protocol = module?.protocol ?? 'mg500';
  const profile = PROFILES[protocol];

  useEffect(() => {
    if (!module) return;
    setPower({
      socPct: module.telemetry.socPct,
      batteryVolt: module.telemetry.batteryVolt,
      loadVolt: module.telemetry.loadVolt,
      loadCurrent: module.telemetry.loadCurrent,
      solarVolt: module.telemetry.solarVolt,
      solarCurrent: module.telemetry.solarCurrent,
      chargeState: module.telemetry.chargeState,
      faultHigh: module.telemetry.faultHigh,
      faultLow: module.telemetry.faultLow,
    });
    setEnv({
      temp: module.telemetry.envTemp,
      humidity: module.telemetry.envHumidity,
      cell1Temp: module.telemetry.cell1Temp,
      cell2Temp: module.telemetry.cell2Temp,
      acState: module.telemetry.acState,
      acAlarmLow: module.telemetry.acAlarmLow,
      acAlarm17: module.telemetry.acAlarm17,
      fireUsed: module.telemetry.fireUsed,
    });
  }, [module?.id]);

  useEffect(() => {
    setCommandBits(new Set());
    setStatusBits(new Set());
  }, [protocol]);

  const type = TABS.find((item) => item.key === tab)?.type ?? 0x00;

  const built = useMemo(() => {
    let data: number[] = [];
    let summary: { title: string; lines: string[] } = { title: typeName(type), lines: [] };
    if (tab === 'cmd') {
      const actions: Array<{ device: DeviceKind; action: DeviceAction }> = [];
      for (const bit of profile.commandBits) {
        if (commandBits.has(bitKey(bit.byte, bit.bit))) actions.push({ device: bit.device, action: bit.action });
      }
      data = [...encodeCommand(protocol, actions)];
      summary = describeFrame(0x00, data, protocol);
    } else if (tab === 'status') {
      const states: Partial<Record<DeviceKind, DeviceState>> = {};
      for (const bit of profile.statusBits) {
        if (statusBits.has(bitKey(bit.byte, bit.bit))) states[bit.device] = bit.state;
      }
      data = [
        ...encodeStatus(protocol, states, {
          networkError: statusExtra.networkError,
          controlMode: statusExtra.local ? 'local' : 'remote',
          linkType: statusExtra.fiber ? 'fiber' : '4g',
          socPct: profile.extras.battery ? statusExtra.batteryLevel * 25 : undefined,
        }),
      ];
      summary = describeFrame(0x10, data, protocol);
    } else if (tab === 'power') {
      data = power ? [...encodePower(power)] : [];
      summary = describeFrame(0x20, data, protocol);
    } else if (tab === 'env') {
      data = env ? [...encodeEnv(env)] : [];
      summary = describeFrame(0x30, data, protocol);
    } else if (tab === 'ac') {
      data = [acCommand === 'on' ? 1 : 0];
      summary = describeFrame(0x02, data, protocol);
    }
    const bytes = module && tab !== 'raw' ? buildFrame(module.id, type, data) : null;
    return { data, bytes, summary };
  }, [tab, protocol, profile, commandBits, statusBits, statusExtra, power, env, acCommand, module?.id, type]);

  const rawParsed = useMemo(() => {
    if (tab !== 'raw' || !rawHex.trim()) return { bytes: null as Uint8Array | null, error: null as string | null };
    try {
      const bytes = fromHex(rawHex);
      if (bytes.length < 8) return { bytes, error: '整帧至少 8 字节' };
      const parsed = parseFrame(bytes);
      if (!parsed) return { bytes, error: '帧头 / 长度 / 结构不匹配' };
      return { bytes, error: parsed.crcOk ? null : 'CRC 校验不通过（仍可发送）' };
    } catch (error) {
      return { bytes: null as Uint8Array | null, error: (error as Error).message };
    }
  }, [tab, rawHex]);

  const toggle = (setter: typeof setCommandBits, key: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const send = () => {
    if (!module) return;
    if (tab === 'raw') {
      void run(() => api.sendFrame(module.id, { hex: rawHex }), '整帧已发送');
      return;
    }
    void run(() => api.sendFrame(module.id, { type, data: built.data }), `0x${type.toString(16).padStart(2, '0').toUpperCase()} 已发送`);
  };

  const online = module?.runtime.link === 'online';
  const bitsFor = (byte: 0 | 1) => profile.commandBits.filter((bit) => bit.byte === byte);
  const statusFor = (byte: 0 | 1) => profile.statusBits.filter((bit) => bit.byte === byte);

  return (
    <div className="overlay" onClick={closeDialog}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <span className="dialog-title">帧构造器</span>
          {module ? (
            <span className="tag">
              #{module.id} · {module.protocol.toUpperCase()}
            </span>
          ) : null}
          <span className="grow" />
          <button type="button" className="icon-btn" onClick={closeDialog} title="关闭">
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="row wrap" style={{ marginBottom: 12 }}>
            <div className="field" style={{ minWidth: 220 }}>
              <label>目标模块</label>
              <select
                className="select"
                value={module?.id ?? ''}
                onChange={(event) => setTargetId(Number(event.target.value))}
              >
                {modules.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.towerName} · #{item.id} · {item.protocol.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 140 }}>
              <label>连接状态</label>
              <div className="row" style={{ height: 30 }}>
                <span className={`pill ${online ? 'pill-online' : 'pill-offline'}`}>
                  {online ? '在线' : '离线'}
                </span>
                {!online ? <span className="faint" style={{ fontSize: 10.5 }}>需先连接</span> : null}
              </div>
            </div>
          </div>

          <div className="tabs">
            {TABS.map((item) => (
              <button
                type="button"
                key={item.key}
                className={tab === item.key ? 'on' : ''}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'cmd' ? (
            <>
              <div className="section-title">勾选动作位（全不选 = 数据区 00 00，MG400 表示活化关）</div>
              <div className="bit-table">
                {([0, 1] as const).map((byte) => (
                  <div className="bit-byte" key={byte}>
                    <div className="bit-byte-head">
                      Byte {byte} · {byte === 0 ? '高字节先发' : '低字节'}
                    </div>
                    {bitsFor(byte).map((bit) => (
                      <label className="bit-line" key={bitKey(byte, bit.bit)}>
                        <input
                          type="checkbox"
                          checked={commandBits.has(bitKey(byte, bit.bit))}
                          onChange={() => toggle(setCommandBits, bitKey(byte, bit.bit))}
                        />
                        <span className="bit-index">b{bit.bit}</span>
                        <span className="bit-label">
                          {bit.label} <span className="faint">({bit.code})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {tab === 'status' ? (
            <>
              <div className="section-title">勾选状态位</div>
              <div className="bit-table">
                {([0, 1] as const).map((byte) => (
                  <div className="bit-byte" key={byte}>
                    <div className="bit-byte-head">
                      Byte {byte} · {byte === 0 ? '高字节先发' : '低字节'}
                    </div>
                    {statusFor(byte).map((bit) => (
                      <label className="bit-line" key={bitKey(byte, bit.bit)}>
                        <input
                          type="checkbox"
                          checked={statusBits.has(bitKey(byte, bit.bit))}
                          onChange={() => toggle(setStatusBits, bitKey(byte, bit.bit))}
                        />
                        <span className="bit-index">b{bit.bit}</span>
                        <span className="bit-label">{bit.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <div className="row wrap" style={{ marginTop: 10 }}>
                {profile.extras.networkError ? (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={statusExtra.networkError}
                      onChange={(event) => setStatusExtra((prev) => ({ ...prev, networkError: event.target.checked }))}
                    />
                    网络错误
                  </label>
                ) : null}
                {profile.extras.controlMode ? (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={statusExtra.local}
                      onChange={(event) => setStatusExtra((prev) => ({ ...prev, local: event.target.checked }))}
                    />
                    本地控制
                  </label>
                ) : null}
                {profile.extras.linkFiber ? (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={statusExtra.fiber}
                      onChange={(event) => setStatusExtra((prev) => ({ ...prev, fiber: event.target.checked }))}
                    />
                    光纤链路
                  </label>
                ) : null}
                {profile.extras.battery ? (
                  <div className="row">
                    <span className="faint" style={{ fontSize: 11 }}>
                      电量档
                    </span>
                    <select
                      className="select"
                      style={{ width: 96 }}
                      value={statusExtra.batteryLevel}
                      onChange={(event) =>
                        setStatusExtra((prev) => ({ ...prev, batteryLevel: Number(event.target.value) }))
                      }
                    >
                      {[0, 1, 2, 3].map((level) => (
                        <option key={level} value={level}>
                          {level} ({level * 25}%)
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {tab === 'power' && power ? (
            <>
              <div className="section-title">直流供电字段（0x20，18 字节）</div>
              <div className="field-grid">
                {(
                  [
                    ['socPct', '电量 %', 1],
                    ['batteryVolt', '电池电压 V', 0.1],
                    ['loadVolt', '负载电压 V', 0.1],
                    ['loadCurrent', '负载电流 A', 0.01],
                    ['solarVolt', '光伏电压 V', 0.1],
                    ['solarCurrent', '光伏电流 A', 0.01],
                    ['chargeState', '负载/充电状态', 1],
                    ['faultHigh', '故障高 16 位', 1],
                    ['faultLow', '故障低 16 位', 1],
                  ] as Array<[keyof PowerFields, string, number]>
                ).map(([key, label, step]) => (
                  <div className="field" key={key}>
                    <label>{label}</label>
                    <input
                      className="input"
                      type="number"
                      step={step}
                      value={power[key]}
                      onChange={(event) =>
                        setPower((prev) => (prev ? { ...prev, [key]: Number(event.target.value) } : prev))
                      }
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {tab === 'env' && env ? (
            <>
              <div className="section-title">环境字段（0x30，16 字节，留空按 0xFFFF 异常上报）</div>
              <div className="field-grid">
                {(
                  [
                    ['temp', '机柜温度 ℃', 0.1],
                    ['humidity', '机柜湿度 %', 0.1],
                    ['cell1Temp', '电池舱 1 温度 ℃', 0.1],
                    ['cell2Temp', '电池舱 2 温度 ℃', 0.1],
                    ['acState', '空调状态 0~3', 1],
                    ['acAlarmLow', '空调告警 1~16', 1],
                  ] as Array<[keyof EnvFields, string, number]>
                ).map(([key, label, step]) => {
                  const value = env[key];
                  if (typeof value === 'boolean' || value === undefined) return null;
                  return (
                    <div className="field" key={key}>
                      <label>{label}</label>
                      <input
                        className="input"
                        type="number"
                        step={step}
                        value={value === null ? '' : value}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setEnv((prev) =>
                            prev
                              ? { ...prev, [key]: raw === '' ? null : Number(raw) }
                              : prev,
                          );
                        }}
                      />
                    </div>
                  );
                })}
                <div className="field">
                  <label>告警 17</label>
                  <label className="check" style={{ height: 30 }}>
                    <input
                      type="checkbox"
                      checked={env.acAlarm17}
                      onChange={(event) => setEnv((prev) => (prev ? { ...prev, acAlarm17: event.target.checked } : prev))}
                    />
                    已触发
                  </label>
                </div>
                <div className="field">
                  <label>灭火装置</label>
                  <label className="check" style={{ height: 30 }}>
                    <input
                      type="checkbox"
                      checked={env.fireUsed}
                      onChange={(event) => setEnv((prev) => (prev ? { ...prev, fireUsed: event.target.checked } : prev))}
                    />
                    已使用
                  </label>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'ac' ? (
            <>
              <div className="section-title">空调命令（0x02，数据 1 字节）</div>
              <div className="seg-line">
                {(['on', 'off'] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={`seg-option${acCommand === value ? ' on' : ''}`}
                    onClick={() => setAcCommand(value)}
                  >
                    <b>{value === 'on' ? '打开空调 (01)' : '关闭空调 (00)'}</b>
                    <span>平台下发 0x02 后终端回 0x03 响应</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {tab === 'raw' ? (
            <>
              <div className="section-title">直接发送整帧 Hex（含帧头与 CRC）</div>
              <textarea
                className="textarea"
                value={rawHex}
                spellCheck={false}
                placeholder="例如：5A 47 05 00 0D 00 00 02 72 24"
                onChange={(event) => setRawHex(event.target.value)}
              />
              {rawParsed.error ? (
                <div className="error-strip" style={{ margin: '8px 0 0' }}>
                  {rawParsed.error}
                </div>
              ) : null}
            </>
          ) : null}

          {tab !== 'raw' ? (
            <div className="preview">
              <div className="preview-hex">{built.bytes ? toHex(built.bytes) : '—'}</div>
              <div className="preview-sum">
                {built.summary.title} · {built.summary.lines.join(' · ') || '无数据'}
              </div>
            </div>
          ) : (
            <div className="preview">
              <div className="preview-hex">{rawParsed.bytes ? toHex(rawParsed.bytes) : '—'}</div>
              <div className="preview-sum">
                {rawParsed.bytes ? `${rawParsed.bytes.length} 字节` : '等待输入'}
                {rawParsed.bytes && rawParsed.bytes.length >= 8
                  ? ` · CRC ${rawParsed.error ? '异常' : '通过'}`
                  : ''}
              </div>
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <span className="faint" style={{ fontSize: 11 }}>
            {module
              ? online
                ? `将以模块 #${module.id} 的会话发送`
                : '模块当前离线，发送前请先连接'
              : '请先新建模块'}
          </span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={closeDialog}>
            关闭
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy || !module || !online || (tab === 'raw' && (!rawHex.trim() || rawParsed.bytes === null))}
            onClick={send}
          >
            <SendIcon size={12} />
            发送帧
          </button>
        </div>
      </div>
    </div>
  );
}
