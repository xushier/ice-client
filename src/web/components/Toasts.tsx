import { useUi } from '../store';
import { CheckIcon, WarnIcon } from './icons';

export function Toasts() {
  const toasts = useUi((state) => state.toasts);
  const dismissToast = useUi((state) => state.dismissToast);

  return (
    <div className="toasts">
      {toasts.map((item) => (
        <div className={`toast ${item.kind}`} key={item.id} onClick={() => dismissToast(item.id)}>
          <span className="toast-icon">{item.kind === 'ok' ? <CheckIcon size={14} /> : <WarnIcon size={14} />}</span>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}
