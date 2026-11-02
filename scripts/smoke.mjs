#!/usr/bin/env node
/**
 * 冒烟测试：起一个假平台 TCP 服务 + 真实后端进程，覆盖上线注册、历史整包、
 * 命令应答、人工到位、自动模式、环境帧开关、遥测、模块编辑、离线保护与重连。
 *
 * 运行前需先执行 npm run build。
 */
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const WAIT_MS = 5000;
const MODULE_ID = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hex2 = (value) => value.toString(16).padStart(2, '0').toUpperCase();
const typeName = (type) => `0x${hex2(type)}`;
const show = (bytes) => bytes.map(hex2).join(' ');

let passed = 0;
function ok(condition, label) {
  if (!condition) throw new Error(`断言失败：${label}`);
  passed += 1;
  console.log(`  [OK] ${label}`);
}
function section(title) {
  console.log(`\n[场景] ${title}`);
}

/* ---------- 协议工具（与 src/protocol 保持一致的最小实现） ---------- */

function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

function buildFrame(id, type, data = []) {
  const len = 3 + data.length;
  const out = [0x5a, 0x47, len, (id >> 8) & 0x0f, id & 0xff, type & 0xff];
  for (const byte of data) out.push(byte & 0xff);
  const crc = crc16(out);
  out.push(crc & 0xff, (crc >>> 8) & 0xff);
  return Buffer.from(out);
}

class FrameReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];
    for (;;) {
      if (this.buffer.length < 2) break;
      const start = this.buffer.indexOf(Buffer.from([0x5a, 0x47]));
      if (start < 0) {
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      if (this.buffer.length < 3) break;
      const len = this.buffer[2];
      if (len < 3 || len > 67) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      if (this.buffer.length < 5 + len) break;
      const raw = this.buffer.subarray(0, 5 + len);
      const expect = (raw[raw.length - 1] << 8) | raw[raw.length - 2];
      frames.push({
        id: ((raw[3] & 0x0f) << 8) | raw[4],
        type: raw[5],
        data: Array.from(raw.subarray(6, 3 + len)),
        crcOk: crc16(raw.subarray(0, len + 3)) === expect,
      });
      this.buffer = this.buffer.subarray(5 + len);
    }
    return frames;
  }
}

/* ---------- 假平台 ---------- */

class FakePlatform {
  constructor() {
    this.frames = [];
    this.sockets = new Set();
    this.server = net.createServer((socket) => {
      const reader = new FrameReader();
      this.sockets.add(socket);
      socket.on('data', (chunk) => {
        for (const frame of reader.push(chunk)) this.frames.push(frame);
      });
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', () => this.sockets.delete(socket));
    });
  }

  async start() {
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = this.server.address().port;
  }

  get online() {
    return this.sockets.size > 0;
  }

  mark() {
    return this.frames.length;
  }

  send(type, data, id = MODULE_ID) {
    const frame = buildFrame(id, type, data);
    for (const socket of this.sockets) socket.write(frame);
  }

