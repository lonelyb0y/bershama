'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A signature pad that produces a real signature, not a typed name.
 *
 * ── why canvas rather than an SVG polyline ──────────────────────────────────
 *
 * The output has to be a bitmap. `toDataURL('image/png')` gives a small, immutable
 * blob that can be stored inline on the proof row, which is where it belongs: a
 * signature that lives in Storage can be orphaned from the delivery it evidences,
 * and proof-of-delivery data that is separable from the delivery is not evidence.
 *
 * ── why the meaning is a separate required field ─────────────────────────────
 *
 * The pad captures a mark. It cannot know what the mark means, and "received in
 * good condition" and "received, one carton short" are the same gesture and
 * completely different facts. So the caller asks for the meaning separately, and
 * api.complete_stop refuses a signature with no stated meaning. That is GDP
 * e-signature practice rather than caution: a signature without a declared meaning
 * attests to nothing specific.
 *
 * ── touch, and the hand that is holding the phone ────────────────────────────
 *
 * `touch-action: none` on the canvas, and pointer events rather than mouse events,
 * because a signature is taken on a phone in a van. A pad that scrolls the page
 * under the driver's finger produces a signature with a page-scroll in it, which
 * then fails to match what the recipient believes they drew.
 */
export function SignaturePad({
  name,
  clearLabel,
  requiredHint,
  signedHint,
  onChange,
}: {
  name: string;
  clearLabel: string;
requiredHint: string;
    /** Shown once there is ink, so an empty pad is visibly not a signature yet. */
    signedHint?: string;
  /** Emits a data URL, or null when the pad is cleared. */
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [signatureValue, setSignatureValue] = useState<string | null>(null);
  const hasInkRef = useRef(false);

  // Mirrored into state so the hidden input re-renders when the pad emits.
  const emit = useCallback(
    (value: string | null) => {
      setSignatureValue(value);
      onChange(value);
    },
    [onChange],
  );

  // Sized in an effect, not in JSX: the canvas needs its CSS box before its backing
  // store can be set, and reading a layout property during render is what causes
  // the classic "canvas is 0x0 on first paint" bug.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'currentColor';
  }, []);

  const pointFrom = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const start = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      drawing.current = true;
      last.current = pointFrom(event);
    },
    [pointFrom],
  );

  const move = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current || !last.current) return;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;

      const next = pointFrom(event);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();

      last.current = next;
      if (!hasInkRef.current) {
        hasInkRef.current = true;
        setHasInk(true);
      }
    },
    [pointFrom],
  );

  const end = useCallback(() => {
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (!canvas || !hasInkRef.current) return;
    // Emitted on pointer-up rather than on every stroke: a signature is a few
    // hundred bytes and a van's battery should not pay for sixty encodes.
    emit(canvas.toDataURL('image/png'));
  }, [emit]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    setHasInk(false);
    emit(null);
  }, [emit]);

  return (
    <div className="space-y-2">
      {/* The data URL travels in a hidden input beside the canvas, not on it:
          `name` is not a canvas attribute, and a value on the element would not be
          submitted anyway. */}
      <input type="hidden" name={name} value={signatureValue ?? ''} readOnly />
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={requiredHint}
        data-testid="signature-canvas"
        className="h-32 w-full touch-none rounded-lg border border-current/20 bg-white text-black dark:bg-neutral-900 dark:text-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-current/60">{hasInk && signedHint ? signedHint : requiredHint}</span>
        <button
          type="button"
          onClick={clear}
          className="rounded border px-2 py-1 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {clearLabel}
        </button>
      </div>
    </div>
  );
}