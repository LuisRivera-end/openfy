# Reverse-Engineering Apple Motion: Architecture & Implementation Brief

**Target Stack:** GSAP 3.13+ (`ScrollTrigger`, `SplitText`) + Lenis Smooth Scroll + Modern CSS  
**Target Viewports:** Desktop (1440px+), Tablet (768px–1024px), Mobile (<768px)  
**Author:** Senior Motion Designer & Front-End Engineer  

---

## Executive Summary & Research Methodology

Apple’s product marketing pages are the benchmark for high-end consumer hardware and service launches. Their signature feel is characterized by buttery inertial physics, seamless scrollytelling, spatial depth, and micro-choreography.

### Methodology Note: Fact vs. Engineering Inference
* **Documented / Observed Web Facts:**
  * Apple does not use standard `<video>` scrubbing for frame-accurate reverse/forward interactive scroll timelines; they slice video renders into individual compressed frames (WebP/JPEG) drawn dynamically to an HTML5 `<canvas>` via `requestAnimationFrame`.
  * Typography utilizes fluid sizing via CSS `clamp()` paired with strict negative letter-spacing tracking curves on display sizes.
  * Motion curves rely on asymmetric cubic-bezier curves (fast acceleration, extended logarithmic deceleration).
* **Engineering Inferences (Marked as *[Inference]* throughout):**
  * Internal library structures: Apple utilizes custom internal vanilla frameworks (`ac-analytics`, `ac-canvas-animation`, custom scroll drivers). To achieve 1:1 behavioral parity on modern production stacks, this brief maps those patterns directly to **GSAP 3** (`ScrollTrigger`, `SplitText`) paired with **Lenis** virtual smoothing.
  * Exact timing calibrations, scrub smoothing ratios, and pixel distances are reverse-engineered deductions from frame-by-frame profiling on macOS Safari and Chrome.

---

## Technical Foundations: The Core Motion System

```
                  ┌─────────────────────────────────────────┐
                  │           Lenis Smooth Scroll           │
                  │   Virtual Scroll Physics & Momentum    │
                  └───────────────────┬─────────────────────┘
                                      │ lenis.on('scroll')
                                      ▼
                  ┌─────────────────────────────────────────┐
                  │       GSAP ScrollTrigger Pipeline       │
                  │   gsap.ticker.lagSmoothing(0) Sync      │
                  └───────┬─────────────────────────┬───────┘
                          │                         │
         Scrubbed Timelines                         Intersection Batches
         (Pinning, Text Sweeps,                     (Bento Grids, Hero Reveals,
          Canvas Frame Sequencing)                   Translucent Nav Headers)
```

### Global Timing & Easing Curves
Apple avoids standard browser `ease` or linear tweens. Interfaces mimic physical mass moving through a viscous fluid:

* **Primary Deceleration (The "Apple Settle"):**  
  `cubic-bezier(0.16, 1, 0.3, 1)` (GSAP equivalent: `power4.out`). Fast entry, long tail.
* **Standard Interactive Curve:**  
  `cubic-bezier(0.4, 0, 0.2, 1)` (GSAP equivalent: `power2.inOut`). Used for state transitions and UI toggles.
* **Subtle Hardware Spring:**  
  `cubic-bezier(0.25, 1, 0.5, 1)` (GSAP equivalent: `power3.out`). Used for cards and modals.

---

## 1. Hero Entrance Choreography

The hero entrance must resolve two conflicting goals: instant brand impact and graceful asynchronous asset hydration.

```
Time (ms)  0ms       200ms     400ms           800ms           1200ms        1600ms
Eyebrow    ├─────────► (Fade/Slide Y: 15px -> 0, 600ms)
Headline             ├─────────────────────────► (SplitText Words Masked, 1000ms)
Subtitle                       ├────────────────────────► (Fade/Slide Y: 25px -> 0, 800ms)
Hardware                               ├─────────────────────────────► (Scale: 0.92->1, Y: 80->0)
Glow/Amb                                       ├─────────────────────────────► (Opacity: 0->0.6)
```

