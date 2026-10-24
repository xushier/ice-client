import { typeName } from './frame';
import { decodeEnv, decodePower, acStateLabel } from './power';
import { decodeCommand, decodeStatus, stateLabel, DEVICE_META } from './profiles';
import type { DeviceKind, ProtocolId } from './types';

export interface FrameSummary {
  title: string;
  lines: string[];
}

export function describeFrame(type: number, data: ArrayLike<number>, protocol: ProtocolId): FrameSummary {
  switch (type) {
    case 0x00: {
      const actions = decodeCommand(protocol, data);
      if (actions.length === 0) return { title: '动作命令', lines: ['全零：停止'] };
      return {
        title: '动作命令',
        lines: actions.map((a) => `${a.conflict ? '冲突 ' : ''}${a.label}（${a.code}）`),
      };
    }
    case 0x01:
      return { title: '命令响应', lines: ['主控执行响应 0x00'] };
    case 0x02:
      return { title: '空调命令', lines: [data[0] === 1 ? '打开空调' : '关闭空调'] };
    case 0x03:
      return { title: '空调响应', lines: ['主控空调命令响应'] };
    case 0x05:
      return { title: '上线注册', lines: ['终端注册帧（协议未定义，可关闭）'] };
    case 0x10: {
      const decoded = decodeStatus(protocol, data);
      const lines: string[] = [];
      for (const [device, state] of Object.entries(decoded.states)) {
        lines.push(`${DEVICE_META[device as DeviceKind].label}：${stateLabel(device as DeviceKind, state)}`);
      }
      if (decoded.networkError) lines.push('网络错误');
      if (decoded.controlMode) lines.push(`控制模式：${decoded.controlMode === 'local' ? '本地' : '远程'}`);
      if (decoded.linkType) lines.push(`通信链路：${decoded.linkType === 'fiber' ? '光纤' : '4G'}`);
      if (decoded.batteryLevel !== undefined) lines.push(`电量档：${decoded.batteryLevel}/3`);
      return { title: 'DI 状态', lines: lines.length ? lines : ['无置位'] };
    }
    case 0x11:
      return { title: '心跳应答', lines: ['平台心跳'] };
    case 0x20: {
      const p = decodePower(data);
      if (!p) return { title: '直流供电', lines: ['数据长度异常'] };
      return {
        title: '直流供电',
        lines: [
          `电量 ${p.socPct}% · 电池 ${p.batteryVolt.toFixed(1)}V`,
          `负载 ${p.loadVolt.toFixed(1)}V / ${p.loadCurrent.toFixed(2)}A`,
          `光伏 ${p.solarVolt.toFixed(1)}V / ${p.solarCurrent.toFixed(2)}A`,
        ],
      };
    }
    case 0x21:
      return { title: '供电应答', lines: ['平台已响应直流供电帧'] };
    case 0x30: {
      const e = decodeEnv(data);
      if (!e) return { title: '环境状态', lines: ['数据长度异常'] };
      return {
        title: '环境状态',
        lines: [
          `机柜 ${e.temp === null ? '异常' : `${e.temp.toFixed(1)}℃`} / ${e.humidity === null ? '异常' : `${e.humidity.toFixed(1)}%RH`}`,
          `电池舱 ${e.cell1Temp === null ? '异常' : `${e.cell1Temp.toFixed(1)}℃`} / ${e.cell2Temp === null ? '异常' : `${e.cell2Temp.toFixed(1)}℃`}`,
          `空调 ${acStateLabel(e.acState)}${e.fireUsed ? ' · 灭火已用' : ''}`,
        ],
      };
    }
    case 0x31:
      return { title: '环境应答', lines: ['平台已响应环境帧'] };
    default:
      return { title: typeName(type), lines: [] };
  }
}
