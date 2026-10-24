export type ProtocolId = 'mg400' | 'mg500';

export type DeviceKind =
  | 'ground1'
  | 'ground2'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'iceSwitch'
  | 'iceLock'
  | 'activation';

export type DeviceState =
  | 'open'
  | 'closed'
  | 'opening'
  | 'closing'
  | 'locked'
  | 'unlocked'
  | 'locking'
  | 'unlocking'
  | 'on'
  | 'off';

export type DeviceAction = 'close' | 'open' | 'lock' | 'unlock' | 'on' | 'off';

export type ControlMode = 'remote' | 'local';
export type LinkType = '4g' | 'fiber';

export const ACTION_TARGET: Record<DeviceAction, DeviceState> = {
  close: 'closed',
  open: 'open',
  lock: 'locked',
  unlock: 'unlocked',
  on: 'on',
  off: 'off',
};
