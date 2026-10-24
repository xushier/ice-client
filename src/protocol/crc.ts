/** CRC-16/MODBUS：多项式 0xA001，初值 0xFFFF，从帧头开始计算 */
export function crc16(bytes: ArrayLike<number>, start = 0, end = bytes.length): number {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

/** CRC 低字节在前 */
export function crcBytes(crc: number): [number, number] {
  return [crc & 0xff, (crc >>> 8) & 0xff];
}
