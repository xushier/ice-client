export interface PowerFields {
  socPct: number;
  batteryVolt: number;
  loadVolt: number;
  loadCurrent: number;
  solarVolt: number;
  solarCurrent: number;
  chargeState: number;
  faultHigh: number;
  faultLow: number;
}

export interface EnvFields {
  temp: number | null;
  humidity: number | null;
  cell1Temp: number | null;
  cell2Temp: number | null;
  acState: number;
  acAlarmLow: number;
  acAlarm17: boolean;
  fireUsed: boolean;
}

function write16(out: number[], value: number): void {
  const v = Math.max(0, Math.min(0xffff, Math.round(value)));
  out.push((v >>> 8) & 0xff, v & 0xff);
}

function writeSigned16(out: number[], value: number): void {
  let v = Math.max(-0x8000, Math.min(0x7fff, Math.round(value)));
  if (v < 0) v += 0x10000;
  out.push((v >>> 8) & 0xff, v & 0xff);
}

function read16(data: ArrayLike<number>, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function readSigned16(data: ArrayLike<number>, offset: number): number {
  const raw = read16(data, offset);
  return raw >= 0x8000 ? raw - 0x10000 : raw;
}

export function encodePower(fields: PowerFields): Uint8Array {
  const out: number[] = [];
  write16(out, fields.socPct);
  write16(out, fields.batteryVolt * 10);
  write16(out, fields.loadVolt * 10);
  write16(out, fields.loadCurrent * 100);
  write16(out, fields.solarVolt * 10);
  write16(out, fields.solarCurrent * 100);
  write16(out, fields.chargeState);
  write16(out, fields.faultHigh);
  write16(out, fields.faultLow);
  return Uint8Array.from(out);
}

export function decodePower(data: ArrayLike<number>): PowerFields | null {
  if (data.length !== 18) return null;
  return {
    socPct: read16(data, 0),
    batteryVolt: read16(data, 2) / 10,
    loadVolt: read16(data, 4) / 10,
    loadCurrent: read16(data, 6) / 100,
    solarVolt: read16(data, 8) / 10,
    solarCurrent: read16(data, 10) / 100,
    chargeState: read16(data, 12),
    faultHigh: read16(data, 14),
    faultLow: read16(data, 16),
  };
}

export function encodeEnv(fields: EnvFields): Uint8Array {
  const out: number[] = [];
  if (fields.temp === null) out.push(0xff, 0xff);
  else writeSigned16(out, fields.temp * 10);
  write16(out, fields.humidity === null ? 0xffff : fields.humidity * 10);
  if (fields.cell1Temp === null) out.push(0xff, 0xff);
  else writeSigned16(out, fields.cell1Temp * 10);
  if (fields.cell2Temp === null) out.push(0xff, 0xff);
  else writeSigned16(out, fields.cell2Temp * 10);
  write16(out, fields.acState);
  write16(out, fields.acAlarmLow);
  out.push(fields.acAlarm17 ? 0x01 : 0x00);
  out.push(fields.fireUsed ? 0x01 : 0x00);
  out.push(0x00, 0x00);
  return Uint8Array.from(out);
}

export function decodeEnv(data: ArrayLike<number>): EnvFields | null {
  if (data.length !== 16) return null;
  const tempRaw = read16(data, 0);
  const humidityRaw = read16(data, 2);
  const cell1Raw = read16(data, 4);
  const cell2Raw = read16(data, 6);
  return {
    temp: tempRaw === 0xffff ? null : readSigned16(data, 0) / 10,
    humidity: humidityRaw === 0xffff ? null : humidityRaw / 10,
    cell1Temp: cell1Raw === 0xffff ? null : readSigned16(data, 4) / 10,
    cell2Temp: cell2Raw === 0xffff ? null : readSigned16(data, 6) / 10,
    acState: read16(data, 8),
    acAlarmLow: read16(data, 10),
    acAlarm17: ((data[12] ?? 0) & 0x01) !== 0,
    fireUsed: ((data[13] ?? 0) & 0x01) !== 0,
  };
}

export const AC_STATE_LABELS: Record<number, string> = {
  0: '未通电',
  1: '待机',
  2: '运行',
  3: '故障',
  0xffff: '数据异常',
};

export function acStateLabel(value: number): string {
  return AC_STATE_LABELS[value] ?? `状态 ${value}`;
}
