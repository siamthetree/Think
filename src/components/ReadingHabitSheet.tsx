import React, { useState, useRef } from 'react';
import { X, Flame, BookOpen, Clock, CheckCircle2 } from 'lucide-react';
import type { ReadingHabitState } from '../utils/feedIntelligence';
import { triggerHapticSelection } from '../utils/haptics';
import { computeSheetDragState } from '../utils/touchGestures';

interface ReadingHabitSheetProps {
  isOpen: boolean;
  onClose: () => void;
  habit: ReadingHabitState;
  onChangeDailyGoal: (goal: number) => void;
}

export const ReadingHabitSheet: React.FC<ReadingHabitSheetProps> = ({
  isOpen,
  onClose,
  habit,
  onChangeDailyGoal,
}) => {
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragStartRef = useRef<{ y: number; time: number } | null>(null);

  if (!isOpen) return null;

  const readToday = habit.todayReadIds.length;
  const goal = Math.max(1, habit.dailyGoal || 3);
  const progressRatio = Math.min(1, readToday / goal);
  const isGoalReached = readToday >= goal;

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - progressRatio * circumference;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragStartRef.current = { y: e.clientY, time: Date.now() };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    if (e.pointerType !== 'touch' && e.buttons !== 1) return;
    const dy = e.clientY - dragStartRef.current.y;
    const state = computeSheetDragState(dy, 0, 84);
    setDragOffsetY(state.offsetY);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dy = e.clientY - dragStartRef.current.y;
    const dt = Math.max(1, Date.now() - dragStartRef.current.time);
    const velocityY = dy / dt;
    dragStartRef.current = null;

    const state = computeSheetDragState(dy, velocityY, 84);
    setDragOffsetY(0);
    if (state.shouldDismiss) {
      triggerHapticSelection();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Daily Reading Habit and Streak"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-8 bg-black/55 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        style={{
          touchAction: 'none',
          transform: dragOffsetY !== 0 ? `translate3d(0, ${dragOffsetY}px, 0)` : undefined,
          transition:
            dragOffsetY !== 0 ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        className="w-full max-w-sm rounded-3xl reader-liquid-card p-5 text-stone-100 shadow-2xl border border-white/20 animate-in zoom-in-95 duration-150 select-none"
      >
        {/* Drag Handle (Swipe down to dismiss) */}
        <div className="w-10 h-1 bg-white/25 rounded-full mx-auto mb-3 cursor-grab active:cursor-grabbing" />

        <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-white/10">
          <span className="text-xs font-semibold text-stone-200">
            Mindful Reading Habit
          </span>
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              onClose();
            }}
            aria-label="Close reading habit sheet"
            className="min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Center Ring + Goal Status */}
        <div className="flex items-center gap-4 mb-5 p-3.5 rounded-2xl bg-black/30 border border-white/10">
          <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
              <circle
                cx="48"
                cy="48"
                r={radius}
                fill="none"
                strokeWidth="7"
                className="stroke-white/10"
              />
              <circle
                cx="48"
                cy="48"
                r={radius}
                fill="none"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className={`${
                  isGoalReached ? 'stroke-emerald-400' : 'stroke-[#FF6719]'
                } transition-all duration-500`}
              />
            </svg>
            <div className="absolute text-center">
              <span className="font-mono text-lg font-bold tabular-nums text-white block leading-none">
                {readToday}/{goal}
              </span>
              <span className="text-[10px] text-stone-400 mt-0.5 block">stories</span>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#FF6719] mb-1">
              {isGoalReached ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Daily Goal Complete</span>
                </>
              ) : (
                <span>Today’s Progress</span>
              )}
            </div>
            <h3 className="font-serif text-base font-bold text-white leading-snug mb-1">
              {isGoalReached
                ? 'You hit your mindful reading target today.'
                : `Read ${Math.max(0, goal - readToday)} more ${
                    goal - readToday === 1 ? 'story' : 'stories'
                  } to complete your ring.`}
            </h3>
            <p className="text-xs text-stone-400">
              Focused reading without algorithmic noise.
            </p>
          </div>
        </div>

        {/* 2-Column Stat Cards */}
        <div className="grid grid-cols-2 gap-2.5 mb-5">
          <div className="p-3 rounded-2xl bg-black/25 border border-white/10">
            <div className="flex items-center gap-1.5 text-xs text-stone-400 mb-1">
              <Flame className="w-3.5 h-3.5 text-[#FF6719]" />
              <span>Reading Streak</span>
            </div>
            <div className="font-mono text-xl font-bold tabular-nums text-white">
              {habit.streakDays} {habit.streakDays === 1 ? 'day' : 'days'}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-black/25 border border-white/10">
            <div className="flex items-center gap-1.5 text-xs text-stone-400 mb-1">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Mindful Time</span>
            </div>
            <div className="font-mono text-xl font-bold tabular-nums text-white">
              {habit.todayMinutes} min
            </div>
          </div>
        </div>

        {/* Daily Target Selector */}
        <div>
          <div className="flex items-center justify-between text-xs text-stone-400 mb-2">
            <span className="flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Daily Story Target</span>
            </span>
            <span className="font-mono tabular-nums text-stone-300">{goal} stories / day</span>
          </div>

          <div className="grid grid-cols-3 gap-2 p-1 bg-black/40 border border-white/10 rounded-2xl">
            {[3, 5, 7].map((target) => {
              const active = goal === target;
              return (
                <button
                  key={target}
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    onChangeDailyGoal(target);
                  }}
                  className={`py-2 rounded-xl text-xs font-semibold transition-all tabular-nums ${
                    active
                      ? 'liquid-glass-dock text-white ring-1 ring-white/25 shadow-sm'
                      : 'text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {target} Stories
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
