import React, { useRef, useEffect, useState } from 'react';
import { Newspaper, Bookmark, Rss, Settings } from 'lucide-react';
import { triggerHapticSelection } from '../utils/haptics';

export type TabType = 'stories' | 'saved' | 'feeds' | 'tags';

interface TabBarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  unreadCount?: number;
  isVisible?: boolean;
  isDark?: boolean;
}

const TABS = [
  { id: 'stories' as TabType, label: 'Newsfeed', icon: Newspaper },
  { id: 'saved'   as TabType, label: 'Saved',    icon: Bookmark   },
  { id: 'feeds'   as TabType, label: 'Sources',  icon: Rss        },
  { id: 'tags'    as TabType, label: 'Tags',     icon: Settings   },
];

export const TabBar: React.FC<TabBarProps> = ({
  currentTab,
  onSelectTab,
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
      className={`shrink-0 px-4 pt-1.5 pb-[max(env(safe-area-inset-bottom,0px),12px)] select-none z-40 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isVisible ? 'translate-y-0' : 'translate-y-full pointer-events-none'
      }`}
    >
      <nav
        aria-label="Main Navigation"
        className="liquid-glass-dock mx-auto max-w-md rounded-[28px] px-2 py-1.5 flex items-center justify-around"
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
              className="flex-1 min-h-[46px] flex flex-col items-center justify-center gap-0.5 relative rounded-[22px] transition-colors"
              style={{
                transform: isPressed ? 'scale(0.88) translateZ(0)' : 'scale(1) translateZ(0)',
                transition: isPressed
                  ? 'transform 80ms cubic-bezier(0.4,0,1,1)'
                  : 'transform 320ms cubic-bezier(0.175,0.885,0.32,1.275)',
              }}
            >
              {/* Active iOS 26 Liquid Glass Pill Indicator */}
              {isActive && (
                <span
                  className="absolute inset-x-1.5 inset-y-0.5 rounded-[20px] pointer-events-none"
                  style={{
                    background: isDark
                      ? 'linear-gradient(145deg, rgba(255,103,25,0.22) 0%, rgba(255,103,25,0.08) 100%)'
                      : 'linear-gradient(145deg, rgba(255,103,25,0.16) 0%, rgba(255,103,25,0.06) 100%)',
                    boxShadow: isDark
                      ? 'inset 0 1px 0.5px rgba(255,255,255,0.22), 0 4px 12px rgba(255,103,25,0.15)'
                      : 'inset 0 1px 0.5px rgba(255,255,255,0.85), 0 4px 12px rgba(255,103,25,0.12)',
                    animation: 'tabIndicatorIn 260ms cubic-bezier(0.175,0.885,0.32,1.275) both',
                  }}
                  aria-hidden="true"
                />
              )}

              {/* Icon wrapper */}
              <span className="relative flex items-center justify-center w-6 h-6 z-10">
                <Icon
                  style={{
                    width: isActive ? 20 : 19,
                    height: isActive ? 20 : 19,
                    strokeWidth: isActive ? 2.2 : 1.75,
                    color: isActive
                      ? '#FF6719'
                      : isDark ? '#9CA3AF' : '#57534E',
                    filter: isActive ? 'drop-shadow(0 0 8px rgba(255,103,25,0.35))' : 'none',
                    transition: 'color 200ms ease, stroke-width 200ms ease',
                  }}
                />

                {/* Unread count dot/badge */}
                {showBadge && (
                  <span
                    aria-label={`${unreadCount} unread`}
                    className="absolute -top-1 -right-3 min-w-[16px] h-[15px] px-1 bg-[#FF6719] text-white text-[9px] font-mono tabular-nums font-bold rounded-full flex items-center justify-center"
                    style={{ boxShadow: '0 2px 6px rgba(255,103,25,0.5)' }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>

              {/* Label */}
              <span
                className="text-[10px] tracking-tight font-semibold whitespace-nowrap z-10 transition-colors duration-200"
                style={{
                  color: isActive
                    ? '#FF6719'
                    : isDark ? '#9CA3AF' : '#57534E',
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
