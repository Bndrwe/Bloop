"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

export type ShaderSmokeOptions = {
  /**
   * Overall brightness, 0–1. The smoke itself sits mostly at 0–0.12 grey
   * with soft highlights up to ~0.3; this scales all of it. Default `0.5`.
   */
  intensity?: number
  /** Drift speed. `1` is a slow, dreamy drift. Default `1`. */
  speed?: number
  /** The pointer gently swirls and lifts the smoke near it. Default `true`. */
  interactive?: boolean
  /** Frame-rate cap, 1–60. Default `30`; it's slow smoke, more is wasted. */
  fps?: number
  /**
   * Stop drawing entirely (no animation frames at all) until set back to
   * `false`. For hosts that know they're hidden when the page can't tell,
   * e.g. a hidden Electron window that still reports `visible`.
   */
  paused?: boolean
}

export type ShaderSmokeInstance = {
  setOptions: (options: Partial<ShaderSmokeOptions>) => void
  destroy: () => void
}

export const DEFAULT_SMOKE_INTENSITY = 0.5
export const DEFAULT_SMOKE_SPEED = 1
export const DEFAULT_SMOKE_FPS = 30

const VERT = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAG = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_presence;
uniform float u_stir;
uniform float u_intensity;
uniform float u_frame;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Quintic gradient noise: smooth first derivatives, so the lit folds never crease.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i) * 6.2831853;
  float b = hash(i + vec2(1.0, 0.0)) * 6.2831853;
  float c = hash(i + vec2(0.0, 1.0)) * 6.2831853;
  float d = hash(i + vec2(1.0, 1.0)) * 6.2831853;
  float va = dot(vec2(cos(a), sin(a)), f);
  float vb = dot(vec2(cos(b), sin(b)), f - vec2(1.0, 0.0));
  float vc = dot(vec2(cos(c), sin(c)), f - vec2(0.0, 1.0));
  float vd = dot(vec2(cos(d), sin(d)), f - vec2(1.0, 1.0));
  return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
}

const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);

// Few octaves, steep falloff: the smoke should stay blurred, never grainy.
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    s += a * noise(p);
    p = ROT * p * 1.9 + vec2(1.7, 9.2);
    a *= 0.4;
  }
  return s;
}

