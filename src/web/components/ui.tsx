import type { ComponentType, ReactNode } from 'react';
import type { LinkStatus } from '../../core/types';
import type { IconProps } from './icons';
import { PlusIcon } from './icons';

export function Stat({
  label,
  value,
  unit,
  hint,
  ratio,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  ratio?: number;
  icon?: ComponentType<IconProps>;
}) {
  const pct = ratio === undefined ? undefined : Math.max(0, Math.min(100, ratio * 100));
  return (
    <div className="stat">
      <div className="stat-label">
        {Icon ? <Icon size={11} /> : null}
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {pct === undefined ? null : (
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

const LINK_LABELS: Record<LinkStatus, string> = {
  online: '在线',
  connecting: '连接中',
  offline: '离线',
};

export function StatusPill({ link, error }: { link: LinkStatus; error?: string | null }) {
  if (error && link !== 'online') {
    return <span className="pill pill-error">异常</span>;
  }
  const cls = link === 'online' ? 'pill-online' : link === 'connecting' ? 'pill-connecting' : 'pill-offline';
  return <span className={`pill ${cls}`}>{LINK_LABELS[link]}</span>;
}

export function CounterChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="counter">
      {label} <b>{value}</b>
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <PlusIcon size={26} />
      </div>
      <div className="empty-title">{title}</div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 14 }}>
        {children}
      </div>
      {action}
    </div>
  );
}