### Spatial & Timing Specifications
* **Choreography Sequence:**
  1. **Eyebrow Category Label:** Starts at `t = 0ms`. Duration: `0.6s`. Offset: `y: 15px -> 0`. Opacity: `0 -> 1`.
  2. **Monolithic Headline:** Starts at `t = 200ms`. Duration: `1.0s` per line/word. Stagger: `0.06s` between words. Offset: `y: 100% -> 0%` using overflow-hidden wrapper masks. Ease: `power4.out`.
  3. **Sub-headline & CTAs:** Starts at `t = 400ms`. Duration: `0.8s`. Offset: `y: 25px -> 0`. Opacity: `0 -> 1`.
  4. **Product Elevation (Hardware Render):** Starts at `t = 350ms`. Duration: `1.4s`. Initial transform: `scale(0.92)` and `translateY(80px)`. Final: `scale(1.0)` and `translateY(0px)`. Ease: `power3.out`.
  5. **Atmospheric Background (Radial Glow):** Starts at `t = 500ms`. Duration: `1.8s`. Scale: `0.8 -> 1.05`. Opacity: `0 -> 0.5`.
* **Typography Formula (CSS Fluid Type):**
  * *Headline:* `font-size: clamp(2.75rem, 1.25rem + 5vw, 6.5rem);` (44px at 320px viewport, 104px at 1440px+).
  * *Letter-spacing:* `-0.035em` (tight tracking prevents loose words at large display scales).
  * *Line-height:* `1.04`.
  * *Eyebrow:* `font-size: clamp(0.875rem, 0.8rem + 0.35vw, 1.125rem); letter-spacing: 0.02em; text-transform: uppercase;`.

---

## 2. Pinned "Scrollytelling" Sequences

When showcasing an industrial design feature (e.g. chassis internal layout or titanium rail framing), Apple locks the hardware at viewport center while the narrative unfolds across multiple virtual screen heights.

```
Scroll Track (Total Runway = 400vh)
0vh ────────────── 100vh ────────────── 200vh ────────────── 300vh ────────────── 400vh
[ Step 1 Copy ]    [ Step 2 Copy ]      [ Step 3 Copy ]      [ Step 4 Copy ]
[ Canvas Fr 0-30]  [ Canvas Fr 31-75]   [ Canvas Fr 76-120]  [ Canvas Fr 121-160]
───────────────────────────────────────────────────────────────────────────────────────
|<- Stage In ->|   |<-- Crossfade 1 -->|  |<-- Crossfade 2 -->|  |<-- Stage Exit ->|
```

### Motion Calibration & Mechanics
* **Pin Runway Length:** Exactly `400vh` for a 4-step narrative (*[Inference]*: ~`100vh` per narrative beat allows readable reading speed without excessive finger swiping).
* **Scrub Inertia (`scrub: 0.6` to `scrub: 1.0`):** Never use `scrub: true` (0s catchup). A numeric lag of `0.8s` gives the user a physical sense of momentum, smoothing out discrete mousewheel notches.
* **Text Crossfading Protocol:**
  * Copy elements are absolute-positioned on top of each other.
  * **Entry:** `opacity: 0 -> 1`, `y: 30px -> 0px` over `15%` of the step timeline.
  * **Hold Window:** `opacity: 1`, `y: 0px` held static for `60%` of the step timeline to allow comfortable reading.
  * **Exit:** `opacity: 1 -> 0`, `y: 0px -> -30px` over `25%` of the step timeline.
