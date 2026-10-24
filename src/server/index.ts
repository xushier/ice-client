import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from '../core/store';
import { SessionManager } from '../core/manager';
import { OperationLog } from '../core/logs';
import { AppError } from '../core/errors';
import { isProtocolId, presetStates } from '../protocol';
import type { DeviceKind, DeviceState, ProtocolId } from '../protocol/types';
import type {
  CreateModuleInput,
  ServerConfig,
  ServerEvent,
  Telemetry,
  UpdateModuleInput,
} from '../core/types';

const VERSION = '1.4.0';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

function parseModuleId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 0 || id > 4095) throw new AppError('模块 ID 必须是 0~4095 的整数（12bit）');
  return id;
}

function parseProtocol(raw: unknown): ProtocolId | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !isProtocolId(raw)) throw new AppError('协议必须是 mg400 或 mg500');
  return raw;
}

function parseDevices(raw: unknown): DeviceKind[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new AppError('devices 必须是数组');
  return raw.filter((item): item is DeviceKind => typeof item === 'string');
}

function parseByteArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw new AppError('data 必须是字节数组');
  return raw.map((item) => {
    const value = Number(item);
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new AppError('data 每个元素必须是 0~255');
    return value;
  });
}

async function main(): Promise<void> {
  const store = new Store(DATA_DIR);
  await store.init();
  const log = new OperationLog(path.join(DATA_DIR, 'logs'));

  const clients = new Set<WebSocket>();
  const broadcast = (event: ServerEvent): void => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  const manager = new SessionManager(store, log, broadcast, VERSION);
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number };
    const status = error instanceof AppError ? error.status : (err.statusCode ?? 500);
    if (status >= 500) console.error('[server]', error);
    reply.status(status).send({ error: err.message || '服务器内部错误' });
  });

  app.get('/api/health', async () => ({ ok: true, version: VERSION, uptime: process.uptime() }));

  app.get('/api/state', async () => manager.snapshot());

  app.get('/api/config', async () => store.config);

  app.patch('/api/config', async (request) => {
    const body = (request.body ?? {}) as Partial<ServerConfig>;
    return manager.updateConfig(body);
  });

  app.get('/api/config/export', async (_request, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="ice-client-config.json"');
    return store.exportState();
  });

  app.post('/api/config/import', async (request) => {
    const body = (request.body ?? {}) as { config?: Partial<ServerConfig>; modules?: unknown[] };
    manager.importState(body as Parameters<Store['importState']>[0]);
    return manager.snapshot();
  });

  app.post('/api/modules', async (request) => {
    const body = (request.body ?? {}) as CreateModuleInput;
    if (body.id === undefined) throw new AppError('缺少模块 ID');
    const module = manager.createModule({
      id: parseModuleId(body.id),
      towerName: typeof body.towerName === 'string' ? body.towerName : undefined,
      protocol: parseProtocol(body.protocol),
      host: typeof body.host === 'string' ? body.host : undefined,
      port: body.port === undefined ? undefined : Number(body.port),
      devices: parseDevices(body.devices),
      autoConnect: typeof body.autoConnect === 'boolean' ? body.autoConnect : true,
    });
    return module;
  });

  app.patch('/api/modules/:id', async (request) => {
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as UpdateModuleInput;
    const module = manager.updateModule(parseModuleId(params.id), {
      id: body.id === undefined ? undefined : parseModuleId(body.id),
      towerName: typeof body.towerName === 'string' ? body.towerName : undefined,
      protocol: parseProtocol(body.protocol),
      host: typeof body.host === 'string' ? body.host : undefined,
      port: body.port === undefined ? undefined : Number(body.port),
      devices: parseDevices(body.devices),
      autoConnect: typeof body.autoConnect === 'boolean' ? body.autoConnect : undefined,
      states: body.states,
      telemetry: body.telemetry,
    });
    return module;
  });

  app.delete('/api/modules/:id', async (request) => {
    const params = request.params as { id: string };
    return manager.deleteModule(parseModuleId(params.id));
  });

  app.post('/api/modules/:id/connect', async (request) => {
    const params = request.params as { id: string };
    manager.connect(parseModuleId(params.id));
    return { ok: true };
  });

  app.post('/api/modules/:id/disconnect', async (request) => {
    const params = request.params as { id: string };
    manager.disconnect(parseModuleId(params.id));
    return { ok: true };
  });

  app.post('/api/modules/:id/history', async (request) => {
    const params = request.params as { id: string };
    manager.reportHistory(parseModuleId(params.id), 'manual');
    return { ok: true };
  });

  app.post('/api/modules/:id/device', async (request) => {
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as { device?: DeviceKind; state?: DeviceState };
    if (!body.device || !body.state) throw new AppError('缺少 device 或 state');
    manager.setDevice(parseModuleId(params.id), body.device, body.state);
    return { ok: true };
  });

  app.post('/api/modules/:id/preset', async (request) => {
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as { preset?: 'initial' | 'ice' };
    if (body.preset !== 'initial' && body.preset !== 'ice') throw new AppError('preset 必须是 initial 或 ice');
    const id = parseModuleId(params.id);
    const module = store.getModule(id);
    manager.preset(id, presetStates(module.devices, body.preset));
    return { ok: true };
  });

  app.post('/api/modules/:id/pending/:pendingId/accept', async (request) => {
    const params = request.params as { id: string; pendingId: string };
    manager.acceptPending(parseModuleId(params.id), params.pendingId);
    return { ok: true };
  });

  app.post('/api/modules/:id/pending/:pendingId/ignore', async (request) => {
    const params = request.params as { id: string; pendingId: string };
    manager.ignorePending(parseModuleId(params.id), params.pendingId);
    return { ok: true };
  });

  app.post('/api/modules/:id/send', async (request) => {
    const params = request.params as { id: string };
    const id = parseModuleId(params.id);
    const body = (request.body ?? {}) as { hex?: string; type?: number; data?: number[] };
    if (typeof body.hex === 'string' && body.hex.trim()) {
      manager.sendRaw(id, body.hex);
      return { ok: true };
    }
    const type = Number(body.type);
    if (!Number.isInteger(type) || type < 0 || type > 255) throw new AppError('type 必须是 0~255');
    manager.sendTyped(id, type, parseByteArray(body.data ?? []));
    return { ok: true };
  });

  app.post('/api/modules/:id/telemetry', async (request) => {
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as { patch?: Partial<Telemetry> } | Partial<Telemetry>;
    const patch = 'patch' in body && body.patch ? body.patch : (body as Partial<Telemetry>);
    manager.patchTelemetry(parseModuleId(params.id), patch);
    return { ok: true };
  });

  app.get('/api/modules/:id/frames', async (request) => {
    const params = request.params as { id: string };
    return { frames: manager.frames(parseModuleId(params.id)) };
  });

  app.post('/api/connect-all', async () => {
    manager.connectAll();
    return { ok: true };
  });

  app.post('/api/disconnect-all', async () => {
    manager.disconnectAll();
    return { ok: true };
  });

  const webDir = path.resolve(__dirname, 'web');
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api') && !request.url.startsWith('/ws')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not Found' });
    });
  } else {
    app.get('/', async (_request, reply) => {
      reply.type('text/plain; charset=utf-8');
      return '前端尚未构建：请先执行 npm run build:web。';
    });
  }

  const wss = new WebSocketServer({ noServer: true });
  app.server.on('upgrade', (request, socket, head) => {
    if (!request.url || !request.url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'state', data: manager.snapshot() }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }, 30_000);
  heartbeat.unref();

  app.server.on('close', () => {
    clearInterval(heartbeat);
    wss.close();
  });

  await app.listen({ port: PORT, host: HOST });
  manager.start();
  console.log(`[server] ice-client ${VERSION} listening on http://${HOST}:${PORT} (data: ${DATA_DIR})`);

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`[server] ${signal} 退出，保存配置…`);
    manager.shutdown();
    await store.saveNow();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[server] 启动失败：', error);
  process.exit(1);
});
