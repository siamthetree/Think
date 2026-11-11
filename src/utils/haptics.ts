// Tactile feedback layer.
//
// Priority order:
//   1. Native iOS Taptic Engine through @capacitor/haptics (UIImpactFeedbackGenerator,
//      UISelectionFeedbackGenerator, UINotificationFeedbackGenerator). This is the real thing.
//   2. Safari / WKWebView 17.4+ switch-toggle haptic (web fallback, best effort).
//   3. navigator.vibrate on Android browsers.
// Nothing here produces sound.

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

type HapticKind = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// ---------- Web fallbacks ----------

let switchLabel: HTMLLabelElement | null = null;

function webTick(): void {
  try {
    if (typeof document === 'undefined' || !document.body) return;
    if (!switchLabel) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText =
        'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      switchLabel = label;
    }
    switchLabel.click();
  } catch {
    // Optional enhancement only.
  }
}

function webVibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Unsupported in this browser.
  }
}

// Offsets (ms) at which a web tick is fired, and the vibration pattern for Android.
const WEB_PATTERNS: Record<HapticKind, { ticks: number[]; vibrate: number | number[] }> = {
  selection: { ticks: [0], vibrate: 6 },
  light: { ticks: [0], vibrate: 10 },
  medium: { ticks: [0], vibrate: 18 },
  heavy: { ticks: [0, 35], vibrate: 30 },
  success: { ticks: [0, 70], vibrate: [12, 40, 12] },
  warning: { ticks: [0, 110], vibrate: [20, 60, 20] },
  error: { ticks: [0, 60, 120], vibrate: [30, 50, 30, 50, 30] },
};

function fireWeb(kind: HapticKind): void {
  const pattern = WEB_PATTERNS[kind];
  for (const offset of pattern.ticks) {
    if (offset === 0) webTick();
    else setTimeout(webTick, offset);
  }
  webVibrate(pattern.vibrate);
}

// ---------- Native ----------

async function fireNative(kind: HapticKind): Promise<void> {
  switch (kind) {
    case 'selection':
      await Haptics.selectionStart();
      await Haptics.selectionChanged();
      await Haptics.selectionEnd();
      return;
    case 'light':
      await Haptics.impact({ style: ImpactStyle.Light });
      return;
    case 'medium':
      await Haptics.impact({ style: ImpactStyle.Medium });
      return;
    case 'heavy':
      await Haptics.impact({ style: ImpactStyle.Heavy });
      return;
    case 'success':
      await Haptics.notification({ type: NotificationType.Success });
      return;
    case 'warning':
      await Haptics.notification({ type: NotificationType.Warning });
      return;
    case 'error':
      await Haptics.notification({ type: NotificationType.Error });
      return;
  }
}

// Short gap guard so rapid pull-and-release gestures do not stack impacts.
let lastFire = 0;

function fire(kind: HapticKind): void {
  const isNotification = kind === 'success' || kind === 'warning' || kind === 'error';
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!isNotification && now - lastFire < 35) return;
  lastFire = now;

  if (isNative()) {
    fireNative(kind).catch(() => fireWeb(kind));
  } else {
    fireWeb(kind);
  }
}

// ---------- Public API ----------

/** Very light tick, for small discrete changes. */
export function triggerHapticSelection(): void {
  fire('selection');
}

/** Pull-to-refresh: the pull has crossed the refresh threshold (the "detent"). */
export function triggerHapticPull(): void {
  fire('medium');
}

/** Pull-to-refresh: the user pulled back above the threshold, so refresh is no longer armed. */
export function triggerHapticDisarm(): void {
  fire('selection');
}

/** Pull-to-refresh: the finger lifted while armed and refresh is starting. */
export function triggerHapticRelease(): void {
  fire('light');
}

/** Pull-to-refresh: refresh finished successfully. */
export function triggerHapticComplete(): void {
  fire('success');
}

/** Pull-to-refresh: refresh failed. */
export function triggerHapticError(): void {
  fire('error');
}