* **Screen Swapping / Hardware Transformation Architecture:**
  * **Vector/Interface Shifts:** Done via stacked DOM elements toggling `opacity` and subtle `scale(0.98 -> 1.0)`.
  * **3D Rotations / Explosions:** Done via an HTML5 `<canvas>` rendering 120–180 WebP frames.
  * *Why `<video>` is forbidden for scrubbing:* Modern video formats (H.264/HEVC) rely on temporal delta compression (I-frames every 1–2 seconds, P/B frames in-between). Scrubbing backward or frame-by-frame forces the browser hardware decoder to reconstruct frames out of sequence, resulting in dropped frames and high CPU spikes. Canvas frame indexing yields instant seek times.

---

## 3. Big-Type "Statement" Sections

Used between major hardware modules to reset the narrative cadence (e.g. "Titanium. So strong. So light. So Pro.").

### Core Archetypes
1. **The Scale-In Pull:**
   * Starts slightly oversized (`scale: 1.15`), low contrast (`opacity: 0.15`), and blurred (`filter: blur(8px)`).
   * As it reaches the vertical center of the viewport, it snaps into sharp focus (`scale: 1.0`, `opacity: 1.0`, `filter: blur(0px)`).
   * Holds for `30vh` of scroll.
   * Compresses down (`scale: 0.95`, `opacity: 0.2`) as it exits.
2. **The Masked Gradient Wipe:**
   * Text is assigned a linear gradient via `-webkit-background-clip: text` and `-webkit-text-fill-color: transparent`.
   * Gradient stops: `[White 0%, White 50%, rgba(255,255,255,0.15) 50.1%, rgba(255,255,255,0.15) 100%]`.
   * `background-size: 200% 100%`.
   * Scroll scrubbing advances `background-position-x` from `100%` to `0%`, creating an illuminated reading wave.
* **Concrete Metrics:**
  * *Pin Distance:* `150vh` to `200vh`.
  * *Scrub Window:* `scrub: 0.5`.
  * *Typography Scale:* `clamp(2.5rem, 1rem + 6vw, 7.0rem)`. Line height: `1.08`.

---

## 4. Feature Tiles / Bento Grids Appearing on Scroll

Apple pioneered the modern Bento Grid (asymmetric 1x1, 2x1, 2x2 modules) to display technical specs with varying visual hierarchy.

```
┌───────────────────────────────┐ ┌──────────────┐
│ Bento 1 (Large 2x2)           │ │ Bento 2 (1x1)│
│ y: 50px -> 0, scale: 0.95->1.0│ │ Stagger: 0.1s│
│ Delay: 0.0s                   │ └──────────────┘
│                               │ ┌──────────────┐
│                               │ │ Bento 3 (1x1)│
│                               │ │ Stagger: 0.2s│
└───────────────────────────────┘ └──────────────┘
```

### Reveal Choreography
* **Trigger Point:** `start: "top 80%"`. Animation begins when the top edge of the grid enters the lower 20% of the screen.
* **Tween Parameters:**
  * Transform: `translateY(50px) -> translateY(0px)`
  * Scale: `scale(0.95) -> scale(1.0)`
  * Opacity: `0 -> 1`
  * Duration: `0.9s`
  * Ease: `cubic-bezier(0.16, 1, 0.3, 1)` (`power4.out`)
* **Stagger Topology:**
  * Desktop: Multi-column stagger (`stagger: { amount: 0.3, from: "start", grid: "auto" }`).
  * Delay Offset: Inner graphic assets (e.g. battery life indicators, thermal chamber cutaways) trigger an internal micro-animation with a `+0.2s` delay *after* the container card settles.
* **Card Surface Specifications:**
  * *Background:* `rgba(255, 255, 255, 0.04)` on pure black (`#000000`).
  * *Border:* `1px solid rgba(255, 255, 255, 0.08)`.
  * *Corner Radius:* `clamp(18px, 2vw, 28px)`.

---

## 5. Sticky Translucent Nav Behaviour

The primary navigation and secondary product sub-nav behave as dynamic optical filters over the content stream.

