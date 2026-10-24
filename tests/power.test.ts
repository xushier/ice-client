import { describe, expect, it } from 'vitest';
import { decodeEnv, decodePower, encodeEnv, encodePower } from '../src/protocol';

describe('0x20 直流供电', () => {
  it('字段按 16 位无符号数高字节先发编码', () => {
    const data = encodePower({
      socPct: 86,
      batteryVolt: 53.2,
      loadVolt: 48.1,
      loadCurrent: 1.25,
      solarVolt: 71.5,
      solarCurrent: 2.4,
      chargeState: 0,
      faultHigh: 0,
      faultLow: 0,
    });
    expect(data).toHaveLength(18);
    expect(Array.from(data.slice(0, 12))).toEqual([0x00, 0x56, 0x02, 0x14, 0x01, 0xe1, 0x00, 0x7d, 0x02, 0xcb, 0x00, 0xf0]);
  });

  it('编码解码回环（保留 0.1V / 0.01A 精度）', () => {
    const fields = {
      socPct: 100,
      batteryVolt: 54.3,
      loadVolt: 48.7,
      loadCurrent: 0.42,
      solarVolt: 70.1,
      solarCurrent: 3.05,
      chargeState: 0x1234,
      faultHigh: 0xabcd,
      faultLow: 0x0f0f,
    };
    expect(decodePower(encodePower(fields))).toEqual(fields);
  });

  it('长度错误返回 null', () => {
    expect(decodePower([0, 1])).toBeNull();
  });
});

describe('0x30 环境状态', () => {
  it('温度湿度按 0.1 精度编码', () => {
    const data = encodeEnv({
      temp: 26.5,
      humidity: 55,
      cell1Temp: 24,
      cell2Temp: 25,
      acState: 2,
      acAlarmLow: 0,
      acAlarm17: false,
      fireUsed: false,
    });
    expect(data).toHaveLength(16);
    expect(Array.from(data.slice(0, 16))).toEqual([
      0x01, 0x09, 0x02, 0x26, 0x00, 0xf0, 0x00, 0xfa, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
  });

  it('负温度用有符号 int16', () => {
    const data = encodeEnv({
      temp: -5,
      humidity: null,
      cell1Temp: null,
      cell2Temp: null,
      acState: 0xffff,
      acAlarmLow: 0xffff,
      acAlarm17: true,
      fireUsed: true,
    });
    expect(Array.from(data.slice(0, 4))).toEqual([0xff, 0xce, 0xff, 0xff]);
    const decoded = decodeEnv(data);
    expect(decoded?.temp).toBe(-5);
    expect(decoded?.humidity).toBeNull();
    expect(decoded?.acState).toBe(0xffff);
    expect(decoded?.acAlarm17).toBe(true);
    expect(decoded?.fireUsed).toBe(true);
  });

  it('长度错误返回 null', () => {
    expect(decodeEnv([0, 1, 2])).toBeNull();
  });
});
