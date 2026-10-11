import { MAX_SCREENSHOT_BYTES, screenshotProblem } from './report'

/*
 * A screenshot is a picture of the tab, taken by the browser through the screen-capture
 * API rather than redrawn from the DOM. A redraw would need a library re-implementing CSS,
 * and it is wrong precisely where a bug report needs it right: a layout that broke is a
 * layout a reimplementation lays out differently.
 *
 * The browser asks first, every time, and on phones there is no such API at all. So this is
 * the quick way rather than the only one: an image can also be picked or pasted.
 */

/** Wide enough to read any text in the app; past it a capture is bytes, not detail. */
const MAX_WIDTH = 2400

export function canCaptureScreen(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

/** The user said no, or closed the browser's picker. Not an error worth showing. */
export function wasDeclined(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
}

/** Long enough for a slow machine to hand over a frame; short enough that nobody waits on a hang. */
const FRAME_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/*
 * The first decoded frame, from a video that is never put in the page. Waiting on
 * `requestVideoFrameCallback` here is the trap: it fires when a frame is *presented*, and
 * a video nobody renders presents nothing, so in Chrome and Safari it can wait for good.
 * `loadeddata` is about decoding, which happens whether or not anything is on screen.
 */
function firstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) return Promise.resolve()
  return new Promise((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }))
}

interface ImageCaptureLike {
  grabFrame(): Promise<ImageBitmap>
}

/** One frame of the track: `ImageCapture` where the browser has it, a video element elsewhere. */
async function grab(track: MediaStreamTrack, stream: MediaStream): Promise<HTMLCanvasElement> {
  // Through `unknown`: the DOM types declare `ImageCapture` without the one method used here.
  const Capture = (window as unknown as {
    ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike
  }).ImageCapture
  if (Capture) {
    try {
      const bitmap = await new Capture(track).grabFrame()
      try {
        return draw(bitmap, bitmap.width, bitmap.height)
      } finally {
        bitmap.close()
      }
    } catch {
      // Some builds expose it and then refuse a display track; the video path still works.
    }
  }
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()
  await firstFrame(video)
  return draw(video, video.videoWidth, video.videoHeight)
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))), type, quality)
  })
}

/** PNG keeps text crisp; a capture too large for it as PNG goes as JPEG instead. */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const png = await toBlob(canvas, 'image/png')
  if (png.size <= MAX_SCREENSHOT_BYTES) return png
  return toBlob(canvas, 'image/jpeg', 0.85)
}

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_WIDTH / width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot draw the screenshot.')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Asks the browser for one frame of this tab. `preferCurrentTab` makes Chrome and Edge
 * offer this tab and nothing else; elsewhere the picker opens and the person chooses.
 */
export async function captureScreen(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  } as DisplayMediaStreamOptions)
  const [track] = stream.getVideoTracks()
  try {
    if (!track) throw new Error('The browser shared nothing to take a picture of.')
    /*
     * Every way this can end is bounded: a frame, the sharing stopped from the browser's
     * own bar, or the timeout. An unbounded wait here is a panel that never comes back.
     */
    const stopped = new Promise<never>((_, reject) => {
      track.addEventListener('ended', () => reject(new Error('Sharing stopped before the screenshot was taken.')), { once: true })
    })
    const canvas = await withTimeout(
      Promise.race([grab(track, stream), stopped]),
      FRAME_TIMEOUT_MS,
      'The browser did not hand over a picture. Try again, or paste one instead.',
    )
    return await encode(canvas)
  } finally {
    // Stopped at once, so the browser's "sharing this tab" indicator is gone within a moment.
    stream.getTracks().forEach((track) => track.stop())
  }
}

/**
 * Makes a picked or pasted image fit to send: one that already does goes as it is, and one
 * that is too large, or in a format the inbox does not take, is redrawn as PNG or JPEG.
 */
export async function fitImage(file: Blob): Promise<Blob> {
  if (!screenshotProblem(file)) return file
  if (!file.type.startsWith('image/')) throw new Error('That is not an image.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That image could not be read. Try a PNG or JPEG.')
  }
  try {
    const blob = await encode(draw(bitmap, bitmap.width, bitmap.height))
    const problem = screenshotProblem(blob)
    if (problem) throw new Error(problem)
    return blob
  } finally {
    bitmap.close()
  }
}