### Visual State Transition Matrix
| Parameter | Default (At Page Top) | Scrolled State (`scrollY > 30px`) |
| :--- | :--- | :--- |
| **Height** | `52px` | `44px` (subtle compression) |
| **Background Fill** | `rgba(0, 0, 0, 0.0)` | `rgba(0, 0, 0, 0.8)` (Dark) / `rgba(255, 255, 255, 0.8)` (Light) |
| **Backdrop Filter** | `none` | `blur(20px) saturate(180%)` |
| **Border Bottom** | `1px solid rgba(255, 255, 255, 0.0)` | `1px solid rgba(255, 255, 255, 0.12)` |
| **Elevation Shadow**| `none` | `0 4px 20px rgba(0, 0, 0, 0.15)` |

### Directional Scroll Logic
* **Scroll Down:** Main corporate bar slides out of view (`yPercent: -100`, duration `0.3s`, `power2.out`). Product sub-bar remains pinned at `top: 0`.
* **Scroll Up:** Main corporate bar immediately slides back down into view (`yPercent: 0`, duration `0.25s`, `power2.out`).
* *Implementation Note:* Managed via `ScrollTrigger`'s `onUpdate(self)` listening to `self.direction` (-1 for up, 1 for down).

---

## 6. Parallax Depth and Image Scaling ("Zoom Out to Reveal")

To transition between high-level brand storytelling and concrete product immersion, Apple uses container bounding-box un-boxing:

```
[ Full-Bleed Viewport: 100vw, 100vh, border-radius: 0px ]
                          │
                          │ User scrolls down (150vh track)
                          ▼
[ Inset Rounded Container: 90vw, 75vh, border-radius: 32px ]
```

### Geometric Transform Ratios
* **The "Un-Box" Formula:**
  * Start: `width: 100vw`, `height: 100vh`, `borderRadius: 0px`.
  * End: `width: min(1200px, 92vw)`, `height: 75vh`, `borderRadius: clamp(16px, 2vw, 32px)`.
  * Image scale inside container: Tweens inversely from `scale(1.2)` down to `scale(1.0)` to eliminate apparent image shrinkage and keep focal points static.
* **Optical Parallax Speed Multipliers:**
  * Background layers (stars, gradient meshes): `0.3x` scroll rate (`yPercent: 20`).
  * Midground (Hardware silhouette): `1.0x` (standard scroll velocity).
  * Foreground elements (floating text callouts): `1.4x` scroll rate (`yPercent: -35`).

---

## 7. Synced-Lyrics Text Highlighting Line-by-Line (Apple Music Pattern)

The signature Apple Music lyrics pattern relies on continuous optical focal point stabilization:

```
Viewport Height (100vh)
┌────────────────────────────────────────────────────────┐
│  Line N-2 (Passed):    opacity: 0.25, blur: 1.5px     │
│  Line N-1 (Passed):    opacity: 0.40, blur: 0.5px     │
│                                                        │
│  Line N   (ACTIVE):    OPACITY: 1.0, SCALE: 1.05       │ ◄── Target Optical Line
│                        COLOR: #FFFFFF, BLUR: 0px       │     (~45% from viewport top)
│                                                        │
│  Line N+1 (Upcoming):  opacity: 0.25, blur: 1.0px     │
│  Line N+2 (Upcoming):  opacity: 0.15, blur: 2.0px     │
└────────────────────────────────────────────────────────┘
```

### Visual Physics for Synced Lyrics
* **Inactive State:** `opacity: 0.25`, `transform: scale(0.98)`, `filter: blur(1px)`.
* **Active State:** `opacity: 1.0`, `transform: scale(1.04)`, `filter: blur(0px)`, `color: #ffffff`.
* **Passed State:** Decays gracefully back to `opacity: 0.35`, `transform: scale(1.0)`.
* **Viewport Tracking:** As line $N$ activates, the parent container adjusts its `translateY` so the active line remains parked at `45vh` from the top of the viewport.
* **Scrub Smoothing:** When scrubbed by scroll (rather than driven by audio clocks), `scrub: 0.4` gives instant tactile feedback without abrupt jumping.

