'use client';

import clsx from 'clsx';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const ACTION = 88;
const OPEN_AT = 56;

/**
 * Swipe the row to the right to reveal Delete on the left (touch or mouse drag).
 * Tapping Delete calls onDelete; the parent should show its own confirmation.
 */
export function SwipeDeleteRow({
  enabled = true,
  label = 'Delete',
  onDelete,
  children,
  className,
}: {
  enabled?: boolean;
  label?: string;
  onDelete: () => void;
  children: ReactNode;
  className?: string;
}) {
  const [offset, setOffset] = useState(0);
  const [live, setLive] = useState(false);
  const offsetRef = useRef(0);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const startOffset = useRef(0);
  const axis = useRef<'h' | 'v' | null>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const frontRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    if (!enabled) setOffset(0);
  }, [enabled]);

  const snap = (v: number) => {
    const next = v >= OPEN_AT ? ACTION : 0;
    setOffset(next);
    offsetRef.current = next;
    setLive(false);
  };

  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    startX.current = null;
    startY.current = null;
    if (axis.current === 'h') snap(offsetRef.current);
    else setLive(false);
    axis.current = null;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || startX.current == null || startY.current == null) return;
      const dx = e.clientX - startX.current;
      const dy = e.clientY - startY.current;
      if (!axis.current) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        if (axis.current === 'v') {
          endDrag();
          return;
        }
      }
      if (axis.current !== 'h') return;
      moved.current = true;
      setOffset(Math.max(0, Math.min(ACTION, startOffset.current + dx)));
    };
    const onUp = () => endDrag();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onPointerDown = (clientX: number, clientY: number) => {
    if (!enabled) return;
    startX.current = clientX;
    startY.current = clientY;
    startOffset.current = offsetRef.current;
    axis.current = null;
    dragging.current = true;
    moved.current = false;
    setLive(true);
  };

  const onTouchMove = (clientX: number, clientY: number) => {
    if (!dragging.current || startX.current == null || startY.current == null) return;
    const dx = clientX - startX.current;
    const dy = clientY - startY.current;
    if (!axis.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      if (axis.current === 'v') {
        endDrag();
        return;
      }
    }
    if (axis.current !== 'h') return;
    moved.current = true;
    setOffset(Math.max(0, Math.min(ACTION, startOffset.current + dx)));
  };

  const blockClick = (e: React.MouseEvent) => {
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
      moved.current = false;
      return;
    }
    if (offsetRef.current > 0) {
      e.preventDefault();
      e.stopPropagation();
      setOffset(0);
    }
  };

  if (!enabled) return <div className={className}>{children}</div>;

  return (
    <div className={clsx('relative overflow-hidden', className)}>
      <div className="absolute inset-y-0 left-0 flex w-[88px] items-stretch">
        <button
          type="button"
          className="flex w-full flex-col items-center justify-center gap-1 bg-bad px-2 text-xs font-medium text-white"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            setOffset(0);
            onDelete();
          }}
        >
          <Trash2 className="size-4" aria-hidden />
          {label}
        </button>
      </div>
      <div
        ref={frontRef}
        className="relative bg-panel"
        style={{
          transform: `translateX(${offset}px)`,
          transition: live ? 'none' : 'transform 160ms ease',
          touchAction: 'pan-y',
        }}
        onTouchStart={(e) => onPointerDown(e.touches[0]!.clientX, e.touches[0]!.clientY)}
        onTouchMove={(e) => {
          if (axis.current === 'h') e.preventDefault();
          onTouchMove(e.touches[0]!.clientX, e.touches[0]!.clientY);
        }}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          onPointerDown(e.clientX, e.clientY);
        }}
        onClickCapture={blockClick}
      >
        {children}
      </div>
    </div>
  );
}
