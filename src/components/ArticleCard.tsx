import React, { useState } from 'react';
import {
  Bookmark,
  Share2,
  Heart,
  Repeat2,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';
import type { FeedItem } from '../types';
import { formatRelativeTime } from '../utils/feedParser';
import { SourceAvatar } from './SourceAvatar';
import { triggerHapticSelection } from '../utils/haptics';

interface ArticleCardProps {
  article: FeedItem;
  viewMode?: 'magazine' | 'compact';
  onSelect: (article: FeedItem) => void;
  onToggleBookmark: (id: string, e: React.MouseEvent) => void;
  onToggleRead: (id: string, e: React.MouseEvent) => void;
  onOpenTagManager?: (article: FeedItem, e: React.MouseEvent) => void;
}

// Rich atmospheric card palettes (matching the warm terracotta & olive-green cards in the reference photo)
const CARD_TINTS = [
  {
    solid: 'linear-gradient(165deg, #2D3823 0%, #242E1B 100%)',
    overlay:
      'linear-gradient(to top, rgba(45, 56, 35, 0.98) 0%, rgba(45, 56, 35, 0.88) 42%, rgba(45, 56, 35, 0.25) 75%, rgba(45, 56, 35, 0) 100%)',
  },
  {
    solid: 'linear-gradient(165deg, #4A2825 0%, #381D1B 100%)',
    overlay:
      'linear-gradient(to top, rgba(74, 40, 37, 0.98) 0%, rgba(74, 40, 37, 0.88) 42%, rgba(74, 40, 37, 0.25) 75%, rgba(74, 40, 37, 0) 100%)',
  },
  {
    solid: 'linear-gradient(165deg, #1F2D3A 0%, #16212B 100%)',
    overlay:
      'linear-gradient(to top, rgba(31, 45, 58, 0.98) 0%, rgba(31, 45, 58, 0.88) 42%, rgba(31, 45, 58, 0.25) 75%, rgba(31, 45, 58, 0) 100%)',
  },
  {
    solid: 'linear-gradient(165deg, #3A2D21 0%, #2A2017 100%)',
    overlay:
      'linear-gradient(to top, rgba(58, 45, 33, 0.98) 0%, rgba(58, 45, 33, 0.88) 42%, rgba(58, 45, 33, 0.25) 75%, rgba(58, 45, 33, 0) 100%)',
  },
];

export const ArticleCard: React.FC<ArticleCardProps> = ({
  article,
  viewMode = 'magazine',
  onSelect,
  onToggleBookmark,
  onToggleRead,
}) => {
  const readTime = article.readTimeMin || 3;

  // Stable pseudo-random engagement counts and card tint based on article ID hash
  const pseudoCount = (seed: string, min: number, max: number) => {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return min + (Math.abs(hash) % (max - min + 1));
  };

  const tintIndex = pseudoCount(article.id, 0, CARD_TINTS.length - 1);
  const cardTint = CARD_TINTS[tintIndex];

  const initialLikes = pseudoCount(article.id + '_like', 4, 68);
  const initialRestacks = pseudoCount(article.id + '_re', 1, 19);
  const initialComments = pseudoCount(article.id + '_com', 1, 14);

  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(initialLikes);
  const [isRestacked, setIsRestacked] = useState(false);
  const [restacksCount, setRestacksCount] = useState(initialRestacks);
  const [isCopied, setIsCopied] = useState(false);
  const [likePopping, setLikePopping] = useState(false);
  const [cardPressed, setCardPressed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticSelection();
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
    triggerHapticSelection();
    setIsRestacked((prev) => {
      const next = !prev;
      setRestacksCount((c) => (next ? c + 1 : c - 1));
      return next;
    });
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticSelection();
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

  // Compact Scanner View
  if (viewMode === 'compact') {
    return (
      <article
        onClick={() => onSelect(article)}
        className={`group cursor-pointer px-4 sm:px-5 py-3 border-b border-stone-200/60 dark:border-white/[0.08] hover:bg-stone-100/50 dark:hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-3 select-none ${
          article.isRead ? 'opacity-70' : ''
        }`}
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <SourceAvatar name={article.feedTitle} url={article.feedUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 mb-0.5">
              <span className="font-semibold text-stone-700 dark:text-stone-300 truncate max-w-[140px]">
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
            onClick={(e) => {
              triggerHapticSelection();
              onToggleBookmark(article.id, e);
            }}
            aria-label={article.isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
            className={`p-1.5 rounded-xl liquid-glass-squircle transition-colors ${
              article.isBookmarked
                ? 'text-[#FF6719]'
                : 'text-stone-500 dark:text-stone-300 hover:text-white'
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${article.isBookmarked ? 'fill-current' : ''}`} />
          </button>
        </div>
      </article>
    );
  }

  const hasCover = Boolean(article.imageUrl && !imageFailed);

  return (
    <article
      onClick={() => onSelect(article)}
      onPointerDown={() => setCardPressed(true)}
      onPointerUp={() => setCardPressed(false)}
      onPointerCancel={() => setCardPressed(false)}
      className={`article-card group cursor-pointer px-4 sm:px-5 pt-4 pb-3.5 border-b border-stone-200/70 dark:border-white/[0.08] select-none ${
        article.isRead ? 'feed-row-read opacity-85' : ''
      }`}
      style={{
        transform: cardPressed ? 'scale(0.985) translateZ(0)' : 'scale(1) translateZ(0)',
        transition: cardPressed
          ? 'transform 90ms cubic-bezier(0.4,0,1,1)'
          : 'transform 380ms cubic-bezier(0.175,0.885,0.32,1.275)',
      }}
    >
      {/* 1. Publisher Header Row (Matches reference photo: Avatar + Name + Relative Time + Right Ribbon) */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <SourceAvatar name={article.feedTitle} url={article.feedUrl} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-sans font-bold text-[15px] text-stone-900 dark:text-white truncate max-w-[200px]">
                {article.feedTitle}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-stone-500 dark:text-stone-400">
              <span>{formatRelativeTime(article.timestamp)}</span>
              <span>·</span>
              <span className="text-[#FF6719] font-medium">{readTime}m read</span>
            </div>
          </div>
        </div>

        {/* Right: Unread status / Read toggle */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!article.isRead ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-500 dark:text-stone-300">
              <span className="w-2.5 h-3 bg-[#FF6719] rounded-[2px] inline-block" />
            </span>
          ) : (
            <button
              onClick={(e) => onToggleRead(article.id, e)}
              title="Mark as unread"
              className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Lead Note / Teaser Sentence above the rounded feature card */}
      {article.summary && (
        <p className="font-sans text-[15px] leading-[1.42] text-stone-800 dark:text-stone-100 line-clamp-2 mb-3">
          {article.summary}
        </p>
      )}

      {/* 3. Embedded Rounded Feature Card with Atmospheric Gradient & Liquid Glass Bookmark Squircle */}
      <div
        className="relative w-full rounded-[22px] overflow-hidden border border-black/[0.08] dark:border-white/[0.10] shadow-md mb-3"
        style={{
          background: cardTint.solid,
        }}
      >
        {hasCover && (
          <div className="relative w-full h-52 sm:h-60 overflow-hidden">
            <img
              src={article.imageUrl}
              alt={article.title}
              referrerPolicy="no-referrer"
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              onError={() => setImageFailed(true)}
            />
            {/* Smooth atmospheric blend from photo into card body */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: cardTint.overlay }}
            />
          </div>
        )}

        {/* Feature Card Content Body */}
        <div className={`relative px-4 pb-4 ${hasCover ? '-mt-16 pt-4' : 'pt-4'}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <SourceAvatar name={article.feedTitle} url={article.feedUrl} size="sm" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/75 truncate">
              {article.feedTitle}
            </span>
          </div>

          <h2
            className="font-sans text-[19px] sm:text-[21px] font-bold leading-[1.26] text-white mb-1.5 pr-12"
            style={{ textWrap: 'balance' }}
          >
            {article.title}
          </h2>

          {article.summary && (
            <p className="font-sans text-[13.5px] leading-[1.4] text-white/75 line-clamp-2 pr-14">
              {article.summary}
            </p>
          )}

          {/* Bottom-Right Frosted Liquid Glass Bookmark Squircle (matches reference photo) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerHapticSelection();
              onToggleBookmark(article.id, e);
            }}
            aria-label={article.isBookmarked ? 'Remove from Saved' : 'Save story'}
            title={article.isBookmarked ? 'Saved to Bookmarks' : 'Save to Bookmarks'}
            className={`liquid-glass-squircle absolute bottom-3.5 right-3.5 w-10 h-10 rounded-[13px] flex items-center justify-center transition-transform active:scale-90 ${
              article.isBookmarked ? 'text-[#FF6719]' : 'text-white/90 hover:text-white'
            }`}
          >
            <Bookmark
              className={`w-4 h-4 ${article.isBookmarked ? 'fill-[#FF6719] text-[#FF6719]' : 'stroke-[2]'}`}
            />
          </button>
        </div>
      </div>

      {/* 4. Minimal Social Action Row below Card (Heart, Comment, Restack, Share) */}
      <div
        className="flex items-center gap-7 text-xs text-stone-500 dark:text-stone-400 pt-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleLike}
          aria-label="Like story"
          className={`flex items-center gap-1.5 py-1 rounded-lg transition-all ${
            isLiked
              ? 'text-[#FF4B4B] font-semibold'
              : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
          }`}
        >
          <Heart
            className={`w-[18px] h-[18px] transition-transform active:scale-125 duration-150 ${
              isLiked ? 'fill-[#FF4B4B] text-[#FF4B4B]' : 'stroke-[1.75]'
            } ${likePopping ? 'like-pop' : ''}`}
          />
          <span className="text-[13px]">{likesCount}</span>
        </button>

        <button
          onClick={() => onSelect(article)}
          aria-label="Read story"
          className="flex items-center gap-1.5 py-1 rounded-lg text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
        >
          <MessageSquare className="w-[18px] h-[18px] stroke-[1.75]" />
          <span className="text-[13px]">{initialComments}</span>
        </button>

        <button
          onClick={handleRestack}
          aria-label="Restack story"
          className={`flex items-center gap-1.5 py-1 rounded-lg transition-all ${
            isRestacked
              ? 'text-emerald-500 font-semibold'
              : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
          }`}
        >
          <Repeat2
            className={`w-[18px] h-[18px] transition-transform active:rotate-180 duration-200 ${
              isRestacked ? 'text-emerald-500 stroke-[2.2]' : 'stroke-[1.75]'
            }`}
          />
        </button>

        <button
          onClick={handleShare}
          aria-label="Share story link"
          title="Share story"
          className="flex items-center gap-1.5 py-1 rounded-lg text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors relative"
        >
          <Share2 className="w-[18px] h-[18px] stroke-[1.75]" />
          {isCopied && (
            <span className="absolute -top-7 left-0 px-2 py-0.5 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 rounded-md text-[10px] font-medium shadow-md whitespace-nowrap animate-in fade-in duration-100">
              Copied!
            </span>
          )}
        </button>
      </div>
    </article>
  );
};
