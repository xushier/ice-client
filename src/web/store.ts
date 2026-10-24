import { create } from 'zustand';
import { api } from './api';
import type { AppSnapshot, FrameLog } from '../core/types';

export type ViewMode = 'card' | 'tower';
export type WsState = 'connecting' | 'open' | 'closed';
export type DialogState =
  | { kind: 'new' }
  | { kind: 'edit'; moduleId: number }
  | { kind: 'settings' }
  | { kind: 'builder'; moduleId?: number }
  | null;

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err';
}

interface UiState {
  snapshot: AppSnapshot | null;
  wsState: WsState;
  frames: Record<number, FrameLog[]>;
  framesPaused: boolean;
  view: ViewMode;
  sidebarCollapsed: boolean;
  monitorOpen: boolean;
  activeId: number | null;
  dialog: DialogState;
  toasts: Toast[];
  booted: boolean;

  setSnapshot: (snapshot: AppSnapshot) => void;
  setView: (view: ViewMode) => void;
  toggleSidebar: () => void;
  toggleMonitor: () => void;
  setActiveId: (id: number) => void;
  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;
  toast: (text: string, kind?: 'ok' | 'err') => void;
  dismissToast: (id: number) => void;
  togglePause: () => void;
  loadFrames: (ids: number[]) => void;
  setFrames: (id: number, frames: FrameLog[]) => void;
  appendFrame: (id: number, frame: FrameLog) => void;
  refresh: () => Promise<void>;
}

function readView(): ViewMode {
  try {
    return localStorage.getItem('ice-view') === 'tower' ? 'tower' : 'card';
  } catch {
    return 'card';
  }
}

let toastSeq = 0;
let started = false;
let socket: WebSocket | null = null;
let socketRetry: ReturnType<typeof setTimeout> | null = null;
let frameRequested = new Set<number>();

export const useUi = create<UiState>((set, get) => ({
  snapshot: null,
  wsState: 'connecting',
  frames: {},
  framesPaused: false,
  view: readView(),
  sidebarCollapsed: false,
  monitorOpen: false,
  activeId: null,
  dialog: null,
  toasts: [],
  booted: false,

  setSnapshot: (snapshot) => {
    const activeId = get().activeId;
    const exists = activeId !== null && snapshot.modules.some((module) => module.id === activeId);
    set({
      snapshot,
      booted: true,
      activeId: exists ? activeId : snapshot.modules[0]?.id ?? null,
      wsState: socket?.readyState === WebSocket.OPEN ? 'open' : get().wsState,
    });
    void get().loadFrames(snapshot.modules.map((module) => module.id));
  },

  setView: (view) => {
    set({ view });
    try {
      localStorage.setItem('ice-view', view);
    } catch {
      // 忽略隐私模式
    }
  },

  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  toggleMonitor: () => set({ monitorOpen: !get().monitorOpen }),
  setActiveId: (id) => set({ activeId: id }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  toast: (text, kind = 'ok') => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), 4200);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((item) => item.id !== id) }),
  togglePause: () => set({ framesPaused: !get().framesPaused }),

  loadFrames: (ids) => {
    for (const id of ids) {
      if (frameRequested.has(id) || get().frames[id]) continue;
      frameRequested.add(id);
      api
        .frames(id)
        .then((result) => get().setFrames(id, result.frames))
        .catch(() => {
          frameRequested.delete(id);
        });
    }
  },

  setFrames: (id, frames) => set({ frames: { ...get().frames, [id]: frames } }),

  appendFrame: (id, frame) => {
    if (get().framesPaused) return;
    const current = get().frames[id] ?? [];
    const next = [...current, frame];
    if (next.length > 400) next.splice(0, next.length - 400);
    set({ frames: { ...get().frames, [id]: next } });
  },

  refresh: async () => {
    try {
      const snapshot = await api.state();
      get().setSnapshot(snapshot);
    } catch (error) {
      get().toast((error as Error).message, 'err');
    }
  },
}));

function connectSocket(): void {
  if (socket) return;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  useUi.setState({ wsState: 'connecting' });
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => useUi.setState({ wsState: 'open' });
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as {
        type: string;
        data: AppSnapshot | { moduleId: number; frame: FrameLog } | { moduleId: number; frames: FrameLog[] };
      };
      if (message.type === 'state') {
        useUi.getState().setSnapshot(message.data as AppSnapshot);
      } else if (message.type === 'frame') {
        const payload = message.data as { moduleId: number; frame: FrameLog };
        useUi.getState().appendFrame(payload.moduleId, payload.frame);
      } else if (message.type === 'frames') {
        const payload = message.data as { moduleId: number; frames: FrameLog[] };
        useUi.getState().setFrames(payload.moduleId, payload.frames);
      }
    } catch {
      // 忽略非法消息
    }
  };
  ws.onclose = () => {
    socket = null;
    useUi.setState({ wsState: 'closed' });
    if (socketRetry) clearTimeout(socketRetry);
    socketRetry = setTimeout(() => {
      socketRetry = null;
      connectSocket();
    }, 1800);
  };
  ws.onerror = () => ws.close();
}

export async function bootstrap(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const snapshot = await api.state();
    useUi.getState().setSnapshot(snapshot);
  } catch (error) {
    useUi.getState().toast(`读取状态失败：${(error as Error).message}`, 'err');
  }
  connectSocket();
  setInterval(() => {
    // 触发依赖时间的界面刷新
    useUi.setState({});
  }, 1000);
}
