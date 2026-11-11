import React, { useRef, useEffect, useState } from 'react';
import { Home, BookOpen, Rss, Tag as TagIcon, Plus } from 'lucide-react';
import { triggerHapticSelection } from '../utils/haptics';

export type TabType = 'stories' | 'saved' | 'feeds' | 'tags';

interface TabBarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onQuickAction?: () => void;
  unreadCount?: number;
  isVisible?: boolean;
  isDark?: boolean;
}

const TABS = [
  { id: 'stories' as TabType, label: 'Home',    icon: Home     },
  { id: 'saved'   as TabType, label: 'Read',    icon: BookOpen },
  { id: 'feeds'   as TabType, label: 'Sources', icon: Rss      },
  { id: 'tags'    as TabType, label: 'Topics',  icon: TagIcon  },
];

export const TabBar: React.FC<TabBarProps> = ({
  currentTab,
  onSelectTab,
  onQuickAction,
  unreadCount = 0,
  isVisible = true,
  isDark = true,
}) => {
  const [pressedTab, setPressedTab] = useState<TabType | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTabPress = (tabId: TabType) => {
    triggerHapticSelection();

    setPressedTab(tabId);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressedTab(null), 160);

    onSelectTab(tabId);
  };

  useEffect(() => () => { if (pressTimer.current) clearTimeout(pressTimer.current); }, []);

  return (
    <div
      className={`absolute left-0 right-0 bottom-0 px-3.5 pb-[max(env(safe-area-inset-bottom,8px),8px)] pt-1 select-none z-40 pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isVisible
          ? 'translate-y-0 opacity-100'
          : 'translate-y-20 opacity-0'
      }`}
    >
      <div className="relative mx-auto max-w-[310px]">
        {/* Floating Compact Orange '+' Action Button */}
        {onQuickAction && (
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              onQuickAction();
            }}
            aria-label="Add news source"
            title="Add news source"
            className="pointer-events-auto absolute -top-12 right-0.5 w-10 h-10 rounded-full bg-[#FF6719] hover:bg-[#ff5700] active:scale-90 text-white flex items-center justify-center transition-transform duration-200 shadow-[0_6px_18px_rgba(255,103,25,0.45),inset_0_1px_1px_rgba(255,255,255,0.4)]"
          >
            <Plus className="w-5 h-5 stroke-[2.4]" />
          </button>
        )}

        {/* Compact Translucent Refractive 3D Liquid Glass Capsule Dock */}
        <nav
          aria-label="Main Navigation"
          className="pointer-events-auto liquid-glass-dock rounded-full p-1 px-1.5 flex items-center justify-between gap-0.5"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            const isPressed = pressedTab === tab.id;
            const showBadge = tab.id === 'stories' && unreadCount > 0;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabPress(tab.id)}
                aria-label={tab.label}
                aria-selected={isActive}
                role="tab"
                className="flex-1 min-h-[44px] flex flex-col items-center justify-center gap-0.5 relative rounded-full transition-colors"
                style={{
                  transform: isPressed ? 'scale(0.88) translateZ(0)' : 'scale(1) translateZ(0)',
                  transition: isPressed
                    ? 'transform 80ms cubic-bezier(0.4,0,1,1)'
                    : 'transform 320ms cubic-bezier(0.175,0.885,0.32,1.275)',
                }}
              >
                {/* Recessed Smoked-Glass Active Pill Bubble */}
                {isActive && (
                  <span
                    className="liquid-glass-active-bubble absolute inset-0.5 rounded-full pointer-events-none"
                    style={{
                      animation: 'tabIndicatorIn 260ms cubic-bezier(0.175,0.885,0.32,1.275) both',
                    }}
                    aria-hidden="true"
                  />
                )}

                {/* Icon wrapper */}
                <span className="relative flex items-center justify-center w-5 h-5 z-10">
                  <Icon
                    style={{
                      width: 18,
                      height: 18,
                      strokeWidth: isActive ? 2.2 : 1.85,
                      color: isDark
                        ? isActive
                          ? '#FFFFFF'
                          : 'rgba(255, 255, 255, 0.85)'
                        : isActive
                          ? '#111827'
                          : 'rgba(28, 25, 23, 0.78)',
                      filter: isDark
                        ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.45))'
                        : 'none',
                      transition: 'color 200ms ease, stroke-width 200ms ease',
                    }}
                  />

                  {/* Unread count badge */}
                  {showBadge && (
                    <span
                      aria-label={`${unreadCount} unread`}
                      className="absolute -top-1 -right-3 min-w-[15px] h-[14px] px-1 bg-[#FF6719] text-white text-[8.5px] font-mono tabular-nums font-bold rounded-full flex items-center justify-center"
                      style={{ boxShadow: '0 2px 6px rgba(255,103,25,0.5)' }}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>

                {/* Label */}
                <span
                  className="text-[10px] tracking-tight font-medium whitespace-nowrap z-10 transition-colors duration-200"
                  style={{
                    color: isDark
                      ? isActive
                        ? '#FFFFFF'
                        : 'rgba(255, 255, 255, 0.85)'
                      : isActive
                        ? '#111827'
                        : 'rgba(28, 25, 23, 0.78)',
                    textShadow: isDark ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
                  }}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};
