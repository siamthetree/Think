import React, { useState, useEffect } from 'react';
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
import { triggerHapticSelection } from '../utils/haptics';
import { isPlaceholderSummary } from '../utils/storage';
import { extractArticleWithFallback } from '../utils/apiClient';

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

  const initialCleanSummary =
    article.summary && !isPlaceholderSummary(article.summary) ? article.summary.trim() : '';
  const [extractedSummary, setExtractedSummary] = useState<string>(initialCleanSummary);
  const [extractedImage, setExtractedImage] = useState<string | undefined>(article.imageUrl);

  useEffect(() => {
    const clean =
      article.summary && !isPlaceholderSummary(article.summary) ? article.summary.trim() : '';
    setExtractedSummary(clean);
    setExtractedImage(article.imageUrl);

    if (!clean && article.link && article.link.startsWith('http')) {
      let cancelled = false;
      extractArticleWithFallback(article.link)
        .then((res) => {
          if (cancelled || !res.success) return;
          const firstParagraph = res.blocks?.find(
            (b) => b.type === 'p' && b.text && b.text.trim().length > 30 && b.text.trim() !== article.title
          )?.text;
          if (firstParagraph) {
            setExtractedSummary(firstParagraph.trim().slice(0, 260));
          }
          if (!article.imageUrl && res.leadImage) {
            setExtractedImage(res.leadImage);
          }
        })
        .catch(() => {
          // ignore
        });
      return () => {
        cancelled = true;
      };
    }
  }, [article.id, article.summary, article.link, article.imageUrl, article.title]);

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
            title={article.isBookmarked ? 'Saved' : 'Save'}
            className={`p-2 rounded-full transition-colors active:scale-90 ${
              article.isBookmarked
                ? 'text-[#FF6719]'
                : 'text-stone-400 hover:text-[#FF6719] dark:text-stone-500 dark:hover:text-stone-300'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${article.isBookmarked ? 'fill-current' : ''}`} />
          </button>
        </div>
      </article>
    );
  }

  const coverUrl = article.imageUrl || extractedImage;
  const hasCover = Boolean(coverUrl && !imageFailed);
  const displaySummary =
    article.summary && !isPlaceholderSummary(article.summary)
      ? article.summary
      : extractedSummary;

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
      {/* 1. Publisher Header Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <SourceAvatar name={article.feedTitle} url={article.feedUrl} size="sm" />
          <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 truncate">
            <span className="font-semibold text-stone-800 dark:text-stone-200 truncate max-w-[160px] sm:max-w-xs">
              {article.feedTitle}
            </span>
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
            <span className="whitespace-nowrap">{formatRelativeTime(article.timestamp)}</span>
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
            <span className="whitespace-nowrap flex items-center gap-1">
              <Clock className="w-3 h-3 text-stone-400" />
              {readTime}m read
            </span>
          </div>
        </div>

        {/* Right: Unread status or Read toggle */}
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
        className={`font-serif text-[19px] sm:text-[21px] font-bold leading-[1.3] text-stone-950 dark:text-stone-50 group-hover:text-[#FF6719] transition-colors mb-1.5 ${
          article.isRead ? 'text-stone-600 dark:text-stone-400 font-semibold' : ''
        }`}
        style={{ textWrap: 'balance' }}
      >
        {article.title}
      </h2>

      {/* 3. Subtitle / Excerpt: Clean Editorial Prose */}
      {displaySummary && (
        <p
          className={`font-sans text-[14px] leading-relaxed line-clamp-2 sm:line-clamp-3 mb-3 ${
            article.isRead
              ? 'text-stone-500 dark:text-stone-400'
              : 'text-stone-600 dark:text-stone-300'
          }`}
        >
          {displaySummary}
        </p>
      )}

      {/* 4. Large Featured Cover Image (16:9 Aspect Ratio) */}
      {hasCover && (
        <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden bg-stone-100 dark:bg-stone-900 border border-stone-200/60 dark:border-white/[0.08] mb-3 shadow-xs">
          <img
            src={coverUrl}
            alt={article.title}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.015] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            onError={() => setImageFailed(true)}
          />
        </div>
      )}

      {/* 5. Minimal Social Action Ribbon (Heart, Comment, Restack, Share & Bookmark) */}
      <div
        className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 pt-1 border-t border-stone-100 dark:border-white/[0.05]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Like, Comment, Restack */}
        <div className="flex items-center gap-5 sm:gap-6">
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

          <button
            onClick={() => onSelect(article)}
            aria-label="View story and comments"
            className="flex items-center gap-1.5 py-1 px-1 rounded-lg text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
          >
            <MessageSquare className="w-4 h-4 stroke-[1.75]" />
            <span className="text-[12px]">{initialComments}</span>
          </button>

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
        </div>

        {/* Right: Share & Bookmark */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleShare}
            aria-label="Share story link"
            title="Share story"
            className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-white/[0.06] transition-colors relative min-w-[32px] min-h-[32px] flex items-center justify-center active:scale-90"
          >
            <Share2 className="w-4 h-4 stroke-[1.75]" />
            {isCopied && (
              <span className="absolute -top-7 right-0 px-2 py-0.5 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 rounded-md text-[10px] font-medium shadow-md whitespace-nowrap animate-in fade-in duration-100">
                Copied!
              </span>
            )}
          </button>

          <button
            onClick={(e) => {
              triggerHapticSelection();
              onToggleBookmark(article.id, e);
            }}
            aria-label={article.isBookmarked ? 'Remove from Saved' : 'Save story'}
            title={article.isBookmarked ? 'Saved to Bookmarks' : 'Save to Bookmarks'}
            className={`p-1.5 rounded-full transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center active:scale-90 ${
              article.isBookmarked
                ? 'text-[#FF6719]'
                : 'text-stone-400 hover:text-[#FF6719] dark:text-stone-400 dark:hover:text-white'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${article.isBookmarked ? 'fill-current' : 'stroke-[1.75]'}`} />
          </button>
        </div>
      </div>
    </article>
  );
};