---

## 8. Performance Rules & Accessibility

### The 60/120 FPS Rendering Mandates
1. **The Strict Composite-Only Rule:**
   Never animate properties that trigger Layout or Paint cycles during scroll. 
   * **Allowed:** `transform` (`translate3d`, `scale3d`, `rotateZ`), `opacity`.
   * **Strictly Prohibited on Scroll:** `top`, `left`, `width`, `height`, `margin`, `padding`, `filter` (except on isolated, hardware-accelerated layers).
2. **`will-change` Hygiene:**
   Never apply `will-change: transform` globally in CSS. It forces the browser to allocate dedicated GPU memory layers, quickly causing VRAM exhaustion on mobile devices.
   * *Best Practice:* Toggle `will-change: transform` via GSAP lifecycle hooks:
     `onStart: () => gsap.set(el, { willChange: "transform, opacity" })`
     `onComplete: () => gsap.set(el, { willChange: "auto" })`.
3. **Canvas HiDPI Scaling Strategy:**
   Cap internal canvas backing-store resolutions at `dpr = 2`.
   ```ts
   const dpr = Math.min(window.devicePixelRatio || 1, 2); // Avoid DPR: 3 on mobile
   canvas.width = rect.width * dpr;
   canvas.height = rect.height * dpr;
   ctx.scale(dpr, dpr);
   ```
4. **GSAP & Lenis Integration Loop:**
   Decouple native scroll listeners. Lenis updates virtual positions, while GSAP's internal ticker drives the render:
   ```ts
   lenis.on('scroll', ScrollTrigger.update);
   gsap.ticker.add((time) => lenis.raf(time * 1000));
   gsap.ticker.lagSmoothing(0); // Prevents sudden jumps after CPU freezes
   ```

### Reduced Motion Matrix (`prefers-reduced-motion`)
Using `gsap.matchMedia()`, the experience automatically falls back to an accessible layout:
* All scroll pins are deactivated (`pin: false`).
* Multi-hundred `vh` runways collapse to standard `auto` heights.
* Scrubbed timelines are replaced with simple entrance fades (`opacity: 0 -> 1`, `duration: 0.4s`).
* Canvas sequences default to the first or hero beauty frame.

---

## 9. Mobile Adaptations (< 768px)

Desktop scrollytelling breaks down on mobile devices due to small screens, thumb fatigue, and touch velocity dynamics.

```
Desktop Pattern (1440px)                Mobile Adaptation (<768px)
────────────────────────                ─────────────────────────
400vh Pin Runway                        Shortened to 150vh OR completely unpinned
Canvas 3D Sequence (150 frames)         Pre-rendered static WebP or 30-frame sequence
Scrub smoothing: 0.8s                   Scrub smoothing: 0.1s (instant finger response)
3-Column Bento Grid                     Single-column vertical stack, delay removed
clamp(2.75rem, ..., 6.5rem)             clamp(2.0rem, 1.5rem + 3vw, 3.25rem)
```

### Strategic Mobile Rules
1. **Scrub Lag Reduction:** Touch inputs already have physical finger resistance. High scrub smoothing values (`0.8s`) feel sluggish on mobile. Reduce to `scrub: 0.1` or `scrub: true`.
2. **Pin Disabling for Information Density:** If a section contains extensive text, pinning is disabled entirely. Content converts to a standard vertical card feed.
3. **Asset Decimation:** For canvas sequences, load half-resolution frames (e.g. 720p instead of 4K) and step through frames at double intervals (rendering every 2nd frame) to conserve cellular bandwidth and memory.

---

## Recipes for Openfy

Production-ready TypeScript implementations using **GSAP 3.13+**, `ScrollTrigger`, and `SplitText` (imported from `'gsap/SplitText'`).

### Recipe 1: Hero Headline Reveal (Masked Split Lines + Product Rise)

