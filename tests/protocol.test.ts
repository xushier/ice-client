import { describe, expect, it } from 'vitest';
import {
  FrameParser,
  PROFILES,
  buildFrame,
  crc16,
  decodeCommand,
  decodeStatus,
  encodeCommand,
  encodeStatus,
  fromHex,
  parseFrame,
  presetStates,
  toHex,
} from '../src/protocol';
import { DEFAULT_TELEMETRY } from '../src/core/defaults';

const hex = (bytes: Uint8Array): string => toHex(bytes).replace(/ /g, '');

describe('CRC 与组帧', () => {
  it('现场活化开帧', () => {
    expect(hex(buildFrame(0x0001, 0x00, [0x00, 0x02]))).toBe('5A470500010000027224');
  });

  it('现场活化关帧（全零）', () => {
    expect(hex(buildFrame(0x0001, 0x00, [0x00, 0x00]))).toBe('5A47050001000000F3E5');
  });

  it('上线注册帧 CRC 与文档示例不同（文档示例错误）', () => {
    expect(hex(buildFrame(0x000c, 0x05, [0xff, 0xff]))).toBe('5A4705000C05FFFFE0F8');
  });

  it('CRC-16/MODBUS 已知向量', () => {
    expect(crc16(fromHex('5A47050001000002'))).toBe(0x2472);
  });

  it('长度字段 = 3 + 数据长度', () => {
    expect(buildFrame(13, 0x20, new Array(18).fill(0))[2]).toBe(21);
    expect(buildFrame(13, 0x30, new Array(16).fill(0))[2]).toBe(19);
    expect(buildFrame(13, 0x10, [0, 0])[2]).toBe(5);
  });
});

describe('流式解析', () => {
  it('粘包 + 噪声能同步', () => {
    const parser = new FrameParser();
    const a = buildFrame(13, 0x10, [0x0d, 0x2b]);
    const b = buildFrame(13, 0x05, [0xff, 0xff]);
    const chunk = new Uint8Array([0x00, 0x11, ...a, ...b]);
    const frames = parser.push(chunk);
    expect(frames).toHaveLength(2);
    expect(frames[0].type).toBe(0x10);
    expect(frames[1].type).toBe(0x05);
    expect(parser.pending).toBe(0);
  });

  it('半包先保留，补齐后解析', () => {
    const parser = new FrameParser();
    const frame = buildFrame(13, 0x20, new Array(18).fill(1));
    expect(parser.push(frame.slice(0, 7))).toHaveLength(0);
    expect(parser.pending).toBe(7);
    const rest = parser.push(frame.slice(7));
    expect(rest).toHaveLength(1);
    expect(rest[0].type).toBe(0x20);
    expect(rest[0].crcOk).toBe(true);
  });

  it('错误 CRC 仍上报但标记', () => {
    const frame = buildFrame(13, 0x10, [0, 0]);
    frame[frame.length - 1] ^= 0xff;
    const parsed = parseFrame(frame);
    expect(parsed?.crcOk).toBe(false);
  });
});

describe('MG400 位表', () => {
  it('状态帧默认态 + 电量档 = 0D 2B（与现场一致）', () => {
    const data = encodeStatus(
      'mg400',
      {
        ground1: 'closed',
        phase1: 'open',
        phase2: 'open',
        iceLock: 'locked',
        iceSwitch: 'open',
        activation: 'off',
      },
      { socPct: DEFAULT_TELEMETRY.socPct, controlMode: 'remote' },
    );
    expect(toHex(data)).toBe('0D 2B');
  });

  it('动作中（closing/opening）在 0x10 里两个方向位都为 0', () => {
    const data = encodeStatus('mg400', { iceSwitch: 'closing' });
    expect(data[0] & 0x18).toBe(0);
  });

  it('命令帧与状态帧位表不同', () => {
    expect(toHex(encodeCommand('mg400', [{ device: 'iceSwitch', action: 'close' }]))).toBe('08 00');
    expect(encodeStatus('mg400', { iceSwitch: 'closed' })[0]).toBe(0x10);
    expect(toHex(encodeCommand('mg400', [{ device: 'ground1', action: 'close' }]))).toBe('00 80');
    expect(encodeStatus('mg400', { ground1: 'closed' })[0]).toBe(0x01);
  });

  it('全零命令解析为电池活化关', () => {
    const actions = decodeCommand('mg400', [0, 0]);
    expect(actions).toHaveLength(1);
    expect(actions[0].device).toBe('activation');
    expect(actions[0].action).toBe('off');
  });

  it('解析动作命令', () => {
    const actions = decodeCommand('mg400', fromHex('0C00'));
    expect(actions.map((item) => item.action).sort()).toEqual(['close', 'open']);
    expect(actions.every((item) => item.conflict)).toBe(true);
  });

  it('状态解码回环', () => {
    const states = { ground1: 'open', phase1: 'closed', phase2: 'closed', iceLock: 'unlocked', iceSwitch: 'closed' } as const;
    const decoded = decodeStatus('mg400', encodeStatus('mg400', states, { socPct: 10 }));
    for (const [device, state] of Object.entries(states)) {
      expect(decoded.states[device as keyof typeof states]).toBe(state);
    }
    expect(decoded.batteryLevel).toBe(0);
  });

  it('预设状态包含选相刀闸', () => {
    const initial = presetStates(['phase1', 'phase2'], 'initial');
    expect(initial.phase1).toBe('open');
    expect(presetStates(['phase1'], 'ice').phase1).toBe('closed');
  });
});

describe('MG500 位表', () => {
  it('命令帧：接地2合在 Byte0 b7，选相3分在 Byte0 b4', () => {
    expect(toHex(encodeCommand('mg500', [{ device: 'ground2', action: 'close' }]))).toBe('80 00');
    expect(toHex(encodeCommand('mg500', [{ device: 'phase3', action: 'open' }]))).toBe('10 00');
    expect(toHex(encodeCommand('mg500', [{ device: 'ground1', action: 'open' }]))).toBe('00 40');
  });

  it('状态帧：接地2在 Byte0 b6/b5，选相3在 Byte1 b1/b0', () => {
    const data = encodeStatus('mg500', { ground2: 'closed', phase3: 'open' });
    expect(data[0] & 0x40).toBe(0x40);
    expect(data[1] & 0x03).toBe(0x01);
  });

  it('状态帧不与 MG400 备用位混用', () => {
    const mg400 = encodeStatus('mg400', { ground1: 'closed' });
    expect(mg400[0] & 0x40).toBe(0);
    const mg500 = encodeStatus('mg500', { ground1: 'closed' });
    expect(mg500[0] & 0x40).toBe(0);
    expect(mg500[0] & 0x01).toBe(0x01);
  });

  it('MG500 没有电池电量档，也没有活化指令', () => {
    const data = encodeStatus('mg500', { ground1: 'closed' }, { socPct: 90 });
    expect(data[1] & 0x03).toBe(0);
    expect(decodeCommand('mg500', [0, 0])).toEqual([]);
    expect(PROFILES.mg500.devices).not.toContain('activation');
  });

  it('通信链路 / 控制模式 / 状态回环', () => {
    const data = encodeStatus('mg500', { ground2: 'open', iceLock: 'locked' }, { linkType: 'fiber', controlMode: 'local' });
    const decoded = decodeStatus('mg500', data);
    expect(decoded.linkType).toBe('fiber');
    expect(decoded.controlMode).toBe('local');
    expect(decoded.states.ground2).toBe('open');
    expect(decoded.states.iceLock).toBe('locked');
  });
});
