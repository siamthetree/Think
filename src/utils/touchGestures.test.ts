import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rubberBand,
  computeSwipeActionState,
  computePinchFontSize,
  computeSheetDragState,
  classifyHorizontalSwipe,
  isDoubleTapGesture,
  resolveScrubbedTabIndex,
} from './touchGestures.ts';

describe('touchGestures engine', () => {
  it('computes rubberBand resistance symmetrically', () => {
    const pos = rubberBand(100, 120);
    const neg = rubberBand(-100, 120);
    assert.ok(pos > 0 && pos < 100);
    assert.equal(pos, -neg);
  });

  it('computes horizontal card swipe actions and arms past threshold', () => {
    // Small jitter is ignored
    const jitter = computeSwipeActionState(5, 2, 72, 128);
    assert.equal(jitter.offsetX, 0);
    assert.equal(jitter.armed, false);

    // Predominantly vertical scroll is ignored
    const vertical = computeSwipeActionState(18, 48, 72, 128);
    assert.equal(vertical.offsetX, 0);
    assert.equal(vertical.direction, 'none');

    // Right swipe past threshold arms bookmark action
    const rightSwipe = computeSwipeActionState(92, 6, 72, 128);
    assert.equal(rightSwipe.direction, 'right');
    assert.equal(rightSwipe.armed, true);
    assert.ok(rightSwipe.offsetX >= 72 && rightSwipe.offsetX <= 128);

    // Left swipe past threshold arms read/action state
    const leftSwipe = computeSwipeActionState(-95, 4, 72, 128);
    assert.equal(leftSwipe.direction, 'left');
    assert.equal(leftSwipe.armed, true);
    assert.ok(leftSwipe.offsetX <= -72 && leftSwipe.offsetX >= -128);
  });

  it('scales reader font size smoothly on two-finger pinch and clamps bounds', () => {
    const enlarged = computePinchFontSize(100, 140, 18, 14, 26);
    assert.ok(enlarged > 18 && enlarged <= 26);

    const shrunk = computePinchFontSize(140, 90, 18, 14, 26);
    assert.ok(shrunk < 18 && shrunk >= 14);

    // Clamps to max/min limits
    assert.equal(computePinchFontSize(100, 300, 22, 14, 26), 26);
    assert.equal(computePinchFontSize(300, 60, 16, 14, 26), 14);
  });

  it('computes bottom sheet drag-to-dismiss physics', () => {
    // Upward pull gets rubber-banded
    const upward = computeSheetDragState(-50, 0, 84);
    assert.ok(upward.offsetY < 0 && upward.offsetY > -36);
    assert.equal(upward.shouldDismiss, false);

    // Pulling down past threshold triggers dismiss
    const downward = computeSheetDragState(96, 0.2, 84);
    assert.equal(downward.offsetY, 96);
    assert.equal(downward.shouldDismiss, true);
    assert.ok(downward.backdropScale < 1);

    // High downward flick velocity triggers dismiss even with shorter distance
    const fastFlick = computeSheetDragState(48, 0.9, 84);
    assert.equal(fastFlick.shouldDismiss, true);
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

    const prevItem = classifyHorizontalSwipe({
      startX: 120,
      startY: 300,
      endX: 240,
      endY: 295,
      durationMs: 210,
    });
    assert.equal(prevItem, 'prev-item');
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

    // Too slow
    assert.equal(
      isDoubleTapGesture({
        lastTapTime: 1000,
        currentTime: 1500,
        lastX: 150,
        lastY: 200,
        currentX: 152,
        currentY: 202,
      }),
      false
    );

    // Too far apart
    assert.equal(
      isDoubleTapGesture({
        lastTapTime: 1000,
        currentTime: 1180,
        lastX: 100,
        lastY: 200,
        currentX: 220,
        currentY: 200,
      }),
      false
    );
  });

  it('resolves scrubbed tab index accurately across TabBar width', () => {
    assert.equal(resolveScrubbedTabIndex(60, 40, 320, 4), 0);
    assert.equal(resolveScrubbedTabIndex(150, 40, 320, 4), 1);
    assert.equal(resolveScrubbedTabIndex(230, 40, 320, 4), 2);
    assert.equal(resolveScrubbedTabIndex(340, 40, 320, 4), 3);
  });
});
