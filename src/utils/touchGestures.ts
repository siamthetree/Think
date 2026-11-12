/**
 * Apple iOS 26 UIKit-Grade Touch Gesture Physics & Recognition Engine
 *
 * Implements:
 * 1. Directional Axis Lock (`UIScrollView.isDirectionalLockEnabled` equivalent)
 *    so vertical scrolling never triggers accidental horizontal swipes.
 * 2. Logarithmic Apple Rubber-Banding (`c = 0.55`).
 * 3. Hysteresis Arm/Disarm Detents (prevents haptic chatter at the threshold boundary).
 * 4. Windowed Release Velocity Tracking (`px/ms` over the last 80ms of touch movement)
 *    with momentum projection and reversal cancellation.
 * 5. Two-Finger Pinch-to-Zoom Typography Scaling with deadzone stabilization.
 * 6. Interactive Screen-Edge Pop Gesture & Bottom-Sheet Drag-to-Dismiss physics.
 */

export type SwipeDirection = 'left' | 'right' | 'none';
export type GestureAxisLock = 'undecided' | 'horizontal' | 'vertical';

export interface VelocitySample {
  x: number;
  y: number;
  t: number;
}

export interface SwipeActionState {
  /** Rubber-banded horizontal offset in px (positive = right swipe, negative = left swipe) */
  offsetX: number;
  /** Direction of the swipe */
  direction: SwipeDirection;
  /** Progress from 0 to 1 toward the action trigger threshold */
  progress: number;
  /** Whether the user has pulled past the haptic detent threshold to arm the action */
  armed: boolean;
  /** Locked gesture axis ('undecided' | 'horizontal' | 'vertical') */
  axisLock: GestureAxisLock;
}

/**
 * Applies Apple UIKit rubber-band resistance beyond a threshold:
 * f(x, d, c) = (1 - 1 / ((x * c / d) + 1)) * d
 */
export function rubberBand(distance: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0 || distance === 0) return 0;
  const abs = Math.abs(distance);
  const sign = distance < 0 ? -1 : 1;
  const result = (1 - 1 / ((abs * constant) / dimension + 1)) * dimension;
  return sign * result;
}

/**
 * Determines the locked gesture axis ('horizontal' | 'vertical' | 'undecided')
 * from the initial touch displacement vector. Once locked to 'horizontal' or 'vertical',
 * the lock persists for the entire remainder of the touch sequence.
 */
export function resolveGestureAxisLock(
  currentLock: GestureAxisLock,
  dx: number,
  dy: number
): GestureAxisLock {
  if (currentLock !== 'undecided') return currentLock;

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const distance = Math.hypot(absX, absY);

  // Wait until finger moves at least 7px before locking axis
  if (distance < 7) return 'undecided';

  // Require a deliberate horizontal angle (< ~35 deg from horizontal) to lock horizontal
  if (absX >= 9 && absX > absY * 1.4) {
    return 'horizontal';
  }

  // Otherwise if vertical movement dominates or is diagonal, lock to vertical scroll
  if (absY >= 7 && absY >= absX * 0.8) {
    return 'vertical';
  }

  return 'undecided';
}

/**
 * Computes instantaneous release velocity in px/ms using a sliding 85ms window
 * of touch samples (matching UIKit UIPanGestureRecognizer velocity calculation).
 */
export function computeReleaseVelocity(samples: VelocitySample[]): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const latest = samples[samples.length - 1];

  // Find the oldest sample within the last 85ms window (or the immediately preceding sample)
  let anchor = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    const dt = latest.t - samples[i].t;
    anchor = samples[i];
    if (dt >= 28 && dt <= 95) {
      break;
    }
  }

  const dt = latest.t - anchor.t;
  if (dt <= 2 || dt > 180) {
    // If finger held still > 180ms before lifting, release velocity is 0
    return { vx: 0, vy: 0 };
  }

  return {
    vx: Number(((latest.x - anchor.x) / dt).toFixed(3)),
    vy: Number(((latest.y - anchor.y) / dt).toFixed(3)),
  };
}

/**
 * Computes horizontal card/row swipe-action state with strict axis locking,
 * hysteresis detent arming/disarming, and Apple rubber-band elasticity.
 */
