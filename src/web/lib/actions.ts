import { useCallback, useState } from 'react';
import { useUi } from '../store';

export function useAction() {
  const toast = useUi((state) => state.toast);
  const refresh = useUi((state) => state.refresh);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (task: () => Promise<unknown>, okText?: string) => {
      setBusy(true);
      try {
        await task();
        if (okText) toast(okText);
        await refresh();
        return true;
      } catch (error) {
        toast((error as Error).message || '操作失败', 'err');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );

  return { busy, run };
}