vec2 rotate(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float unit = 1.0 / max(u_resolution.x, u_resolution.y);
  vec2 uv = frag / u_resolution;
  vec2 p = (frag - 0.5 * u_resolution) * unit * 1.4;
  vec2 m = (u_mouse - 0.5) * u_resolution * unit * 1.4;
  float t = u_time;

  // The pointer: a soft swirl that stirs the folds around it.
  vec2 d = p - m;
  float near = exp(-dot(d, d) / 0.045);
  p = m + rotate(d, (0.3 * u_presence + 0.8 * u_stir) * near);

  // Three levels of domain warp: slow currents, then the folds, then the silk.
  vec2 q = vec2(
    fbm(p * 0.8 + vec2(0.0, 0.6 * t)),
    fbm(p * 0.8 + vec2(5.2, 1.3) - vec2(0.45 * t, 0.0))
  );
  vec2 r = vec2(
    fbm(p + 1.9 * q + vec2(1.7, 9.2) + 0.25 * t),
    fbm(p + 1.9 * q + vec2(8.3, 2.8) - 0.2 * t)
  );
  vec2 w = p + 2.2 * r;
  float f = fbm(w);

  // Light the folds: the field's slope is a surface normal, lit from up-left.
  // A wide difference step keeps the shading soft.
  float e = 0.07;
  vec2 g = vec2(fbm(w + vec2(e, 0.0)) - f, fbm(w + vec2(0.0, e)) - f) / e;
  vec3 n = normalize(vec3(-g * 2.4, 1.0));
  vec3 L = normalize(vec3(-0.55, 0.65, 0.5));
  float lit = clamp(dot(n, L), 0.0, 1.0);

  // Smoke mass: where the warp piles up. Mostly a dim veil, with the
  // occasional lit crest.
  float mass = smoothstep(-0.4, 0.5, f + 0.5 * r.x);
  float crest = smoothstep(0.62, 1.0, lit) * mass;
  float lum = mass * (0.03 + 0.09 * lit) + 0.28 * crest * crest;

  // Calmer in the middle where content sits, a touch livelier at the edges.
  float edge = smoothstep(0.15, 0.75, length((uv - 0.5) * vec2(1.0, 1.15)));
  lum *= mix(0.75, 1.0, edge);

  // The pointer also lifts the smoke a hair.
  lum += 0.03 * u_presence * near * (0.5 + mass);

  // Soft knee: crests roll off toward 0.15 instead of clipping, so at the
  // default intensity the brightest smoke stays under ~0.075 grey and even
  // tertiary text (--g4) keeps AA contrast on top of it.
  float over = max(lum - 0.08, 0.0);
  lum -= over - over / (1.0 + over / 0.07);

  lum *= u_intensity;

  // Triangular dither, re-rolled each frame: low greys on 8 bits band badly.
  float h1 = hash(frag + u_frame * 13.1);
  float h2 = hash(frag.yx + 71.7 + u_frame * 7.3);
  lum += (h1 + h2 - 1.0) / 255.0;

  gl_FragColor = vec4(vec3(clamp(lum, 0.0, 1.0)), 1.0);
}
`

function isDev() {
  return import.meta.env.DEV
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function numberOr(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return clamp(value, min, max)
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (isDev()) {
      console.warn(
        "ShaderSmoke: shader failed to compile\n",
        gl.getShaderInfoLog(shader)
      )
    }
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/**
 * Backing-store scale in CSS px. The smoke is a blur anyway, so it renders at
 * half size and the browser's bilinear upscale softens it further.
 */
const RENDER_SCALE = 0.5
/** Most pixels we'll shade per frame. */
const MAX_PIXELS = 400_000

/**
 * Soft, slow smoke on black: domain-warped noise lit like folds of silk,
 * strictly achromatic and very dim. The pointer stirs it a little. Renders
 * at half resolution and at most 30fps; pauses off-screen, in hidden tabs
 * and when `paused`; holds a still frame under `prefers-reduced-motion`.
 * Recovers from a lost WebGL context.
 */
export function createShaderSmoke(
  canvas: HTMLCanvasElement,
  initial: ShaderSmokeOptions = {}
): ShaderSmokeInstance | null {
  let options: ShaderSmokeOptions = { interactive: true, ...initial }

  const mouse = { x: 0.62, y: 0.6 }
  const target = { x: 0.62, y: 0.6 }
  let presence = 0
  let presenceTarget = 0
  let stir = 0
  let stirKick = 0
  let lastPointer: { x: number; y: number } | null = null

  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  })
  if (!gl) return null

  let vs: WebGLShader | null = null
  let fs: WebGLShader | null = null
  let program: WebGLProgram | null = null
  let buf: WebGLBuffer | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uMouse: WebGLUniformLocation | null = null
  let uPresence: WebGLUniformLocation | null = null
  let uStir: WebGLUniformLocation | null = null
  let uIntensity: WebGLUniformLocation | null = null
  let uFrame: WebGLUniformLocation | null = null

  // Builds every GL resource. Runs at startup and again after a lost
  // context is restored, since a restore hands back a blank context.
  const initGl = () => {
    vs = compile(gl, gl.VERTEX_SHADER, VERT)
    fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs)
      if (fs) gl.deleteShader(fs)
      return false
    }
    program = gl.createProgram()
    if (!program) {
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      return false
    }
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (isDev()) {
        console.warn(
          "ShaderSmoke: program failed to link\n",
          gl.getProgramInfoLog(program)
        )
      }
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      return false
    }
    gl.useProgram(program)

    buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    const loc = gl.getAttribLocation(program, "a_position")
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const prog = program
    const u = (name: string) => gl.getUniformLocation(prog, name)
    uResolution = u("u_resolution")
    uTime = u("u_time")
    uMouse = u("u_mouse")
    uPresence = u("u_presence")
    uStir = u("u_stir")
    uIntensity = u("u_intensity")
    uFrame = u("u_frame")
    return true
  }
  if (!initGl()) return null

  // Returns true when the backing store changed.
  const resize = () => {
    const parent = canvas.parentElement
    if (!parent) return false
    const w = parent.clientWidth
    const h = parent.clientHeight
    if (w <= 0 || h <= 0) return false
    const ratio = Math.min(RENDER_SCALE, Math.sqrt(MAX_PIXELS / (w * h)))
    const width = Math.max(1, Math.round(w * ratio))
    const height = Math.max(1, Math.round(h * ratio))
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    wake()
    // Assigning a size clears the canvas, even the same size.
    if (width === canvas.width && height === canvas.height) return false
    canvas.width = width
    canvas.height = height
    gl.viewport(0, 0, canvas.width, canvas.height)
    return true
  }

  const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)")
  let onScreen = true
  let raf = 0
  let destroyed = false
  let lost = false
  let due = true
  let last = 0
  let lastDraw = 0
  let clock = 0
  let frame = 0

  const visible = () =>
    !options.paused && onScreen && document.visibilityState !== "hidden"
  const interactive = () => options.interactive !== false && !mqReduce.matches

  function wake() {
    // An observer callback can still arrive after destroy.
    if (raf || destroyed || lost) return
    last = performance.now()
    due = true
    raf = requestAnimationFrame(tick)
  }

  // Still easing toward the pointer, even with drift held still.
  const settling = () =>
    Math.abs(target.x - mouse.x) > 1e-3 ||
    Math.abs(target.y - mouse.y) > 1e-3 ||
    Math.abs(presenceTarget - presence) > 1e-3 ||
    stir > 1e-3 ||
    stirKick > 1e-3

  // An arrow, not a declaration, so TypeScript keeps `gl` narrowed inside.
  const tick = (now: number) => {
    raf = 0
    if (lost || !visible()) return
    const flowing = !mqReduce.matches
    const interval = 1000 / numberOr(options.fps, DEFAULT_SMOKE_FPS, 1, 60)
    // Between capped frames, just wait for the next one.
    if (!due && now - lastDraw < interval - 2) {
      raf = requestAnimationFrame(tick)
      return
    }
    due = false
    lastDraw = now
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
    last = now
    if (flowing) clock += dt
    frame = (frame + 1) % 64

    // Frame-rate independent easing; deliberately lazy.
    const ease = (rate: number) => 1 - Math.exp(-dt * rate)
    mouse.x += (target.x - mouse.x) * ease(1.6)
    mouse.y += (target.y - mouse.y) * ease(1.6)
    presence += (presenceTarget - presence) * ease(1.2)
    stir += (stirKick - stir) * ease(2.5)
    stirKick *= Math.exp(-dt * 0.9)
    if (stirKick < 1e-4) stirKick = 0
    if (stir < 1e-4 && stirKick === 0) stir = 0

    const speed = numberOr(options.speed, DEFAULT_SMOKE_SPEED, 0, 4)
    gl.uniform2f(uResolution, canvas.width, canvas.height)
    gl.uniform1f(uTime, clock * speed * 0.045 + 3.7)
    gl.uniform2f(uMouse, mouse.x, mouse.y)
    gl.uniform1f(uPresence, presence)
    gl.uniform1f(uStir, stir)
    gl.uniform1f(
      uIntensity,
      numberOr(options.intensity, DEFAULT_SMOKE_INTENSITY, 0, 1)
    )
    gl.uniform1f(uFrame, flowing ? frame : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    if (flowing || settling()) raf = requestAnimationFrame(tick)
  }

  /** Draws now: resizing cleared the canvas, and waiting would flash black. */
  const redraw = () => {
    if (destroyed || lost) return
    cancelAnimationFrame(raf)
    raf = 0
    last = performance.now()
    due = true
    tick(last)
  }

  const ro = new ResizeObserver(() => {
    if (resize()) redraw()
  })
  if (canvas.parentElement) ro.observe(canvas.parentElement)
  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? true
    wake()
  })
  io.observe(canvas)
  const onVisibility = () => wake()
  document.addEventListener("visibilitychange", onVisibility)
  const onReduce = () => {
    if (mqReduce.matches) {
      presenceTarget = 0
      stirKick = 0
    }
    wake()
  }
  mqReduce.addEventListener("change", onReduce)

  const onMove = (e: PointerEvent) => {
    if (!interactive()) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = (e.clientX - rect.left) / rect.width
    const y = 1 - (e.clientY - rect.top) / rect.height
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1
    presenceTarget = inside ? 1 : 0
    if (inside) {
      target.x = x
      target.y = y
      // Movement stirs; stillness lets it settle. Capped, so a fling is
      // still only a nudge.
      if (lastPointer) {
        const moved = Math.hypot(x - lastPointer.x, y - lastPointer.y)
        stirKick = Math.min(1, stirKick + moved * 1.6)
      }
      lastPointer = { x, y }
    } else {
      lastPointer = null
    }
    wake()
  }
  const onLeave = (e: MouseEvent) => {
    if (e.relatedTarget) return
    presenceTarget = 0
    lastPointer = null
    wake()
  }
  window.addEventListener("pointermove", onMove, { passive: true })
  document.addEventListener("mouseout", onLeave)

  // Without preventDefault the browser never restores a lost context.
  const onLost = (e: Event) => {
    e.preventDefault()
    lost = true
    cancelAnimationFrame(raf)
    raf = 0
  }
  const onRestored = () => {
    if (destroyed || !initGl()) return
    lost = false
    gl.viewport(0, 0, canvas.width, canvas.height)
    wake()
  }
  canvas.addEventListener("webglcontextlost", onLost)
  canvas.addEventListener("webglcontextrestored", onRestored)

  resize()
  wake()

  return {
    setOptions(next) {
      options = { ...options, ...next }
      if (!interactive()) {
        presenceTarget = 0
        stirKick = 0
      }
      // Intensity and the like change the still frame too.
      due = true
      wake()
    },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      raf = 0
      ro.disconnect()
      io.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      mqReduce.removeEventListener("change", onReduce)
      window.removeEventListener("pointermove", onMove)
      document.removeEventListener("mouseout", onLeave)
      canvas.removeEventListener("webglcontextlost", onLost)
      canvas.removeEventListener("webglcontextrestored", onRestored)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
      // Free the GPU context once the canvas has left the page. A canvas
      // still in the page (a React Strict Mode replay) keeps it.
      const lose = gl.getExtension("WEBGL_lose_context")
      queueMicrotask(() => {
        if (!canvas.isConnected && !gl.isContextLost()) lose?.loseContext()
      })
    },
  }
}

export type ShaderSmokeProps = ShaderSmokeOptions & {
  className?: string
}

/**
 * A barely-there background: slow grey smoke folding over black, stirred a
 * little by the pointer. Sits behind content (z-index 0, no pointer events).
 */
export function ShaderSmoke({
  className,
  intensity = DEFAULT_SMOKE_INTENSITY,
  speed = DEFAULT_SMOKE_SPEED,
  interactive = true,
  fps = DEFAULT_SMOKE_FPS,
  paused = false,
}: ShaderSmokeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instanceRef = useRef<ShaderSmokeInstance | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    instanceRef.current = createShaderSmoke(canvas, {
      intensity,
      speed,
      interactive,
      fps,
      paused,
    })
    return () => {
      instanceRef.current?.destroy()
      instanceRef.current = null
    }
    // Engine reads live options via setOptions; mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    instanceRef.current?.setOptions({ intensity, speed, interactive, fps, paused })
  }, [intensity, speed, interactive, fps, paused])

  return (
    <div
      data-slot="shader-smoke"
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black",
        className
      )}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  )
}
