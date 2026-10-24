import { crc16 } from './crc';

export const MAX_DATA_LEN = 64;

export interface ParsedFrame {
  id: number;
  type: number;
  data: Uint8Array;
  raw: Uint8Array;
  crcOk: boolean;
}

/** 组帧：5A 47 | 长度(3+数据长) | ID 高/低 | 类型 | 数据 | CRC 低/高 */
export function buildFrame(id: number, type: number, data: ArrayLike<number> = []): Uint8Array {
  const len = 3 + data.length;
  const out = new Uint8Array(5 + len);
  out[0] = 0x5a;
  out[1] = 0x47;
  out[2] = len;
  out[3] = (id >> 8) & 0x0f;
  out[4] = id & 0xff;
  out[5] = type & 0xff;
  for (let i = 0; i < data.length; i++) out[6 + i] = data[i] & 0xff;
  const crc = crc16(out, 0, out.length - 2);
  out[out.length - 2] = crc & 0xff;
  out[out.length - 1] = (crc >>> 8) & 0xff;
  return out;
}

export function parseFrame(raw: Uint8Array): ParsedFrame | null {
  if (raw.length < 8) return null;
  if (raw[0] !== 0x5a || raw[1] !== 0x47) return null;
  const len = raw[2];
  if (len < 3 || len > 3 + MAX_DATA_LEN) return null;
  if (raw.length !== 5 + len) return null;
  const crcOk = crc16(raw, 0, raw.length - 2) === ((raw[raw.length - 1] << 8) | raw[raw.length - 2]);
  return {
    id: ((raw[3] & 0x0f) << 8) | raw[4],
    type: raw[5],
    data: raw.slice(6, 3 + len),
    raw,
    crcOk,
  };
}

/** 流式解析：处理粘包、半包与噪声 */
export class FrameParser {
  private buf: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): ParsedFrame[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    const frames: ParsedFrame[] = [];

    let offset = 0;
    while (this.buf.length - offset >= 2) {
      let start = -1;
      for (let i = offset; i < this.buf.length - 1; i++) {
        if (this.buf[i] === 0x5a && this.buf[i + 1] === 0x47) {
          start = i;
          break;
        }
      }
      if (start < 0) {
        // 保留尾部可能作为帧头首字节的 0x5A
        offset = this.buf[this.buf.length - 1] === 0x5a ? this.buf.length - 1 : this.buf.length;
        break;
      }
      if (start > offset) offset = start;
      if (this.buf.length - offset < 3) break;
      const len = this.buf[offset + 2];
      if (len < 3 || len > 3 + MAX_DATA_LEN) {
        offset += 1;
        continue;
      }
      const total = 5 + len;
      if (this.buf.length - offset < total) break;
      const raw = this.buf.slice(offset, offset + total);
      const frame = parseFrame(raw);
      if (frame) {
        // 现场平台不校验 CRC，但错误 CRC 仍上报，便于帧监视发现噪声
        frames.push(frame);
        offset += total;
      } else {
        offset += 1;
      }
    }

    this.buf = this.buf.slice(offset);
    return frames;
  }

  reset(): void {
    this.buf = new Uint8Array(0);
  }

  get pending(): number {
    return this.buf.length;
  }
}

export function toHex(bytes: ArrayLike<number>): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) parts.push(bytes[i].toString(16).padStart(2, '0').toUpperCase());
  return parts.join(' ');
}

export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('hex 长度必须为偶数');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('hex 含非法字符');
    out[i] = byte;
  }
  return out;
}

export const FRAME_TYPE_NAMES: Record<number, string> = {
  0x00: '动作命令',
  0x01: '命令响应',
  0x02: '空调命令',
  0x03: '空调响应',
  0x05: '上线注册',
  0x10: 'DI 状态',
  0x11: '心跳应答',
  0x20: '直流供电',
  0x21: '供电应答',
  0x30: '环境状态',
  0x31: '环境应答',
};

export function typeName(type: number): string {
  return FRAME_TYPE_NAMES[type] ?? `未知 0x${type.toString(16).padStart(2, '0').toUpperCase()}`;
}
