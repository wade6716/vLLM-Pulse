import { HelpCircle } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface InfoTipProps {
  title: string;
  formula?: string;
  description: string;
  className?: string;
}

const TOOLTIP_WIDTH = 296;
const VIEWPORT_MARGIN = 12;

export function InfoTip({ title, formula, description, className = '' }: InfoTipProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number; above: boolean }>({
    left: 0,
    top: 0,
    above: false,
  });

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2), maxLeft);
    const placeAbove = rect.bottom + 150 > window.innerHeight;
    const top = placeAbove ? rect.top - 8 : rect.bottom + 8;
    setCoords({ left, top, above: placeAbove });
  }, []);

  const handleOpen = () => {
    updatePosition();
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${title}指标说明`}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
        className={`inline-flex items-center justify-center rounded-full p-0.5 text-slate-500 hover:text-cyan-300 focus:outline-none focus:text-cyan-300 transition-colors cursor-help shrink-0 ${className}`}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: `${coords.left}px`,
              top: `${coords.top}px`,
              width: `${TOOLTIP_WIDTH}px`,
              transform: coords.above ? 'translateY(-100%)' : 'none',
              zIndex: 9999,
              pointerEvents: 'none',
            }}
            className="rounded-lg bg-[#0F172A]/95 border border-slate-700/90 px-3 py-2.5 shadow-2xl backdrop-blur-md text-left"
          >
            <div className="text-xs font-semibold text-cyan-300">{title}</div>
            {formula && (
              <div className="text-[10px] mono-nums text-slate-400 mt-0.5 break-all">{formula}</div>
            )}
            <p className="text-[11px] leading-relaxed text-slate-200 mt-1.5">{description}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
