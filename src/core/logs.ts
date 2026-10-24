import fs from 'node:fs/promises';
import path from 'node:path';

export interface OpLogEntry {
  at: number;
  moduleId: number;
  towerName: string;
  kind: 'connect' | 'disconnect' | 'command' | 'device' | 'pending' | 'history' | 'send' | 'config';
  device?: string;
  state?: string;
  detail?: string;
}

export class OperationLog {
  constructor(private readonly dir: string) {}

  async append(entry: OpLogEntry): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const date = new Date(entry.at);
      const name = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.ndjson`;
      await fs.appendFile(path.join(this.dir, name), `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      console.error('[log] 写入操作日志失败：', (error as Error).message);
    }
  }
}
