export function timeAgo(at: number | null | undefined): string {
  if (!at) return '—';
  const diff = Date.now() - at;
  if (diff < 0) return clock(at);
  if (diff < 4_000) return '刚刚';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s 前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min 前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h 前`;
  return clock(at);
}

export function clock(at: number | null | undefined): string {
  if (!at) return '—';
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function fullTime(at: number | null | undefined): string {
  if (!at) return '—';
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

export function countdown(at: number | undefined): string {
  if (!at) return '';
  const diff = Math.max(0, at - Date.now());
  return `${(diff / 1000).toFixed(1)}s`;
}

export function sideLabel(id: number): string {
  return id & 1 ? '大号侧' : '小号侧';
}
