import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rubberBand,
  resolveGestureAxisLock,
  computeReleaseVelocity,
  computeSwipeActionState,
  shouldCommitSwipeAction,
  computePinchFontSize,
  computeSheetDragState,
  classifyHorizontalSwipe,
  isDoubleTapGesture,
  resolveScrubbedTabIndex,
} from './touchGestures.ts';

describe('touchGestures Apple UIKit-grade engine', () => {
  it('computes rubberBand resistance symmetrically', () => {
    const pos = rubberBand(100, 120);
    const neg = rubberBand(-100, 120);
    assert.ok(pos > 0 && pos < 100);
    assert.equal(pos, -neg);
  });

  it('locks gesture axis to vertical or horizontal and never switches mid-gesture', () => {
    // Initial vertical scroll movement locks to vertical
    const lockV = resolveGestureAxisLock('undecided', 3, 14);
    assert.equal(lockV, 'vertical');

    // Even if user later drifts horizontally by 90px, vertical lock persists
    assert.equal(resolveGestureAxisLock(lockV, 90, 40), 'vertical');
    const blockedSwipe = computeSwipeActionState(90, 40, 72, 128, lockV);
    assert.equal(blockedSwipe.offsetX, 0);
    assert.equal(blockedSwipe.axisLock, 'vertical');

    // Initial horizontal movement locks to horizontal
    const lockH = resolveGestureAxisLock('undecided', 16, 4);
    assert.equal(lockH, 'horizontal');
  });

  it('computes horizontal card swipe actions with hysteresis detents', () => {
    // Small jitter is ignored
    const jitter = computeSwipeActionState(5, 2, 72, 128);
    assert.equal(jitter.offsetX, 0);
    assert.equal(jitter.armed, false);

    // Right swipe past threshold arms bookmark action
    const rightSwipe = computeSwipeActionState(92, 6, 72, 128);
    assert.equal(rightSwipe.direction, 'right');
    assert.equal(rightSwipe.armed, true);
    assert.equal(rightSwipe.axisLock, 'horizontal');
    assert.ok(rightSwipe.offsetX >= 72 && rightSwipe.offsetX <= 128);

    // Hysteresis: pulling slightly back to 65px (above disarmThreshold 62px) stays armed
    const stillArmed = computeSwipeActionState(73, 6, 72, 128, 'horizontal', true);
    assert.equal(stillArmed.armed, true);

    // Pulling back below 62px disarms cleanly
    const disarmed = computeSwipeActionState(55, 6, 72, 128, 'horizontal', true);
    assert.equal(disarmed.armed, false);
  });

  it('commits on fast flick and cancels when user reverses swipe direction', () => {
    const partialSwipe = computeSwipeActionState(52, 4, 72, 128, 'horizontal', false);
    assert.equal(partialSwipe.armed, false);

    // Fast right flick commits even before full 72px threshold
    assert.equal(
      shouldCommitSwipeAction({ state: partialSwipe, velocityX: 0.85 }),
      true
    );

    // Armed swipe that user flicks back toward origin cancels
    const armedSwipe = computeSwipeActionState(90, 4, 72, 128, 'horizontal', true);
    assert.equal(
      shouldCommitSwipeAction({ state: armedSwipe, velocityX: -0.6 }),
      false
    );
  });

  it('computes windowed release velocity and zeroes out stationary holds', () => {
    const moving = computeReleaseVelocity([
      { x: 10, y: 0, t: 100 },
      { x: 55, y: 0, t: 145 },
      { x: 85, y: 0, t: 175 },
    ]);
    assert.ok(moving.vx > 0.8);

    // Held stationary for 250ms before lift -> 0 velocity
    const stationary = computeReleaseVelocity([
      { x: 10, y: 0, t: 100 },
      { x: 85, y: 0, t: 400 },
    ]);
    assert.equal(stationary.vx, 0);
  });

  it('scales reader font size smoothly on two-finger pinch with deadzone', () => {
    // 5px change within 8px deadzone keeps font size unchanged
    assert.equal(computePinchFontSize(100, 105, 18, 14, 26), 18);

    const enlarged = computePinchFontSize(100, 148, 18, 14, 26);
    assert.ok(enlarged > 18 && enlarged <= 26);

    const shrunk = computePinchFontSize(148, 90, 18, 14, 26);
    assert.ok(shrunk < 18 && shrunk >= 14);
  });

  it('computes bottom sheet drag-to-dismiss physics and cancels on upward flick', () => {
    const upward = computeSheetDragState(-50, 0, 84);
    assert.ok(upward.offsetY < 0 && upward.offsetY > -36);
    assert.equal(upward.shouldDismiss, false);

    const downward = computeSheetDragState(96, 0.2, 84);
    assert.equal(downward.shouldDismiss, true);

    // Upward reversal flick cancels dismissal even if pulled past 84px
    const reversedUp = computeSheetDragState(96, -0.5, 84);
    assert.equal(reversedUp.shouldDismiss, false);
  });

  it('classifies left-edge back swipe and horizontal navigation swipes', () => {
    const edgeBack = classifyHorizontalSwipe({
      startX: 18,
      startY: 300,
      endX: 120,
      endY: 308,
      durationMs: 220,
    });
    assert.equal(edgeBack, 'edge-back');

    const nextItem = classifyHorizontalSwipe({
      startX: 280,
      startY: 300,
      endX: 160,
      endY: 310,
      durationMs: 210,
    });
    assert.equal(nextItem, 'next-item');

    const anywhereBack = classifyHorizontalSwipe({
      startX: 210,
      startY: 420,
      endX: 320,
      endY: 424,
      durationMs: 180,
      edgeThreshold: Number.POSITIVE_INFINITY,
    });
    assert.equal(anywhereBack, 'edge-back');
  });

  it('detects double-tap within time and distance thresholds', () => {
    assert.equal(
      isDoubleTapGesture({
        lastTapTime: 1000,
        currentTime: 1210,
        lastX: 150,
        lastY: 200,
        currentX: 158,
        currentY: 204,
      }),
      true
    );
  });

  it('resolves scrubbed tab index accurately across TabBar width', () => {
    assert.equal(resolveScrubbedTabIndex(60, 40, 320, 4), 0);
    assert.equal(resolveScrubbedTabIndex(150, 40, 320, 4), 1);
    assert.equal(resolveScrubbedTabIndex(230, 40, 320, 4), 2);
    assert.equal(resolveScrubbedTabIndex(340, 40, 320, 4), 3);
  });
});
