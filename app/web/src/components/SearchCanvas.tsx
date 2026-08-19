import { useCallback, useRef, type ReactNode } from "react";

/**
 * The search home's background: a ruled field, and a badger in the corner
 * that fills in under the pointer.
 *
 * Two effects, one listener, and both are about the same idea — the page is a
 * surface you are standing on rather than a form you are filling in.
 *
 * **The field.** A faint grid across the whole canvas, weighted toward the
 * bottom-right so the corner the badger occupies reads as ground. A second,
 * firmer copy of the same grid is revealed in a circle around the pointer,
 * and the single cell under the pointer is highlighted — snapped to the
 * ruling, not tracking the cursor freely. The snap is what makes it read as a
 * surface: a glow that follows the mouse exactly reads as a light, while a
 * cell that jumps between gridlines reads as a floor being lit.
 *
 * **The badger.** At rest it is a hairline outline, nothing more. On hover
 * its own ink fills in, masked to a soft circle at the pointer — so the
 * outline is the drawing and the fill is how much of it you have uncovered.
 * The fill layer IS the badger, masked; paint can never appear where the
 * animal is not.
 *
 * It shrinks with viewport HEIGHT rather than width, and disappears below
 * 640px. The search box is vertically centred, so height is the axis on which
 * the two would collide.
 *
 * Coordinates are written as CSS custom properties rather than into React
 * state on purpose: this fires on every pointer move, and a setState per move
 * would re-render the whole screen sixty times a second to move two gradients.
 */
export function SearchCanvas({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    const corner = cornerRef.current;
    const cell = cellRef.current;
    if (!canvas) return;

    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    canvas.style.setProperty("--gx", `${x}px`);
    canvas.style.setProperty("--gy", `${y}px`);

    // The cell snaps to the ruling. CELL must match --cell in index.css.
    const CELL = 64;
    if (cell) {
      cell.style.transform = `translate(${Math.floor(x / CELL) * CELL}px, ${
        Math.floor(y / CELL) * CELL
      }px)`;
    }

    // The fill's mask is positioned in the badger's own box, not the canvas's,
    // so it lines up with the drawing rather than with the page.
    if (corner) {
      const c = corner.getBoundingClientRect();
      corner.style.setProperty("--mx", `${event.clientX - c.left}px`);
      corner.style.setProperty("--my", `${event.clientY - c.top}px`);
    }
  }, []);

  return (
    <div ref={canvasRef} className="badger-canvas" onPointerMove={onPointerMove}>
      <div className="badger-grid" aria-hidden="true" />
      <div className="badger-grid-hot" aria-hidden="true" />
      <div ref={cellRef} className="badger-cell" aria-hidden="true" />

      <div ref={cornerRef} className="badger-corner" aria-hidden="true">
        <svg className="badger-outline" viewBox="-31 -30 66 32">
          <Strokes />
        </svg>
        <div className="badger-fill">
          <svg className="badger-edge" viewBox="-31 -30 66 32">
            <Strokes />
          </svg>
          <svg className="badger-body" viewBox="-31 -30 66 32">
            <defs>
              <clipPath id="badgerFieldHead">
                <path d="M32.2 -16.2 L28.5 -18.6 L24 -22 L18.5 -23.4 L17 -16.5 L19 -14.6 L26.5 -13.4 L32.6 -13.2 Z" />
              </clipPath>
            </defs>
            <g fill="currentColor">
              <Paths />
            </g>
            {/* The face stripe, punched out of the fill so the head still
                reads once it is inked in. */}
            <g clipPath="url(#badgerFieldHead)" fill="#fff">
              <rect
                x="18.4"
                y="-19.6"
                width="13.2"
                height="2.2"
                rx="1.1"
                transform="rotate(31 25 -18.5)"
              />
            </g>
          </svg>
        </div>
      </div>

      {/* `pointer-events-none` on the wrapper, restored on the column: the
          badger and the field must stay reachable in the space around the
          search box, or the effect dies wherever the centred content happens
          to be. */}
      <div className="pointer-events-none relative flex h-full flex-col items-center justify-center px-6 pb-14">
        <div className="pointer-events-auto w-full max-w-[640px]">{children}</div>
      </div>
    </div>
  );
}

/** The drawing, as outline. Same geometry as the filled version. */
function Strokes() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <Paths />
    </g>
  );
}

/**
 * The badger, standing. One definition, rendered three times — as the resting
 * outline, as the sharpened edge under the fill, and as the fill itself.
 * Duplicating the path data across those three was the obvious way to write
 * this and the obvious way for them to drift apart.
 */
function Paths() {
  return (
    <>
      <g transform="translate(-14,-10) rotate(8)">
        <path d="M-4.2 0 L4.2 0 L3.4 8.8 L5.4 11.8 L-2.2 11.8 L-3.6 8.8 Z" />
      </g>
      <g transform="translate(9,-10) rotate(-8)">
        <path d="M-4.2 0 L4.2 0 L3.4 8.8 L5.4 11.8 L-2.2 11.8 L-3.6 8.8 Z" />
      </g>
      <g transform="translate(-7.5,-10) rotate(-8)">
        <path d="M-4.2 0 L4.2 0 L3.4 8.8 L5.4 11.8 L-2.2 11.8 L-3.6 8.8 Z" />
      </g>
      <g transform="translate(15.5,-10) rotate(8)">
        <path d="M-4.2 0 L4.2 0 L3.4 8.8 L5.4 11.8 L-2.2 11.8 L-3.6 8.8 Z" />
      </g>
      <path d="M-18 -25.4 L-27.5 -27 L-19.5 -19.4 Z" />
      <path d="M32.2 -16.2 L28.5 -18.6 L24 -22 L18.5 -23.4 L12 -25.8 L-10 -27.8 L-18 -25.2 L-21 -18.5 L-16 -10.8 L8 -11.4 L14 -13.4 L19 -14.8 L26.5 -13.4 L32.6 -13.2 Z" />
      <path d="M20.6 -23 L19 -26.9 L16.2 -23.6 Z" />
    </>
  );
}
