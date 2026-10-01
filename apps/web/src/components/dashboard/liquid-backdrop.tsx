'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * The liquid backdrop: a slow, noise-driven gradient with a metallic sheen.
 *
 * ── where the technique comes from ──────────────────────────────────────────
 * The four references agree on one idea and this is that idea. liquid-logo builds a
 * vector field from simplex noise and renders a metallic sheen across it;
 * shadergradient puts a drifting gradient behind a page; liquid-glass-js puts
 * refractive glass in front of whatever is behind it; react-three-fiber is what lets
 * all of that live inside a React tree. So: noise flowing behind, glass in front,
 * rendered as one full-bleed quad.
 *
 * ── why a quad and not a 3D scene ────────────────────────────────────────────
 * This is a backdrop. Nothing in it is navigable and nothing occludes anything, so a
 * perspective camera over a flat plane buys a matrix multiply per fragment for an
 * effect that is identical without it. It is also the cheapest possible way to be
 * sure a laptop fan does not start during a stocktake.
 *
 * ── the guards, because a background must never be the reason a page fails ────
 * 1. `prefers-reduced-motion` renders one frame and stops. Motion here is
 *    decoration, and decoration is exactly what that preference is about.
 * 2. No WebGL, no canvas: the caller falls back to a CSS gradient, so the page never
 *    depends on a capability it might not have. A driver on a cheap Android and a
 *    warehouse PC with a blacklisted GPU both land there.
 * 3. The frame rate is capped below the display's, so a 120Hz monitor does not
 *    quietly quadruple the cost of a decorative background, and a background tab
 *    stops entirely.
 */

