import React from 'react';
import type { Feed } from '../types';
import { SourceAvatar } from './SourceAvatar';
import { triggerHapticSelection } from '../utils/haptics';

interface FeedChipBarProps {
  feeds: Feed[];
  selectedFeedId: string | null;
  onSelectAll: () => void;
  onSelectFeed: (feed: Feed) => void;
  unreadCountByFeed?: Record<string, number>;
  totalUnread?: number;
}

export const FeedChipBar: React.FC<FeedChipBarProps> = ({
  feeds,
  selectedFeedId,
  onSelectAll,
  onSelectFeed,
  unreadCountByFeed = {},
  totalUnread = 0,
}) => (
  <div
    className="feed-chip-bar no-scrollbar flex items-center gap-1.5 overflow-x-auto py-1 px-4 -mx-4 select-none"
    role="tablist"
    aria-label="Filter by newspaper source"
  >
    <button
      type="button"
      role="tab"
      aria-selected={!selectedFeedId}
      onClick={() => {
        triggerHapticSelection();
        onSelectAll();
      }}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-all active:scale-95 ${
        !selectedFeedId
          ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 shadow-xs'
          : 'bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-300/80 dark:hover:bg-stone-700'
      }`}
    >
      <span>All</span>
      {totalUnread > 0 && (
        <span
          className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
            !selectedFeedId
              ? 'bg-stone-700 text-stone-100 dark:bg-stone-300 dark:text-stone-900'
              : 'bg-stone-300 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
          }`}
        >
          {totalUnread > 99 ? '99+' : totalUnread}
        </span>
      )}
    </button>

    {feeds.map((feed) => {
      const isSelected = selectedFeedId === feed.id;
      const unread = unreadCountByFeed[feed.id] || 0;

      return (
        <button
          key={feed.id}
          type="button"
          role="tab"
          aria-selected={isSelected}
          onClick={() => {
            triggerHapticSelection();
            onSelectFeed(feed);
          }}
          className={`px-2.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-all active:scale-95 ${
            isSelected
              ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 shadow-xs'
              : 'bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-300/80 dark:hover:bg-stone-700'
          }`}
        >
          <SourceAvatar name={feed.title} url={feed.url} size="sm" />
          <span className="truncate max-w-[120px]">{feed.title}</span>
          {unread > 0 && (
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
                isSelected
                  ? 'bg-[#FF6719] text-white'
                  : 'bg-stone-300 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
              }`}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      );
    })}
  </div>
);
