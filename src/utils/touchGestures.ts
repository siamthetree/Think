/**
 * Pure iOS 26 Liquid Glass Touch Gesture Math & Recognition Engine
 *
 * Provides rubber-band physics, swipe-action detent calculation,
 * two-finger pinch-to-zoom typography scaling, bottom-sheet drag-to-dismiss,
 * edge-swipe back navigation, and double-tap detection.
 */

export type SwipeDirection = 'left' | 'right' | 'none';

export interface SwipeActionState {
  /** Rubber-banded horizontal offset in px (positive = right swipe, negative = left swipe) */
  offsetX: number;
  /** Direction of the swipe */
  direction: SwipeDirection;
  /** Progress from 0 to 1 toward the action trigger threshold */
  progress: number;
  /** Whether the user has pulled past the haptic detent threshold to arm the action */
  armed: boolean;
}

/**
 * Applies Apple-style rubber-band resistance beyond a threshold.
 */
export function rubberBand(distance: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  const abs = Math.abs(distance);
  const sign = distance < 0 ? -1 : 1;
  const result = (1 - 1 / ((abs * constant) / dimension + 1)) * dimension;
  return sign * result;
}

/**
 * Computes horizontal card/row swipe-action state with rubber-band elasticity
 * and detent threshold detection.
 */
export function computeSwipeActionState(
  dx: number,
  dy: number,
  threshold = 72,
  maxTranslate = 128
): SwipeActionState {
  // Ignore predominantly vertical scrolling gestures
  if (Math.abs(dy) > Math.abs(dx) * 0.85 && Math.abs(dx) < 28) {
    return { offsetX: 0, direction: 'none', progress: 0, armed: false };
  }

  // Deadzone of 8px to avoid jitter during taps
  if (Math.abs(dx) < 8) {
    return { offsetX: 0, direction: 'none', progress: 0, armed: false };
  }

  const direction: SwipeDirection = dx > 0 ? 'right' : 'left';
  const sign = dx > 0 ? 1 : -1;
  const absDx = Math.abs(dx) - 8;

  let offsetAbs: number;
  if (absDx <= threshold) {
    offsetAbs = absDx;
  } else {
    const extra = absDx - threshold;
    offsetAbs = threshold + rubberBand(extra, maxTranslate - threshold, 0.5);
  }

  const clampedOffset = sign * Math.min(maxTranslate, Math.round(offsetAbs));
  const progress = Math.min(1, Number((Math.abs(clampedOffset) / threshold).toFixed(2)));
  const armed = Math.abs(clampedOffset) >= threshold;

  return {
    offsetX: clampedOffset,
    direction,
    progress,
    armed,
  };
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
 * Clamps between minSize (14px) and maxSize (26px).
 */
export function computePinchFontSize(
  initialDistance: number,
  currentDistance: number,
  baseFontSize: number,
  minSize = 14,
  maxSize = 26
): number {
  if (initialDistance <= 10 || currentDistance <= 10) {
    return Math.min(maxSize, Math.max(minSize, Math.round(baseFontSize)));
  }
  const scale = currentDistance / initialDistance;
  // Map scale changes gently so pinching feels controllable and smooth
  const dampedScale = 1 + (scale - 1) * 0.65;
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
 * and velocity/distance release checks.
 */
export function computeSheetDragState(
  dy: number,
  velocityY = 0,
  dismissThreshold = 84
): SheetDragState {
  if (dy < 0) {
    // Upward pull gets strong rubber-band resistance
    const upward = rubberBand(dy, 36, 0.4);
    return {
      offsetY: Math.round(upward),
      backdropScale: 1,
      shouldDismiss: false,
    };
  }

  const offsetY = Math.round(dy);
  const progress = Math.min(1, offsetY / (dismissThreshold * 2.2));
  const backdropScale = Number(Math.max(0.25, 1 - progress * 0.65).toFixed(2));
  const shouldDismiss = offsetY >= dismissThreshold || (offsetY >= 36 && velocityY > 0.65);

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
 * carousel stepping, and tab/article switching.
 */
export function classifyHorizontalSwipe(params: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  durationMs: number;
  edgeThreshold?: number;
  minSwipeDistance?: number;
}): HorizontalNavigationIntent {
  const {
    startX,
    startY,
    endX,
    endY,
    durationMs,
    edgeThreshold = 34,
    minSwipeDistance = 64,
  } = params;

  const dx = endX - startX;
  const dy = endY - startY;

  // Must be predominantly horizontal
  if (Math.abs(dx) < Math.abs(dy) * 1.35) {
    return 'none';
  }

  // Fast flicks require slightly less distance than slow drags
  const effectiveMinDistance = durationMs < 260 ? Math.max(44, minSwipeDistance * 0.75) : minSwipeDistance;
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
    maxDelayMs = 300,
    maxDistancePx = 36,
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
