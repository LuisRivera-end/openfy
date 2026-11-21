import { AMBIENT, ambientFade, ambientMeanLuma, ambientScrim } from '../../shared/utils/ambient'
import { BIG_PICTURE } from '../../shared/utils/immersive'
import { audioBands } from './audio-reactivity'

/**
 * Fluid-artwork background. GLSL twin of the HLSL in desktop/Openfy.Windows/Graphics/ReactiveSurface.cs:
 * two warped, slowly counter-rotating samples of a 64×64 cover texture, graded so the colour always
 * fills the screen (shared/utils/ambient.ts), darkened only as much as text contrast needs.
 */
const vertexSource = `#version 300 es
out vec2 uv;
void main() { uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(uv * vec2(2, -2) + vec2(-1, 1), 0, 1); }`

const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D previousArt, currentArt, previewArt;
uniform vec4 previewRect, previewLook; // CSS rectangle; viewport width/height, radius, scrim (-1 disables)
uniform vec4 v, look, grading; // v=(phase,bass,mid,high) look=(aspect,mix,scrim,lyricsScrim) grading=(floor,ceiling,saturation,size)
in vec2 uv; out vec4 color;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + 1.), u.x), u.y); }
float fbm(vec2 p) { return noise(p) * .65 + noise(p * 2.03 + 17.1) * .35; }
vec2 spin(vec2 p, float a) { float s = sin(a), c = cos(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
vec3 tap(sampler2D art, vec2 at, float lod) { float res = grading.w / exp2(lod); vec2 x = at * res + .5, i = floor(x), f = x - i; f = f * f * (3. - 2. * f); return textureLod(art, (i + f - .5) / res, lod).rgb; }
vec3 sampleArt(sampler2D art, vec2 a, vec2 b) { return (tap(art, a, 2.) + tap(art, b, 3.)) * .5; }
vec3 grade(vec3 c) { float l = dot(c, vec3(.2126, .7152, .0722)); return clamp(mix(grading.x, grading.y, l) + (c - l) * grading.z, 0., 1.); }
void main() {
  vec2 p = (uv * 2. - 1.) * vec2(look.x, 1) / max(1., look.x * .8);
  float t = v.x, w = .62 + v.y * .45;
  p /= 1. + v.y * .05;
  vec2 q = p + w * (vec2(fbm(p * 1.3 + t * .11), fbm(p * 1.3 + vec2(5.2, 1.3) - t * .09)) - .5);
  q += w * .6 * (vec2(fbm(q * 2.1 - t * .07 + 3.7), fbm(q * 2.1 + t * .08 + 9.1)) - .5);
  vec2 a = spin(q, t * .07) / 1.6 * .5 + .5, b = spin(q, -t * .05 + 1.7) / 2.2 * .5 + .5;
  vec3 c = mix(sampleArt(previousArt, a, b), sampleArt(currentArt, a, b), look.y);
  c = grade(c) * (.96 + v.w * .08);
  c *= 1. - clamp(look.z + look.w * smoothstep(.15, .85, uv.x), 0., 1.);
  if (previewLook.w >= 0.) {
    vec2 d = abs(uv * previewLook.xy - previewRect.xy - previewRect.zw * .5) - previewRect.zw * .5 + previewLook.z;
    float edge = length(max(d, 0.)) + min(max(d.x, d.y), 0.) - previewLook.z;
    vec3 next = grade(sampleArt(previewArt, a, b)) * (.96 + v.w * .08) * (1. - previewLook.w);
    c = mix(c, next, 1. - smoothstep(-1., 1., edge));
  }
  c += (hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 19.19) - 1.) / 255.;
  color = vec4(clamp(c, 0., 1.), 1);
}`

export interface AmbientRenderer {
  setArtwork(pixels: Uint8ClampedArray, instant: boolean): void
  /** Eases over the Big Picture layout change (BIG_PICTURE.layoutMs) unless `instant`. */
  setLyricsScrim(value: number, instant?: boolean): void
  setActive(active: boolean): void
  setPreview(pixels: Uint8ClampedArray | null): void
  setPreviewRegion(rect: AmbientRect | null, radius?: number, frameTime?: number): void
  resize(): void
  dispose(): void
}
export interface AmbientRect { x: number; y: number; width: number; height: number }

/**
 * Device budget. Touch devices (iPhone, iPad) draw at most `maxFps` frames, with slower motion so the lower rate
 * still reads as smooth, and at `resolution` × CSS pixels: the image is soft by design, and this keeps the phone cool.
 * The shared grading and AMBIENT.motionSpeed stay as pinned by tests/fixtures/ambient-contract.json.
 */
export interface AmbientBudget { maxFps?: number; motion?: number; resolution?: number }
export const PHONE_AMBIENT: AmbientBudget = { maxFps: 30, motion: .7, resolution: .75 }

export function createAmbientRenderer(canvas: HTMLCanvasElement, onLost: () => void, budget: AmbientBudget = {}): AmbientRenderer | null {
  const context = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false })
  if (!context) return null
  const gl: WebGL2RenderingContext = context
  function compile(type: number, source: string) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source); gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader')
    return shader
  }
  let program: WebGLProgram
  try {
    program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program')
  } catch { return null }
  const uniform = (name: string) => gl.getUniformLocation(program, name)
  const location = { v: uniform('v'), look: uniform('look'), grading: uniform('grading'), previous: uniform('previousArt'), current: uniform('currentArt'), preview: uniform('previewArt'), previewRect: uniform('previewRect'), previewLook: uniform('previewLook') }
  const textures = [gl.createTexture()!, gl.createTexture()!, gl.createTexture()!]
  const size = AMBIENT.textureSize
  for (const texture of textures) upload(texture, new Uint8ClampedArray(size * size * 4).fill(40))
  function upload(texture: WebGLTexture, pixels: Uint8ClampedArray) {
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength))
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT)
  }

  let current = 0, fadeStart = -Infinity, scrim: number = AMBIENT.scrimMin, lyricsScrim = 0, active = false
  let scrimFrom = 0, scrimTo = 0, scrimStart = -Infinity
  let previewRect: AmbientRect | null = null, previewScrim = -1, previewRadius = 16
  let phase = 0, speed = 0, last = 0, frame = 0, disposed = false, lost = false
  // A small tolerance keeps 30 FPS on a 60 Hz display at exactly every other refresh.
  const interval = budget.maxFps ? 1000 / budget.maxFps - 2 : 0, motion = budget.motion ?? 1
  function draw(now: number) {
    frame = 0
    if (disposed || lost) return
    if (interval && last && now - last < interval) { schedule(); return }
    const dt = last ? Math.min(.1, Math.max(0, (now - last) / 1000)) : 0; last = now
    const bands = active ? audioBands() : { bass: 0, mid: 0, high: 0 }
    speed += ((active ? 1 : 0) - speed) * (1 - Math.exp(-dt / .6))
    phase += dt * speed * AMBIENT.motionSpeed * motion * (1 + bands.mid * .6)
    const mix = ambientFade((now - fadeStart) / 1000)
    const scrimT = Math.min(1, Math.max(0, (now - scrimStart) / BIG_PICTURE.layoutMs))
    lyricsScrim = scrimFrom + (scrimTo - scrimFrom) * scrimT * scrimT * (3 - 2 * scrimT)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textures[current ^ 1]!); gl.uniform1i(location.previous, 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, textures[current]!); gl.uniform1i(location.current, 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, textures[2]!); gl.uniform1i(location.preview, 2)
    const rect = previewRect
    gl.uniform4f(location.previewRect, rect?.x ?? 0, rect?.y ?? 0, rect?.width ?? 0, rect?.height ?? 0)
    gl.uniform4f(location.previewLook, canvas.clientWidth, canvas.clientHeight, previewRadius, rect ? previewScrim : -1)
    gl.uniform4f(location.v, phase, bands.bass, bands.mid, bands.high)
    gl.uniform4f(location.look, canvas.width / Math.max(1, canvas.height), mix, scrim, lyricsScrim)
    gl.uniform4f(location.grading, AMBIENT.lumaFloor, AMBIENT.lumaCeiling, AMBIENT.saturation, size)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    // Keep animating while playing, while a cross-fade runs, or while the motion eases to a stop.
    if (active || mix < 1 || scrimT < 1 || speed > .002) schedule()
    else last = 0
  }
  const schedule = () => { if (!frame && !disposed && !lost) frame = requestAnimationFrame(draw) }
  const onContextLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; onLost() }
  canvas.addEventListener('webglcontextlost', onContextLost)

  return {
    setArtwork(pixels, instant) {
      current ^= 1
      upload(textures[current]!, pixels)
      scrim = ambientScrim(ambientMeanLuma(pixels))
      fadeStart = instant ? -Infinity : performance.now()
      schedule()
    },
    setLyricsScrim(value, instant = false) {
      if (value === scrimTo) return
      scrimFrom = instant ? value : lyricsScrim; scrimTo = value; scrimStart = instant ? -Infinity : performance.now()
      if (instant) lyricsScrim = value
      schedule()
    },
    setActive(value) { active = value; schedule() },
    setPreview(pixels) {
      if (pixels) { gl.activeTexture(gl.TEXTURE2); upload(textures[2]!, pixels); previewScrim = ambientScrim(ambientMeanLuma(pixels)) }
      else previewScrim = -1
      schedule()
    },
    setPreviewRegion(rect, radius = 16, frameTime) {
      previewRect = rect; previewRadius = radius
      if (frameTime === undefined) schedule()
      else {
        // The card is already in a frame callback. Paint its region in the same frame.
        cancelAnimationFrame(frame); draw(frameTime)
      }
    },
    resize() {
      const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight)
      // The image is deliberately soft: half the device resolution, capped like the native 1280×720.
      const scale = Math.min(budget.resolution ?? .5 * (window.devicePixelRatio || 1), 1280 / width, 720 / height)
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
      schedule()
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      for (const texture of textures) gl.deleteTexture(texture)
      gl.deleteProgram(program)
    }
  }
}
