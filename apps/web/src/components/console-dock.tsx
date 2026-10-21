'use client';

/**
 * The console dock.
 *
 * ── what it is ────────────────────────────────────────────────────────────────
 *
 * An Apple-style magnification dock along the bottom of the admin console: the
 * icons nearest the pointer grow, and a label rises above the one you are on.
 *
 * ── why it is on the console and not everywhere ───────────────────────────────
 *
 * A magnification dock is a MOUSE affordance. It does nothing on a touch
 * screen, and a phone in a cold store is where most of this product is used. So
 * it is desktop-only, and on the console -- the one place a person sits at a
 * desk with a pointer and a lot of destinations in their head.
 *
 * The driver surface, the pharmacy surface and the landing page do not get one.
 * The landing page is a marketing page, and the other two are phone surfaces.
 *
 * ── why the motion is the `motion` package and not CSS ────────────────────────
 *
 * The magnification is a spring that follows the pointer, and a spring that
 * follows a pointer cannot be CSS: there is no CSS transition that tracks a
 * moving target. `motion` is the current name for framer-motion and is
 * tree-shakeable; the whole dock is one lazy chunk, loaded only on the console.
 */

import {
  motion,
  MotionValue,
  useMotionValue,
  useSpring,
  useTransform,
  type SpringOptions,
  AnimatePresence,
} from 'motion/react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

const DEFAULT_MAGNIFICATION = 72;
const DEFAULT_DISTANCE = 140;
const DEFAULT_PANEL_HEIGHT = 56;

type DockProps = {
  children: React.ReactNode;
  className?: string;
  distance?: number;
  panelHeight?: number;
  magnification?: number;
  spring?: SpringOptions;
};

/** The props a dock item hands to its icon and its label. */
type DockItemContext = {
  width: MotionValue<number>;
  isHovered: MotionValue<number>;
};

type DockItemProps = {
  className?: string;
  children: React.ReactNode;
};

type DockLabelProps = {
  className?: string;
  children: React.ReactNode;
};

type DockIconProps = {
  className?: string;
  children: React.ReactNode;
};

type DockContextType = {
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  magnification: number;
  distance: number;
};

const DockContext = createContext<DockContextType | undefined>(undefined);

function useDock() {
  const context = useContext(DockContext);
  if (!context) {
    throw new Error('useDock must be used within a DockProvider');
  }
  return context;
}

export function Dock({
  children,
  className,
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
  panelHeight = DEFAULT_PANEL_HEIGHT,
}: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);

  const maxHeight = useMemo(
    () => Math.max(panelHeight, magnification + magnification / 2 + 4),
    [magnification, panelHeight],
  );

  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  return (
    <motion.div
      style={{ height, scrollbarWidth: 'none' }}
      className="mx-2 flex max-w-full items-end overflow-x-auto"
    >
      <motion.div
        onMouseMove={({ pageX }) => {
          isHovered.set(1);
          mouseX.set(pageX);
        }}
        onMouseLeave={() => {
          isHovered.set(0);
          mouseX.set(Infinity);
        }}
        className={cn(
          'mx-auto flex w-fit gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/92 px-3 backdrop-blur-lg',
          className,
        )}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label="Console quick navigation"
      >
        <DockProvider value={{ mouseX, spring, distance, magnification }}>
          {children}
        </DockProvider>
      </motion.div>
    </motion.div>
  );
}

function DockProvider({ children, value }: { children: React.ReactNode; value: DockContextType }) {
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

/**
 * The context an item's icon and label read.
 *
 * The reference implementation passed the motion values down as untyped props on
 * a cloned element, and read them back out of `...rest`. That works until
 * somebody reads `DockLabel`'s props and finds no `isHovered` on them. So the
 * values go through a context instead, and the props say what they are.
 */
const DockItemContext = createContext<DockItemContext | undefined>(undefined);

function useItemContext(): DockItemContext {
  const context = useContext(DockItemContext);
  if (!context) {
    throw new Error('DockIcon and DockLabel must be inside a DockItem');
  }
  return context;
}

export function DockItem({ children, className }: DockItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { distance, magnification, mouseX, spring } = useDock();

  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, (val) => {
    const domRect = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - domRect.x - domRect.width / 2;
  });

  const widthTransform = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [40, magnification, 40],
  );

  const width = useSpring(widthTransform, spring);

  return (
    <motion.div
      ref={ref}
      style={{ width }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      className={cn('relative inline-flex items-center justify-center', className)}
      tabIndex={0}
      role="button"
      aria-haspopup="true"
    >
      {/*
        The motion values go to the icon and the label through a context, not as
        props on a cloned element.

        The reference implementation cloned the child and handed it `width` and
        `isHovered` as untyped props, and the icon read them back out of
        `...rest`. That works right up until somebody reads DockLabel's props
        and finds no isHovered on them -- and then the type says the prop is
        required and the value is undefined, which is a runtime crash dressed as
        a type error.
      */}
      <DockItemContext.Provider value={{ width, isHovered }}>
        {children}
      </DockItemContext.Provider>
    </motion.div>
  );
}

export function DockLabel({ children, className }: DockLabelProps) {
  const { isHovered } = useItemContext();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = isHovered.on('change', (latest) => {
      setIsVisible(latest === 1);
    });
    return () => unsubscribe();
  }, [isHovered]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -10 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'absolute -top-6 left-1/2 w-fit whitespace-pre rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-0.5 text-xs text-[var(--text)]',
            className,
          )}
          role="tooltip"
          style={{ x: '-50%' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DockIcon({ children, className }: DockIconProps) {
  const { width } = useItemContext();
  const widthTransform = useTransform(width, (val) => val / 2);

  return (
    <motion.div
      style={{ width: widthTransform }}
      className={cn('flex items-center justify-center', className)}
    >
      {children}
    </motion.div>
  );
}

