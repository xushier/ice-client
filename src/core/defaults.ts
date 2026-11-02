import type { ServerConfig, Telemetry } from './types';

export const DEFAULT_CONFIG: ServerConfig = {
  registration: true,
  envReport: false,
  stateIntervalSec: 60,
  powerIntervalSec: 3600,
  envIntervalSec: 300,
  hourlyBundle: true,
  alignHourly: true,
  autoMode: false,
  autoDelaySec: 5,
  autoReconnect: true,
  controlMode: 'remote',
  linkType: '4g',
  networkError: false,
  animSwitchSec: 5,
  animLockSec: 10,
  animIceSec: 15,
};

export const DEFAULT_TELEMETRY: Telemetry = {
  socPct: 86,
  batteryVolt: 53.2,
  loadVolt: 48.1,
  loadCurrent: 1.25,
  solarVolt: 71.5,
  solarCurrent: 2.4,
  chargeState: 0,
  faultHigh: 0,
  faultLow: 0,
  envTemp: 26.5,
  envHumidity: 55,
  cell1Temp: 24,
  cell2Temp: 25,
  acState: 2,
  acAlarmLow: 0,
  acAlarm17: false,
  fireUsed: false,
};

export const DEFAULT_HOST = '10.10.10.143';
export const DEFAULT_PORT = 3000;
export const DEFAULT_PROTOCOL = 'mg500' as const;
