import { useEffect, useState, type CSSProperties } from 'react';

const STORAGE_KEY = 'ice-tour-v1';
const POPUP_WIDTH = 300;

interface Step {
  target: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    target: '[data-tour="view-switch"]',
    title: '视图切换',
    body: '这里是两种视图的切换入口：按钮视图按模块列卡片，适合快速批量操作；铁塔视图加载真型铁塔三维模型，适合查看设备实际位置。',
  },
  {
    target: '[data-tour="view-card"]',
    title: '按钮视图',
    body: '每个模块一张卡片，设备按钮一字排开，点一下即下发动作。卡片下方还有「设备操作」与「设备视角」两组按钮，可直接切换机位。',
  },
  {
    target: '[data-tour="view-tower"]',
    title: '铁塔视图',
    body: '可拖动旋转、滚轮缩放、右键平移，点击塔上设备即可切换状态；下方同样有「设备操作」和「设备视角」分组，点「全屏」进入大屏查看。',
  },
];

function hasSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 首次访问引导：灰色遮罩 + 聚光灯 + 小弹窗和箭头，依次介绍视图切换与两种视图 */
export function Onboarding() {
  const [step, setStep] = useState(() => (hasSeen() ? -1 : 0));
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (step < 0) return;
    const measure = () => {
      const el = document.querySelector(STEPS[step].target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    /* 布局稳定后再量一次，避免顶栏字体/图标加载导致偏移 */
    const timer = window.setTimeout(measure, 260);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  if (step < 0) return null;

  const current = STEPS[step];
  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // 忽略隐私模式
    }
    setStep(-1);
  };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let popLeft = (viewportWidth - POPUP_WIDTH) / 2;
  let popTop = viewportHeight / 2 - 80;
  let placement: 'top' | 'bottom' = 'bottom';
  let arrowOffset = POPUP_WIDTH / 2;

  if (rect) {
    const centerX = rect.left + rect.width / 2;
    popLeft = Math.min(Math.max(centerX - POPUP_WIDTH / 2, 16), viewportWidth - POPUP_WIDTH - 16);
    const below = rect.bottom + 16;
    if (below + 210 > viewportHeight) {
      placement = 'top';
      popTop = Math.max(rect.top - 16 - 200, 16);
    } else {
      popTop = below;
    }
    arrowOffset = Math.min(Math.max(centerX - popLeft, 20), POPUP_WIDTH - 20);
  }

  const arrowStyle: CSSProperties =
    placement === 'top' ? { left: arrowOffset - 7, bottom: -7 } : { left: arrowOffset - 7, top: -7 };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="新手引导">
      {rect ? (
        <div
          className="tour-spot"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : (
        <div className="tour-mask" />
      )}
      <div className="tour-pop" style={{ left: popLeft, top: popTop, width: POPUP_WIDTH }}>
        {rect ? <span className={`tour-arrow ${placement}`} style={arrowStyle} /> : null}
        <div className="tour-head">
          <span className="tour-step">
            第 {step + 1} / {STEPS.length} 步
          </span>
          <button type="button" className="tour-skip" onClick={finish}>
            跳过
          </button>
        </div>
        <div className="tour-title">{current.title}</div>
        <div className="tour-body">{current.body}</div>
        <div className="tour-actions">
          {step > 0 ? (
            <button type="button" className="btn btn-sm" onClick={() => setStep((value) => value - 1)}>
              上一步
            </button>
          ) : null}
          <span className="grow" />
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setStep((value) => value + 1)}>
              下一步
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={finish}>
              开始使用
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