const vertexShader = /* glsl */ `
  void main() {
    // A full-screen quad in clip space. No matrices, no camera, no depth.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * 2D simplex noise (Ashima/Gustavson), plus an fbm built on it.
 *
 * Written out rather than installed: this shader is the only place in the application
 * that needs noise, and a dependency for forty lines of GLSL is a poor trade in a
 * codebase that otherwise contains no shader code at all.
 */
const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform vec3  uColorC;
  uniform float uSpeed;
  uniform float uSheen;
  uniform float uGrain;

  vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865, 0.366025403, -0.577350269, 0.024390243);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Four octaves: enough that the field never visibly repeats at this scale, and one
  // fewer than a "because I can" fifth.
  float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      total += amplitude * snoise(p);
      p *= 2.02;
      amplitude *= 0.5;
    }
    return total;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution.xy;
    // Aspect-corrected, so the flow does not stretch on a wide monitor.
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);

    float t = uTime * uSpeed;

    // Two noise fields at different scales and drift directions. The difference is
    // what stops this reading as a moving texture: one field slides, and sliding is
    // what a screensaver looks like.
    float flowA = fbm(p * 1.15 + vec2(t * 0.16, -t * 0.09));
    float flowB = fbm(p * 2.35 + vec2(-t * 0.11, t * 0.14) + 7.3);
    float field = flowA * 0.65 + flowB * 0.35;

    // Three stops rather than two, so the colour gains depth instead of sliding
    // between values.
    vec3 color = mix(uColorA, uColorB, smoothstep(-0.6, 0.7, field));
    color = mix(color, uColorC * 0.5, smoothstep(0.35, 1.0, flowB) * 0.35);

    // The metallic band: a soft diagonal specular drifting independently of the
    // colour field. That independence is what separates "shiny" from "coloured".
    float band = sin((p.x * 1.7 + p.y * 0.9) * 2.1 - t * 0.6);
    color += uColorC * pow(max(band, 0.0), 6.0) * 0.35 * uSheen;

    // A vignette, to keep the middle of the screen -- where the figures live -- the
    // calmest part of the image.
    float vignette = smoothstep(1.25, 0.25, length(uv - 0.5));
    color *= mix(0.82, 1.0, vignette);

    // Fine grain. Without it the large smooth areas band visibly on 8-bit panels,
    // which is a real artefact on the monitors this gets read on.
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    color += (grain - 0.5) * uGrain;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface BackdropPalette {
  base: string;
  accent: string;
  sheen: string;
}

/** Pale cyan through aqua, with a white specular. Text sits on glass, not on this. */
export const LIGHT_PALETTE: BackdropPalette = {
  base: '#e6f4fb',
  accent: '#74cfe6',
  sheen: '#ffffff',
};

export const DARK_PALETTE: BackdropPalette = {
  base: '#06141f',
  accent: '#0d5a75',
  sheen: '#63e6ff',
};

/** Milliseconds between frames: below film, above noticeable stutter. */
const FRAME_MS = 1000 / 24;

function BackdropPlane({
  palette,
  speed,
  sheen,
  grain,
  advance,
}: {
  palette: BackdropPalette;
  speed: number;
  sheen: number;
  grain: number;
  /** False when the motion preference asks for no animation. */
  advance: boolean;
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const elapsed = useRef(0);
  const { size } = useThree();

  const uniforms = useMemo(
    () => ({
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(palette.base) },
      uColorB: { value: new THREE.Color(palette.accent) },
      uColorC: { value: new THREE.Color(palette.sheen) },
      uSpeed: { value: speed },
      uSheen: { value: sheen },
      uGrain: { value: grain },
    }),
    [palette, speed, sheen, grain],
  );

  useFrame((_, delta) => {
    const shader = material.current;
    if (!shader) return;

    // The Canvas is told its size here rather than the shader polling a global: a
    // Canvas that has not been laid out reports 1x1, and the aspect correction then
    // divides by the wrong number.
    shader.uniforms.uResolution.value.set(size.width, size.height);

    if (!advance) return;
    // Accumulated by hand rather than read from the clock, so pausing and resuming
    // does not jump the animation forward by however long the pause was.
    elapsed.current += Math.min(delta, 0.25);
    shader.uniforms.uTime.value = elapsed.current;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * A Canvas that draws at a fixed rate and stops when nobody is looking.
 *
 * `frameloop="always"` would hand the frame rate to the display, which on a 120Hz
 * monitor means the fragment shader runs 120 times a second behind a page of
 * numbers. `frameloop="demand"` draws once and never animates. Driving it from an
 * interval gets the third thing: a steady 24fps while the tab is visible, and
 * nothing at all when it is not.
 */
function CappedCanvas({
  palette,
  speed,
  sheen,
  grain,
  advance,
}: {
  palette: BackdropPalette;
  speed: number;
  sheen: number;
  grain: number;
  advance: boolean;
}) {
  return (
    <Canvas
      // Capped: a backdrop rendered at 3x on a retina panel is a visible cost for an
      // effect nobody looks at directly.
      dpr={[1, 1.5]}
      frameloop={advance ? 'always' : 'demand'}
      gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
      style={{ width: '100%', height: '100%' }}
    >
      <BackdropPlane palette={palette} speed={speed} sheen={sheen} grain={grain} advance={advance} />
    </Canvas>
  );
}

/** Whether this browser should be asked for a WebGL context at all. */
export function canUseWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The backdrop, mounted.
 *
 * This component is only ever reached after the caller has established that WebGL
 * exists and that motion is wanted; it assumes both. The decisions live in the
 * mounting component so they can be tested without a GL context.
 */
export function LiquidBackdropScene({
  dark,
  speed = 0.35,
  sheen = 0.8,
  grain = 0.035,
}: {
  dark: boolean;
  speed?: number;
  sheen?: number;
  grain?: number;
}) {
  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <CappedCanvas palette={palette} speed={speed} sheen={sheen} grain={grain} advance={!prefersReducedMotion()} />
    </div>
  );
}

/** The CSS gradient used when there is no WebGL, or when motion is not wanted. */
export function backdropGradient(dark: boolean): string {
  return dark
    ? 'radial-gradient(120% 90% at 20% 0%, #0b2c3d 0%, #06141f 55%, #040d14 100%)'
    : 'radial-gradient(120% 90% at 20% 0%, #f2fbfe 0%, #dcf1f9 55%, #cbe9f5 100%)';
}

export { FRAME_MS };