```typescript
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

export function initHeroAnimation(
  headlineSelector: string,
  productSelector: string,
  eyebrowSelector: string
): gsap.core.Timeline {
  // Split headline into lines and wrap each in an overflow:hidden mask
  const split = new SplitText(headlineSelector, {
    type: 'lines,words',
    linesClass: 'line-mask',
  });

  // Ensure line containers clip their contents
  gsap.set('.line-mask', { overflow: 'hidden' });

  const tl = gsap.timeline({
    defaults: { ease: 'power4.out' },
  });

  tl.from(eyebrowSelector, {
    opacity: 0,
    y: 15,
    duration: 0.6,
  })
    .from(
      split.words,
      {
        yPercent: 120,
        opacity: 0,
        duration: 1.0,
        stagger: 0.05,
      },
      '-=0.4'
    )
    .from(
      productSelector,
      {
        scale: 0.92,
        y: 80,
        opacity: 0,
        duration: 1.4,
        ease: 'power3.out',
      },
      '-=0.8'
    );

  return tl;
}
```

---

### Recipe 2: Pinned Device Sequence with 4 Steps

```typescript
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initPinnedDeviceSequence(
  sectionSelector: string,
  deviceSelector: string,
  stepSelectors: string[]
): gsap.core.Timeline {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: sectionSelector,
      start: 'top top',
      end: '+=350%',
      pin: true,
      scrub: 0.8, // Apple-style momentum catch-up
      anticipatePin: 1,
    },
  });

  // Steps start hidden except the first
  gsap.set(stepSelectors.slice(1), { opacity: 0, y: 30 });
  gsap.set(stepSelectors[0], { opacity: 1, y: 0 });

  stepSelectors.forEach((step, index) => {
    if (index === 0) return;

    const prevStep = stepSelectors[index - 1];

    // Fade out previous step, fade in current step
    tl.to(prevStep, {
      opacity: 0,
      y: -30,
      duration: 0.4,
      ease: 'power2.in',
    })
      .to(
        step,
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: 'power2.out',
        },
        '-=0.1'
      )
      // Internal hardware camera/device micro-rotation per step
      .to(
        deviceSelector,
        {
          rotateY: index * 12,
          scale: 1 + index * 0.03,
          duration: 0.6,
          ease: 'power1.inOut',
        },
        '<'
      )
      // Hold space for reading comfort
      .to({}, { duration: 0.4 });
  });

  return tl;
}
```

---

### Recipe 3: Scroll-Scrubbed Lyrics Highlight (Synced Focus)

```typescript
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initScrubbedLyrics(
  containerSelector: string,
  lineSelector: string
): gsap.core.Timeline {
  const lines = gsap.utils.toArray<HTMLElement>(lineSelector);
  const container = document.querySelector<HTMLElement>(containerSelector);

  // Set default inactive state: dimmed and slightly blurred
  gsap.set(lines, {
    opacity: 0.25,
    scale: 0.98,
    filter: 'blur(1.5px)',
    transformOrigin: 'left center',
  });

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: containerSelector,
      start: 'top 20%',
      end: 'bottom 80%',
      scrub: 0.5,
    },
  });

  lines.forEach((line, i) => {
    // Light up current line
    tl.to(
      line,
      {
        opacity: 1.0,
        scale: 1.05,
        filter: 'blur(0px)',
        color: '#ffffff',
        duration: 0.5,
        ease: 'power2.out',
      },
      i * 0.8
    );

    // Dim out previous line
    if (i > 0) {
      tl.to(
        lines[i - 1],
        {
          opacity: 0.35,
          scale: 1.0,
          filter: 'blur(0.5px)',
          color: '#86868b',
          duration: 0.4,
          ease: 'power2.in',
        },
        i * 0.8
      );
    }
  });

  return tl;
}
```

---

### Recipe 4: Big-Type Statement Scale-In & Out

