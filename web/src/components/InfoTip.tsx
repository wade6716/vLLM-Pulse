import { HelpCircle } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface InfoTipProps {
  title: string;
  formula?: string;
  description: string;
  className?: string;
}

const TOOLTIP_WIDTH = 304;
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
    const placeAbove = rect.bottom + 155 > window.innerHeight;
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
        className={`inline-flex items-center justify-center rounded-full p-0.5 text-white/30 hover:text-white/80 focus:outline-none focus:text-white/85 transition-colors cursor-help shrink-0 ${className}`}
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
              background: 'rgba(38, 38, 42, 0.90)',
              backdropFilter: 'blur(28px) saturate(180%)',
              WebkitBackdropFilter: 'blur(28px) saturate(180%)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: '14px',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
            }}
            className="px-3.5 py-3 text-left"
          >
            <div className="text-xs font-semibold text-[#F5F5F7] tracking-tight">{title}</div>
            {formula && (
              <div className="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-white/[0.07] text-[10px] mono-nums text-[#64D2FF] break-all">
                {formula}
              </div>
            )}
            <p className="text-[11.5px] leading-relaxed text-white/75 mt-2">{description}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
