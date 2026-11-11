import React, { useRef, useEffect, useState } from 'react';
import { Newspaper, Bookmark, Rss, Settings, PenSquare } from 'lucide-react';

export type TabType = 'stories' | 'write' | 'saved' | 'feeds' | 'tags';

interface TabBarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  unreadCount?: number;
  isVisible?: boolean;
  isDark?: boolean;
}

const TABS = [
  { id: 'stories' as TabType, label: 'Today',   icon: Newspaper },
  { id: 'write'   as TabType, label: 'Write',   icon: PenSquare  },
  { id: 'saved'   as TabType, label: 'Saved',   icon: Bookmark   },
  { id: 'feeds'   as TabType, label: 'Feeds',   icon: Rss        },
  { id: 'tags'    as TabType, label: 'Settings', icon: Settings   },
];

export const TabBar: React.FC<TabBarProps> = ({
  currentTab,
  onSelectTab,
  unreadCount = 0,
  isVisible = true,
  isDark = true,
}) => {
  // Track which tab was just tapped for press feedback
  const [pressedTab, setPressedTab] = useState<TabType | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTabPress = (tabId: TabType) => {
    if (tabId === currentTab) return;

    // Brief tactile press state (matches iOS 50ms feedback window)
    setPressedTab(tabId);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressedTab(null), 160);

    onSelectTab(tabId);
  };

  useEffect(() => () => { if (pressTimer.current) clearTimeout(pressTimer.current); }, []);

  return (
    <nav
      aria-label="Main Navigation"
      className={`
        shrink-0 flex items-end justify-around px-1 select-none
        transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${isVisible ? 'translate-y-0' : 'translate-y-full pointer-events-none'}
        ${isDark
          ? 'bg-[rgba(10,10,12,0.90)] border-t border-white/[0.07] shadow-[0_-20px_40px_rgba(0,0,0,0.35)]'
          : 'bg-[rgba(252,251,249,0.92)] border-t border-black/[0.08] shadow-[0_-20px_40px_rgba(0,0,0,0.07)]'
        }
        pt-2 pb-[max(env(safe-area-inset-bottom,0px),14px)]
        backdrop-blur-[32px] saturate-200
      `}
      style={{ WebkitBackdropFilter: 'blur(32px) saturate(200%)' }}
    >
      {TABS.map((tab) => {
        const Icon     = tab.icon;
        const isActive = currentTab === tab.id;
        const isPressed = pressedTab === tab.id;
        const showBadge = tab.id === 'stories' && unreadCount > 0;

        return (
          <button
            key={tab.id}
            onClick={() => handleTabPress(tab.id)}
            aria-label={tab.label}
            aria-selected={isActive}
            role="tab"
            className="flex-1 flex flex-col items-center justify-end gap-[3px] pb-[2px] relative"
            style={{
              minHeight: 44,
              // GPU-composited transform for the press spring
              transform: isPressed ? 'scale(0.84) translateZ(0)' : 'scale(1) translateZ(0)',
              transition: isPressed
                ? 'transform 80ms cubic-bezier(0.4,0,1,1)'
                : 'transform 300ms cubic-bezier(0.175,0.885,0.32,1.275)',
            }}
          >
            {/* Active background pill */}
            {isActive && (
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2"
                style={{
                  width: 40,
                  height: 36,
                  borderRadius: 11,
                  background: isDark
                    ? 'rgba(255,103,25,0.13)'
                    : 'rgba(255,103,25,0.10)',
                  animation: 'tabIndicatorIn 280ms cubic-bezier(0.175,0.885,0.32,1.275) both',
                }}
                aria-hidden="true"
              />
            )}

            {/* Icon wrapper (z-index above pill) */}
            <span className="relative flex items-center justify-center" style={{ width: 28, height: 28, zIndex: 1 }}>
              <Icon
                className="transition-all duration-200"
                style={{
                  width:      isActive ? 22 : 21,
                  height:     isActive ? 22 : 21,
                  strokeWidth: isActive ? 2.1 : 1.65,
                  color: isActive
                    ? '#FF6719'
                    : isDark ? '#6B7280' : '#78716C',
                  filter: isActive ? 'drop-shadow(0 0 6px rgba(255,103,25,0.4))' : 'none',
                  transition: 'color 220ms ease, stroke-width 220ms ease, filter 220ms ease',
                }}
              />

              {/* Unread badge */}
              {showBadge && (
                <span
                  aria-label={`${unreadCount} unread`}
                  className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 bg-[#FF6719] text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-sm"
                  style={{ boxShadow: '0 0 6px rgba(255,103,25,0.6)' }}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </span>

            {/* Label */}
            <span
              className="text-[10px] tracking-tight font-medium whitespace-nowrap transition-colors duration-200"
              style={{
                color: isActive
                  ? '#FF6719'
                  : isDark ? '#6B7280' : '#78716C',
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