```typescript
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initStatementZoom(
  sectionSelector: string,
  statementSelector: string
): gsap.core.Timeline {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: sectionSelector,
      start: 'top top',
      end: '+=180%',
      pin: true,
      scrub: 0.6,
    },
  });

  tl.fromTo(
    statementSelector,
    {
      scale: 1.15,
      opacity: 0.1,
      filter: 'blur(10px)',
      letterSpacing: '0.02em',
    },
    {
      scale: 1.0,
      opacity: 1.0,
      filter: 'blur(0px)',
      letterSpacing: '-0.025em',
      duration: 1.0,
      ease: 'power3.out',
    }
  )
    // Hold at optical center
    .to({}, { duration: 0.6 })
    // Recede into background on scroll continuation
    .to(statementSelector, {
      scale: 0.95,
      opacity: 0.2,
      duration: 0.8,
      ease: 'power2.in',
    });

  return tl;
}
```

---

### Recipe 5: Staggered Bento / Card Grid Reveal

```typescript
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initBentoGridReveal(
  gridContainerSelector: string,
  cardSelector: string
): ScrollTrigger {
  return ScrollTrigger.batch(cardSelector, {
    interval: 0.1, // Batch items entering within 100ms
    batchMax: 3,
    start: 'top 85%',
    onEnter: (batch) => {
      gsap.fromTo(
        batch,
        {
          opacity: 0,
          y: 45,
          scale: 0.96,
        },
        {
          opacity: 1,
          y: 0,
          scale: 1.0,
          duration: 0.9,
          stagger: 0.12,
          ease: 'power4.out',
          overwrite: 'auto',
        }
      );
    },
    once: true, // Run entrance sequence once only
  });
}
```

---

### Recipe 6: Translucent Adaptive Nav on Scroll

```typescript
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initAdaptiveNav(navSelector: string): ScrollTrigger {
  const nav = document.querySelector<HTMLElement>(navSelector);
  if (!nav) throw new Error('Nav element not found');

  // Set initial inline CSS properties
  gsap.set(nav, {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    zIndex: 1000,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backdropFilter: 'blur(0px) saturate(100%)',
    borderBottom: '1px solid rgba(255, 255, 255, 0)',
  });

  return ScrollTrigger.create({
    start: 'top -30px', // Trigger after 30px of downward scroll
    onEnter: () => {
      gsap.to(nav, {
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
        height: '44px',
        duration: 0.35,
        ease: 'power2.out',
      });
    },
    onLeaveBack: () => {
      gsap.to(nav, {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backdropFilter: 'blur(0px) saturate(100%)',
        borderBottom: '1px solid rgba(255, 255, 255, 0)',
        height: '52px',
        duration: 0.35,
        ease: 'power2.out',
      });
    },
    onUpdate: (self) => {
      // Hide on fast scroll down; reveal on scroll up
      if (self.direction === 1 && self.scroll() > 150) {
        gsap.to(nav, { yPercent: -100, duration: 0.3, ease: 'power2.inOut' });
      } else if (self.direction === -1) {
        gsap.to(nav, { yPercent: 0, duration: 0.25, ease: 'power2.out' });
      }
    },
  });
}
```

---

## Architectural Summary Checklist for Production

* [ ] **Lenis Virtual Sync:** Ensure `gsap.ticker.lagSmoothing(0)` is set to avoid frame jumps when scrubbing heavy media.
* [ ] **DPR Limits:** Check canvas resolutions on Retina devices: `Math.min(window.devicePixelRatio, 2)` prevents iOS WebProcess out-of-memory crashes.
* [ ] **Layout Safety:** Never animate `width`, `height`, `margin`, or `padding` inside `ScrollTrigger` timelines; rely strictly on `transform` and `opacity`.
* [ ] **Responsiveness:** Wrap all scrollytelling timelines in `gsap.matchMedia()` and collapse scroll runways under `768px` to maintain a snappy mobile UX.
