import React, { useState } from 'react';
import {
  Bookmark,
  Share2,
  Heart,
  Repeat2,
  MessageSquare,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import type { FeedItem } from '../types';
import { formatRelativeTime } from '../utils/feedParser';
import { SourceAvatar } from './SourceAvatar';

interface ArticleCardProps {
  article: FeedItem;
  viewMode?: 'magazine' | 'compact';
  onSelect: (article: FeedItem) => void;
  onToggleBookmark: (id: string, e: React.MouseEvent) => void;
  onToggleRead: (id: string, e: React.MouseEvent) => void;
  onOpenTagManager?: (article: FeedItem, e: React.MouseEvent) => void;
}

export const ArticleCard: React.FC<ArticleCardProps> = ({
  article,
  viewMode = 'magazine',
  onSelect,
  onToggleBookmark,
  onToggleRead,
}) => {
  const readTime = article.readTimeMin || 3;

  // Stable pseudo-random engagement counts based on article ID hash
  const pseudoCount = (seed: string, min: number, max: number) => {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return min + (Math.abs(hash) % (max - min + 1));
  };

  const initialLikes = pseudoCount(article.id + '_like', 18, 142);
  const initialRestacks = pseudoCount(article.id + '_re', 4, 38);
  const initialComments = pseudoCount(article.id + '_com', 2, 29);

  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(initialLikes);
  const [isRestacked, setIsRestacked] = useState(false);
  const [restacksCount, setRestacksCount] = useState(initialRestacks);
  const [isCopied, setIsCopied] = useState(false);
  // Spring-pop animation state flags
  const [likePopping, setLikePopping] = useState(false);
  const [bmPopping,   setBmPopping]   = useState(false);
  const [cardPressed, setCardPressed] = useState(false);

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Trigger spring-pop animation
    setLikePopping(true);
    setTimeout(() => setLikePopping(false), 400);
    setIsLiked((prev) => {
      const next = !prev;
      setLikesCount((c) => (next ? c + 1 : c - 1));
      return next;
    });
  };

  const handleRestack = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRestacked((prev) => {
      const next = !prev;
      setRestacksCount((c) => (next ? c + 1 : c - 1));
      return next;
    });
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      try {
        await navigator.share({
          title: article.title,
          text: article.summary,
          url: article.link,
        });
        return;
      } catch {
        // Fall back to copy
      }
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(article.link);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // Substack Compact Scanner View
  if (viewMode === 'compact') {
    return (
      <article
        onClick={() => onSelect(article)}
        className={`group cursor-pointer px-4 sm:px-5 py-3 border-b border-stone-200/60 dark:border-stone-800/70 hover:bg-stone-100/50 dark:hover:bg-stone-900/40 transition-colors flex items-center justify-between gap-3 select-none ${
          article.isRead ? 'opacity-70' : ''
        }`}
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <SourceAvatar name={article.feedTitle} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 mb-0.5">
              <span className="font-semibold text-stone-700 dark:text-stone-300 truncate max-w-[120px]">
                {article.feedTitle}
              </span>
              <span>·</span>
              <span className="whitespace-nowrap">{formatRelativeTime(article.timestamp)}</span>
            </div>
            <h2
              className={`text-sm truncate font-serif ${
                article.isRead
                  ? 'text-stone-500 dark:text-stone-400 font-normal'
                  : 'text-stone-900 dark:text-stone-100 font-bold group-hover:text-[#FF6719] transition-colors'
              }`}
            >
              {article.title}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => onToggleBookmark(article.id, e)}
            aria-label={article.isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
            className={`p-1.5 rounded-full hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors ${
              article.isBookmarked
                ? 'text-[#FF6719]'
                : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${article.isBookmarked ? 'fill-current' : ''}`} />
          </button>
        </div>
      </article>
    );
  }

  // Authentic Substack Home Page Post Card (Large Featured Image & Bold Editorial Typography)
  return (
    <article
      onClick={() => onSelect(article)}
      onPointerDown={() => setCardPressed(true)}
      onPointerUp={() => setCardPressed(false)}
      onPointerCancel={() => setCardPressed(false)}
      className={`article-card group cursor-pointer px-4 sm:px-5 pt-4 pb-3.5 border-b border-stone-200/70 dark:border-stone-800/80 select-none ${
        article.isRead ? 'feed-row-read opacity-85' : ''
      }`}
      style={{
        transform:  cardPressed ? 'scale(0.983) translateZ(0)' : 'scale(1) translateZ(0)',
        background: cardPressed ? 'rgba(0,0,0,0.03)' : 'transparent',
        transition: cardPressed
          ? 'transform 90ms cubic-bezier(0.4,0,1,1), background 90ms ease'
          : 'transform 380ms cubic-bezier(0.175,0.885,0.32,1.275), background 180ms ease',
      }}
    >
      {/* 1. Substack Byline Header Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <SourceAvatar name={article.feedTitle} size="sm" />
          <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 truncate">
            <span className="font-semibold text-stone-800 dark:text-stone-200 truncate max-w-[150px] sm:max-w-xs">
              {article.feedTitle}
            </span>
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-600">·</span>
            <span className="whitespace-nowrap">{formatRelativeTime(article.timestamp)}</span>
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-600">·</span>
            <span className="whitespace-nowrap flex items-center gap-1">
              <Clock className="w-3 h-3 text-stone-400" />
              {readTime}m read
            </span>
          </div>
        </div>

        {/* Unread Pill or Read Status */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!article.isRead ? (
            <span className="w-2 h-2 rounded-full bg-[#FF6719] shadow-xs" title="Unread story" />
          ) : (
            <button
              onClick={(e) => onToggleRead(article.id, e)}
              title="Mark as unread"
              className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Headline: High-Contrast Editorial Serif */}
      <h2
        className={`font-serif text-[20px] sm:text-[22px] font-bold leading-[1.3] text-stone-950 dark:text-stone-50 group-hover:text-[#FF6719] transition-colors mb-1.5 ${
          article.isRead ? 'text-stone-600 dark:text-stone-400 font-semibold' : ''
        }`}
        style={{ textWrap: 'balance' }}
      >
        {article.title}
      </h2>

      {/* 3. Subtitle / Excerpt: Clean Editorial Prose */}
      <p
        className={`font-sans text-[14px] leading-relaxed line-clamp-2 sm:line-clamp-3 mb-3 ${
          article.isRead
            ? 'text-stone-500 dark:text-stone-400'
            : 'text-stone-600 dark:text-stone-300'
        }`}
      >
        {article.summary}
      </p>

      {/* 4. Large Featured Cover Image (16:9 Aspect Ratio) */}
      {article.imageUrl && (
        <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden bg-stone-100 dark:bg-stone-900/90 border border-stone-200/60 dark:border-stone-800/60 mb-3 shadow-xs">
          <img
            src={article.imageUrl}
            alt={article.title}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.015] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            onError={(e) => {
              (e.target as HTMLElement).parentElement!.style.display = 'none';
            }}
          />
        </div>
      )}

      {/* 5. Substack Signature Social Action Ribbon */}
      <div
        className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 pt-1 border-t border-stone-100 dark:border-stone-800/40"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Like, Restack, Comment */}
        <div className="flex items-center gap-4 sm:gap-6">
          {/* Substack Heart / Like Button */}
          <button
            onClick={handleLike}
            aria-label="Like story"
            className={`flex items-center gap-1.5 py-1 px-1 -ml-1 rounded-lg transition-all ${
              isLiked
                ? 'text-[#FF4B4B] font-semibold'
                : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
            }`}
          >
            <Heart
              className={`w-4 h-4 transition-transform active:scale-125 duration-150 ${
                isLiked ? 'fill-[#FF4B4B] text-[#FF4B4B]' : 'stroke-[1.75]'
              } ${likePopping ? 'like-pop' : ''}`}
            />
            <span className="text-[12px]">{likesCount}</span>
          </button>

          {/* Substack Restack / Note Loop */}
          <button
            onClick={handleRestack}
            aria-label="Restack story"
            className={`flex items-center gap-1.5 py-1 px-1 rounded-lg transition-all ${
              isRestacked
                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
            }`}
          >
            <Repeat2
              className={`w-4 h-4 transition-transform active:rotate-180 duration-200 ${
                isRestacked ? 'text-emerald-600 dark:text-emerald-400 stroke-[2.2]' : 'stroke-[1.75]'
              }`}
            />
            <span className="text-[12px]">{restacksCount}</span>
          </button>

          {/* Substack Comment Bubble */}
          <button
            onClick={() => onSelect(article)}
            aria-label="View story and comments"
            className="flex items-center gap-1.5 py-1 px-1 rounded-lg text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
          >
            <MessageSquare className="w-4 h-4 stroke-[1.75]" />
            <span className="text-[12px]">{initialComments}</span>
          </button>
        </div>

        {/* Right: Share & Bookmark */}
        <div className="flex items-center gap-1">
          {/* Share Action */}
          <button
            onClick={handleShare}
            aria-label="Share story link"
            title="Share story"
            className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors relative min-w-[32px] min-h-[32px] flex items-center justify-center"
          >
            <Share2 className="w-4 h-4 stroke-[1.75]" />
            {isCopied && (
              <span className="absolute -top-7 right-0 px-2 py-0.5 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 rounded-md text-[10px] font-medium shadow-md whitespace-nowrap animate-in fade-in duration-100">
                Copied!
              </span>
            )}
          </button>

          {/* Bookmark / Save Action */}
          <button
            onClick={(e) => onToggleBookmark(article.id, e)}
            aria-label={article.isBookmarked ? 'Remove from Saved' : 'Save story'}
            title={article.isBookmarked ? 'Saved to Bookmarks' : 'Save to Bookmarks'}
            className={`p-1.5 rounded-full transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center ${
              article.isBookmarked
                ? 'text-[#FF6719] bg-orange-50 dark:bg-orange-950/40'
                : 'text-stone-400 hover:text-[#FF6719] hover:bg-stone-200/60 dark:hover:bg-stone-800'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${article.isBookmarked ? 'fill-current' : 'stroke-[1.75]'}`} />
          </button>
        </div>
      </div>
    </article>
  );
};