export function computeSwipeActionState(
  dx: number,
  dy: number,
  threshold = 72,
  maxTranslate = 128,
  currentAxisLock: GestureAxisLock = 'undecided',
  previouslyArmed = false
): SwipeActionState {
  const axisLock = resolveGestureAxisLock(currentAxisLock, dx, dy);

  // If locked to vertical scrolling or still undecided, horizontal offset is strictly 0
  if (axisLock !== 'horizontal') {
    return { offsetX: 0, direction: 'none', progress: 0, armed: false, axisLock };
  }

  const absDx = Math.abs(dx);
  if (absDx < 8) {
    return { offsetX: 0, direction: 'none', progress: 0, armed: false, axisLock };
  }

  const direction: SwipeDirection = dx > 0 ? 'right' : 'left';
  const sign = dx > 0 ? 1 : -1;
  const activeDrag = absDx - 8;

  let offsetAbs: number;
  if (activeDrag <= threshold) {
    // 1:1 tracking up to threshold
    offsetAbs = activeDrag;
  } else {
    // Smooth logarithmic rubber-band resistance past threshold
    const extra = activeDrag - threshold;
    offsetAbs = threshold + rubberBand(extra, maxTranslate - threshold, 0.55);
  }

  const clampedOffset = sign * Math.min(maxTranslate, Math.round(offsetAbs));
  const absOffset = Math.abs(clampedOffset);
  const progress = Math.min(1, Number((absOffset / threshold).toFixed(2)));

  // Hysteresis: arm at threshold, disarm only when pulled back 10px below threshold
  const disarmThreshold = Math.max(24, threshold - 10);
  const armed = previouslyArmed ? absOffset >= disarmThreshold : absOffset >= threshold;

  return {
    offsetX: clampedOffset,
    direction,
    progress,
    armed,
    axisLock,
  };
}

/**
 * Determines on touch release whether a swipe action should commit or cancel,
 * incorporating both detent state and finger release velocity (flick to commit,
 * reverse flick to cancel).
 */
export function shouldCommitSwipeAction(params: {
  state: SwipeActionState;
  velocityX: number;
  minFlickOffset?: number;
  minFlickVelocity?: number;
}): boolean {
  const {
    state,
    velocityX,
    minFlickOffset = 34,
    minFlickVelocity = 0.62,
  } = params;

  if (state.axisLock !== 'horizontal' || state.direction === 'none') {
    return false;
  }

  const sign = state.direction === 'right' ? 1 : -1;
  const alignedVelocity = velocityX * sign; // positive if moving in swipe direction, negative if reversing

  // If the user flicked back toward the origin before releasing, cancel the action
  if (alignedVelocity < -0.32) {
    return false;
  }

  // If armed past the detent threshold and not reversing, commit
  if (state.armed) {
    return true;
  }

  // Fast intentional flick in the swipe direction commits even before full threshold
  if (Math.abs(state.offsetX) >= minFlickOffset && alignedVelocity >= minFlickVelocity) {
    return true;
  }

  return false;
}

/**
 * Computes distance between two touch points.
 */
export function getTouchDistance(
  p1: { clientX: number; clientY: number },
  p2: { clientX: number; clientY: number }
): number {
  const dx = p2.clientX - p1.clientX;
  const dy = p2.clientY - p1.clientY;
  return Math.hypot(dx, dy);
}

/**
 * Computes new reader font size from a 2-finger pinch gesture.
 * Includes a 8px deadzone so resting two fingers never causes jitter,
 * and clamps between minSize (14px) and maxSize (26px).
 */
export function computePinchFontSize(
  initialDistance: number,
  currentDistance: number,
  baseFontSize: number,
  minSize = 14,
  maxSize = 26
): number {
  const clampedBase = Math.min(maxSize, Math.max(minSize, Math.round(baseFontSize)));
  if (initialDistance <= 16 || currentDistance <= 16) {
    return clampedBase;
  }
  const deltaDist = currentDistance - initialDistance;
  // Deadzone of 8px so resting fingers don't fluctuate
  if (Math.abs(deltaDist) < 8) {
    return clampedBase;
  }
  const effectiveDelta = deltaDist > 0 ? deltaDist - 8 : deltaDist + 8;
  const scale = (initialDistance + effectiveDelta) / initialDistance;
  const dampedScale = 1 + (scale - 1) * 0.68;
  const rawSize = Math.round(baseFontSize * dampedScale);
  return Math.min(maxSize, Math.max(minSize, rawSize));
}

export interface SheetDragState {
  /** Vertical offset in px (>= 0 for downward drag, slight negative rubber-band for upward drag) */
  offsetY: number;
  /** Backdrop opacity multiplier (0.2 to 1) */
  backdropScale: number;
  /** Whether releasing now should dismiss the bottom sheet */
  shouldDismiss: boolean;
}

