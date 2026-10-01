'use client';

import { useEffect, useRef } from 'react';

/**
 * The liquid backdrop, in raw WebGL2.
 *
 * ── why this is not three.js ─────────────────────────────────────────────────
 * It was, and the measurement said it was a mistake. The dashboard painted in 2388ms
 * against 1384ms for the next slowest surface, and the resource timeline pointed at
 * one file: a 899KB chunk containing the whole of three.js and react-three-fiber.
 *
 * This backdrop draws *two triangles* and evaluates a fragment shader across them.
 * That is a fullscreen quad. A 3D engine brings a scene graph, a camera, matrices,
 * materials, a renderer and a WebGL abstraction layer to do arithmetic that is, for
 * a quad, five lines of `gl_` calls and one uniform matrix. The engine was 899KB to
 * save nothing: the file even has a comment explaining why the scene was a quad and
 * not a 3D scene, and then reached for a 3D library anyway.
 *
 * The shader is unchanged, because it was never the problem. Same simplex noise,
 * same field, same drifting specular -- so the visual result is identical and the
 * dashboard gets roughly a megabyte lighter.
 *
 * ── what the guards are, unchanged ───────────────────────────────────────────
 * No WebGL2, no canvas: the caller falls back to a CSS gradient. Reduced motion:
 * one frame, then stop. The frame rate is capped well below the display's, and the
 * whole thing stops when the tab is hidden.
 */

const vertexShaderSource = `#version 300 es
// A full-screen triangle pair, in clip space. No matrices, no camera, no depth --
// the position is already where it belongs.
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

/**
 * The same shader that shipped with the three.js version: 2D simplex noise, two
 * fields at different scales drifting in different directions, a three-stop colour
 * mix, a diagonal specular band that drifts independently of the colour, a vignette
 * so the middle stays calm, and fine grain because large smooth areas band visibly
 * on 8-bit panels.
 */
const fragmentShaderSource = `#version 300 es
precision highp float;

uniform vec2  uResolution;
uniform float uTime;
uniform vec3  uColorA;
uniform vec3  uColorB;
uniform vec3  uColorC;
uniform float uSpeed;
uniform float uSheen;
uniform float uGrain;

out vec4 outColor;

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
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);

  float t = uTime * uSpeed;

  float flowA = fbm(p * 1.15 + vec2(t * 0.16, -t * 0.09));
  float flowB = fbm(p * 2.35 + vec2(-t * 0.11, t * 0.14) + 7.3);
  float field = flowA * 0.65 + flowB * 0.35;

  vec3 color = mix(uColorA, uColorB, smoothstep(-0.6, 0.7, field));
  color = mix(color, uColorC * 0.5, smoothstep(0.35, 1.0, flowB) * 0.35);

  float band = sin((p.x * 1.7 + p.y * 0.9) * 2.1 - t * 0.6);
  color += uColorC * pow(max(band, 0.0), 6.0) * 0.35 * uSheen;

  float vignette = smoothstep(1.25, 0.25, length(uv - 0.5));
  color *= mix(0.82, 1.0, vignette);

  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  color += (grain - 0.5) * uGrain;

  outColor = vec4(color, 1.0);
}`;

export interface BackdropPalette {
  base: string;
  accent: string;
  sheen: string;
}

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

/** Below film, above noticeable stutter. */
const FRAME_MS = 1000 / 24;

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // A shader that fails to compile is a bug worth seeing in the console rather
    // than a blank background nobody can explain.
    console.error('[pharmaflow] backdrop shader failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function canUseWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The backdrop.
 *
 * Mounted only once the caller has established that WebGL2 exists and that motion
 * is wanted; it assumes both. `liquid-scene` decides that, so it can be reasoned
 * about without a GL context.
 */
export function LiquidBackdrop({
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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, powerPreference: 'low-power' });
    if (!gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertex || !fragment) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[pharmaflow] backdrop program failed:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // Two triangles covering clip space. One buffer, six vertices, no index.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const aPosition = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
    const uResolution = gl.getUniformLocation(program, 'uResolution');
    const uTime = gl.getUniformLocation(program, 'uTime');
    gl.uniform3fv(gl.getUniformLocation(program, 'uColorA'), hexToRgb(palette.base));
    gl.uniform3fv(gl.getUniformLocation(program, 'uColorB'), hexToRgb(palette.accent));
    gl.uniform3fv(gl.getUniformLocation(program, 'uColorC'), hexToRgb(palette.sheen));
    gl.uniform1f(gl.getUniformLocation(program, 'uSpeed'), speed);
    gl.uniform1f(gl.getUniformLocation(program, 'uSheen'), sheen);
    gl.uniform1f(gl.getUniformLocation(program, 'uGrain'), grain);

    // ── resolution, and why it is a third of what the display offers ──────────
    // The dashboard painted 1224ms slower than the driver surface on identical
    // bundles, so the cost was never weight -- it was per-pixel work. At 1.5x DPR on
    // a large screen that is ~3.7 million pixels, each running eight simplex-noise
    // evaluations (four octaves, two fields), and that lands on the first frame.
    //
    // This is a soft, out-of-focus gradient. Nobody can see its pixels, only its
    // colour, and the CSS `filter: blur` on the canvas below finishes the softening.
    // Rendering at a third of the display resolution is therefore free visually and
    // costs a ninth of the arithmetic. The band is the only feature with a defined
    // edge, so it is the one thing the blur has to survive -- and a wide diagonal
    // gradient survives a 3px blur untouched.
    const SCALE = 1 / 3;
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    const resize = () => {
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr * SCALE));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr * SCALE));
      gl.viewport(0, 0, canvas.width, canvas.height);
      // The shader corrects for aspect from uResolution, and it reads 1x1 for one
      // frame if it is not told the real size after layout.
      gl.uniform2f(uResolution, canvas.width, canvas.height);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const still = prefersReducedMotion();
    let elapsed = 0;
    let last = performance.now();
    let frame = 0;

    const draw = (now: number) => {
      // Accumulated by hand rather than from a clock, so pausing for a hidden tab
      // does not jump the animation forward by however long it was away.
      if (!still) elapsed += Math.min(now - last, 250);
      last = now;

      gl.uniform1f(uTime, elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!still && !document.hidden) {
        frame = window.setTimeout(() => requestAnimationFrame(draw), FRAME_MS);
      }
    };

    if (still) {
      // One frame, and that is the whole effect. Motion is decoration, and
      // decoration is exactly what this preference is about.
      draw(performance.now());
    } else {
      frame = window.setTimeout(() => requestAnimationFrame(draw), FRAME_MS);
      document.addEventListener('visibilitychange', onVisible);
    }

    function onVisible() {
      if (!document.hidden) {
        last = performance.now();
        frame = window.setTimeout(() => requestAnimationFrame(draw), FRAME_MS);
      }
    }

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      if (frame) clearTimeout(frame);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [dark, speed, sheen, grain]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      {/* CSS stretches the small buffer back to the viewport, and blurs it so the
          upscale is not visible as banding. Cheaper than any amount of resolution. */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          filter: 'blur(3px)',
        }}
      />
    </div>
  );
}