  async wait(from, types, timeout = WAIT_MS) {
    const wanted = new Set(types);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = new Map();
      for (const frame of this.frames.slice(from)) {
        if (wanted.has(frame.type) && !found.has(frame.type)) found.set(frame.type, frame);
      }
      if (found.size === wanted.size) return found;
      await sleep(20);
    }
    const received = this.frames.slice(from).map((frame) => typeName(frame.type));
    throw new Error(
      `等待帧超时，期望 ${types.map(typeName).join('/')}，实际收到 ${received.length ? received.join(', ') : '（无）'}`,
    );
  }

  async expectNone(from, type, waitMs = 500) {
    await sleep(waitMs);
    const hit = this.frames.slice(from).find((frame) => frame.type === type);
    if (hit) throw new Error(`不应收到 ${typeName(type)}，但收到了 ${show(hit.data)}`);
  }

  async waitOnline(timeout = WAIT_MS) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.online) return;
      await sleep(20);
    }
    throw new Error('平台侧未等到终端 TCP 连接');
  }

  async close() {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

/* ---------- HTTP 接口 ---------- */

let apiBase = '';

async function call(method, url, body) {
  const res = await fetch(apiBase + url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = text;
  try {
    payload = JSON.parse(text);
  } catch {
    /* 保留纯文本 */
  }
  return { status: res.status, body: payload };
}

async function snapshot() {
  const res = await call('GET', '/api/state');
  if (res.status !== 200) throw new Error(`读取快照失败：${res.status}`);
  return res.body;
}

function moduleOf(snap) {
  return snap.modules.find((item) => item.id === MODULE_ID);
}

async function waitModule(predicate, label, timeout = WAIT_MS) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const module = moduleOf(await snapshot());
    if (module && predicate(module)) return module;
    await sleep(50);
  }
  const module = moduleOf(await snapshot());
  throw new Error(`等待模块状态超时：${label}（当前 ${JSON.stringify(module?.states)} / ${module?.runtime?.link}）`);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitHealth(timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiBase}/api/health`);
      if (res.ok) return;
    } catch {
      /* 服务尚未就绪 */
    }
    await sleep(100);
  }
  throw new Error('后端未在 15s 内就绪');
}

/* ---------- 主流程 ---------- */

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-client-smoke-'));
  const platform = new FakePlatform();
  await platform.start();
  const apiPort = await freePort();
  apiBase = `http://127.0.0.1:${apiPort}`;

  const logs = [];
  let child = null;
  try {
    child = spawn(process.execPath, ['dist/server.cjs'], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dataDir, PORT: String(apiPort), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => logs.push(String(chunk)));
    child.stderr.on('data', (chunk) => logs.push(String(chunk)));
    await waitHealth();
    /* 动画时长压到 1s，冒烟测试才能在一个等待窗口内看到「动作中 → 到位」的完整过程 */
    await call('PATCH', '/api/config', { animSwitchSec: 1, animLockSec: 1, animIceSec: 1 });

    section('上线注册 + 连接后历史整包（默认不发 0x30）');
    const createMark = platform.mark();
    const create = await call('POST', '/api/modules', {
      id: MODULE_ID,
      towerName: '1 号塔',
      protocol: 'mg400',
      host: '127.0.0.1',
      port: platform.port,
      autoConnect: true,
    });
    ok(create.status === 200, '新建模块返回 200');
    await platform.waitOnline();
    ok(platform.online, '终端已连上假平台');

    const bundle = await platform.wait(createMark, [0x05, 0x10, 0x20]);
    ok(bundle.get(0x05).data.join(',') === '255,255', '0x05 上线注册数据为 FF FF');
    ok(bundle.get(0x05).id === MODULE_ID, '0x05 帧 ID 与模块 ID 一致');
    ok(show(bundle.get(0x10).data) === '0D 2B', `0x10 初始状态为 0D 2B（实际 ${show(bundle.get(0x10).data)}）`);
    ok(bundle.get(0x20).data.length === 18, '0x20 供电帧长度 18');
    ok(bundle.get(0x20).data.slice(0, 2).join(',') === '0,86', '0x20 SOC 为 86');
    ok(bundle.get(0x10).crcOk && bundle.get(0x20).crcOk, 'CRC 校验通过');
    await platform.expectNone(createMark, 0x30, 400);
    ok(true, '默认配置下未发送 0x30 环境帧');

    section('平台动作命令 → 0x01 应答 → 待动作 → 人工到位');
    const cmdMark = platform.mark();
    platform.send(0x00, [0x08, 0x00]); // MG400 融冰刀闸合闸
    const ack = await platform.wait(cmdMark, [0x01]);
    ok(ack.get(0x01).data[0] === 0x00, '0x00 命令回复 0x01 00');
    const pendingModule = await waitModule((item) => item.runtime.pending.length === 1, '出现待动作');
    const pending = pendingModule.runtime.pending[0];
    ok(pending.device === 'iceSwitch' && pending.action === 'close', '待动作为 iceSwitch/close');
    ok(pendingModule.states.iceSwitch === 'open', '人工确认前不改变设备状态');
    const acceptMark = platform.mark();
    const accept = await call('POST', `/api/modules/${MODULE_ID}/pending/${pending.id}/accept`);
    ok(accept.status === 200, '接受待动作返回 200');
    /* 动作期间设备处于「合闸中」，等动画播完才会切到位并上报 0x10 */
    await platform.expectNone(acceptMark, 0x10, 700);
    ok(true, '接受后动画期间不立即上报到位帧');
    const closed = await waitModule((item) => item.states.iceSwitch === 'closed', 'iceSwitch 合闸到位', 8000);
    ok(closed.states.iceSwitch === 'closed', '动画结束后 iceSwitch 变为 closed');
    const afterAccept = await platform.wait(acceptMark, [0x10]);
    ok((afterAccept.get(0x10).data[0] & 0x10) !== 0, '状态帧回传融冰刀闸合到位位');

    section('自动模式（autoDelaySec=0）');
    const autoCfg = await call('PATCH', '/api/config', { autoMode: true, autoDelaySec: 0 });
    ok(autoCfg.status === 200 && autoCfg.body.autoMode === true, '开启自动模式');
    const autoMark = platform.mark();
    platform.send(0x00, [0x00, 0x40]); // MG400 接地刀闸 1 分闸
    await platform.wait(autoMark, [0x01]);
    const opened = await waitModule((item) => item.states.ground1 === 'open', 'ground1 自动分闸');
    ok(opened.states.ground1 === 'open', '自动模式无需人工确认即到位');
    ok(opened.runtime.pending.length === 0, '自动到位后待动作队列为空');

    section('手动历史整包 + 遥测修改');
    const historyMark = platform.mark();
    const history = await call('POST', `/api/modules/${MODULE_ID}/history`);
    ok(history.status === 200, '手动上报历史整包返回 200');
    const historyFrames = await platform.wait(historyMark, [0x10, 0x20]);
    ok(historyFrames.get(0x20).data.length === 18, '历史整包包含 0x20');
    const telemetry = await call('POST', `/api/modules/${MODULE_ID}/telemetry`, { patch: { socPct: 50 } });
    ok(telemetry.status === 200, '修改遥测返回 200');
    const telemetryMark = platform.mark();
    await call('POST', `/api/modules/${MODULE_ID}/history`);
    const telemetryFrames = await platform.wait(telemetryMark, [0x10, 0x20]);
    ok(telemetryFrames.get(0x20).data.slice(0, 2).join(',') === '0,50', '0x20 使用新 SOC=50');

    section('开启 envReport 后历史整包包含 0x30');
    const envCfg = await call('PATCH', '/api/config', { envReport: true });
    ok(envCfg.status === 200 && envCfg.body.envReport === true, '开启环境帧上报');
    const envMark = platform.mark();
    await call('POST', `/api/modules/${MODULE_ID}/history`);
    const envFrames = await platform.wait(envMark, [0x30]);
    ok(envFrames.get(0x30).data.length === 16, '0x30 环境帧长度 16');
    ok(envFrames.get(0x30).data.slice(0, 2).join(',') === '1,9', '0x30 温度 26.5℃ 编码为 01 09');

    section('空调命令 0x02 → 0x03 应答');
    const acMark = platform.mark();
    platform.send(0x02, [0x01]);
    const acAck = await platform.wait(acMark, [0x03]);
    ok(acAck.get(0x03).data[0] === 0x00, '0x02 命令回复 0x03 00');

    section('模块编辑与重复 ID 校验');
    const duplicate = await call('POST', '/api/modules', { id: MODULE_ID, protocol: 'mg400' });
    ok(duplicate.status === 400, '重复 ID 返回 400');
    const edit = await call('PATCH', `/api/modules/${MODULE_ID}`, { towerName: '1 号塔（改名）' });
    ok(edit.status === 200 && edit.body.towerName === '1 号塔（改名）', '编辑塔名成功');
    ok(platform.online, '仅改塔名不会断开 TCP');
    const frames = await call('GET', `/api/modules/${MODULE_ID}/frames`);
    ok(frames.status === 200 && frames.body.frames.length > 0, '帧监视接口返回收发记录');

    section('断开保护与重连');
    const disconnect = await call('POST', `/api/modules/${MODULE_ID}/disconnect`);
    ok(disconnect.status === 200, '断开返回 200');
    await waitModule((item) => item.runtime.link === 'offline', '模块离线');
    const offlineHistory = await call('POST', `/api/modules/${MODULE_ID}/history`);
    ok(offlineHistory.status === 400, '离线时上报历史整包返回 400');
    const offlineSend = await call('POST', `/api/modules/${MODULE_ID}/send`, { type: 0x10, data: [0, 0] });
    ok(offlineSend.status === 400, '离线时发送帧返回 400');
    const reconnectMark = platform.mark();
    await call('POST', `/api/modules/${MODULE_ID}/connect`);
    await platform.wait(reconnectMark, [0x05, 0x10, 0x20], 8000);
    ok(true, '手动重连后重新发送注册与历史整包');

    console.log(`\n冒烟测试通过：${passed} 项断言`);
  } catch (error) {
    console.error(`\n冒烟测试失败：${(error && error.message) || error}`);
    if (logs.length) console.error(`\n--- 服务端输出 ---\n${logs.join('')}`);
    process.exitCode = 1;
  } finally {
    if (child) {
      child.kill();
      await sleep(150);
    }
    await platform.close().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}

await main();