/**
 * Computes bottom-sheet vertical drag-to-dismiss state with upward rubber-banding
 * and velocity/distance release checks (cancels dismiss if user flicks upward).
 */
export function computeSheetDragState(
  dy: number,
  velocityY = 0,
  dismissThreshold = 84
): SheetDragState {
  if (dy < 0) {
    // Upward pull gets strong rubber-band resistance
    const upward = rubberBand(dy, 32, 0.45);
    return {
      offsetY: Math.round(upward),
      backdropScale: 1,
      shouldDismiss: false,
    };
  }

  const offsetY = Math.round(dy);
  const progress = Math.min(1, offsetY / (dismissThreshold * 2.2));
  const backdropScale = Number(Math.max(0.25, 1 - progress * 0.65).toFixed(2));

  // If user is actively pulling back upward at release, do not dismiss
  if (velocityY < -0.3) {
    return { offsetY, backdropScale, shouldDismiss: false };
  }

  const shouldDismiss = offsetY >= dismissThreshold || (offsetY >= 34 && velocityY > 0.58);

  return {
    offsetY,
    backdropScale,
    shouldDismiss,
  };
}

export type HorizontalNavigationIntent =
  | 'edge-back'
  | 'next-item'
  | 'prev-item'
  | 'none';

/**
 * Classifies horizontal swipe gestures for iOS left-edge back navigation,
 * carousel stepping, and tab/article switching with velocity projection.
 */
export function classifyHorizontalSwipe(params: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  durationMs: number;
  velocityX?: number;
  edgeThreshold?: number;
  minSwipeDistance?: number;
}): HorizontalNavigationIntent {
  const {
    startX,
    startY,
    endX,
    endY,
    durationMs,
    velocityX,
    edgeThreshold = 38,
    minSwipeDistance = 64,
  } = params;

  const dx = endX - startX;
  const dy = endY - startY;

  // Must be strictly horizontal (< ~32 deg angle) so diagonal reading scrolls never misfire
  if (Math.abs(dx) < Math.abs(dy) * 1.5) {
    return 'none';
  }

  const safeDuration = Math.max(1, durationMs);
  const vx = velocityX !== undefined ? velocityX : dx / safeDuration;

  // If user reversed direction at the end of the drag, cancel navigation
  if (dx > 0 && vx < -0.25) return 'none';
  if (dx < 0 && vx > 0.25) return 'none';

  // Fast flicks require less distance than slow drags
  const isFastFlick = Math.abs(vx) >= 0.55 && safeDuration < 300;
  const effectiveMinDistance = isFastFlick ? Math.max(36, minSwipeDistance * 0.58) : minSwipeDistance;

  if (Math.abs(dx) < effectiveMinDistance) {
    return 'none';
  }

  // Left-edge swipe right = iOS interactive pop/back gesture
  if (startX <= edgeThreshold && dx > 0) {
    return 'edge-back';
  }

  if (dx < 0) {
    return 'next-item';
  }

  return 'prev-item';
}

/**
 * Determines whether two taps constitute a deliberate double-tap gesture
 * within time and spatial tolerances.
 */
export function isDoubleTapGesture(params: {
  lastTapTime: number;
  currentTime: number;
  lastX?: number;
  lastY?: number;
  currentX?: number;
  currentY?: number;
  maxDelayMs?: number;
  maxDistancePx?: number;
}): boolean {
  const {
    lastTapTime,
    currentTime,
    lastX = 0,
    lastY = 0,
    currentX = 0,
    currentY = 0,
    maxDelayMs = 280,
    maxDistancePx = 32,
  } = params;

  if (lastTapTime <= 0) return false;
  const dt = currentTime - lastTapTime;
  if (dt <= 35 || dt > maxDelayMs) return false;

  const distance = Math.hypot(currentX - lastX, currentY - lastY);
  return distance <= maxDistancePx;
}

/**
 * Maps a horizontal touch X coordinate across a segmented TabBar into a tab index.
 */
export function resolveScrubbedTabIndex(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  tabCount: number
): number {
  if (rectWidth <= 0 || tabCount <= 0) return 0;
  const relativeX = Math.max(0, Math.min(rectWidth - 1, clientX - rectLeft));
  const index = Math.floor((relativeX / rectWidth) * tabCount);
  return Math.max(0, Math.min(tabCount - 1, index));
}
