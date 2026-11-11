import React, { useState, useMemo } from 'react';
import { X, Plus, Trash2, Download, Upload, Check, FolderInput } from 'lucide-react';
import type { Feed, Tag } from '../types';
import { SourceAvatar } from './SourceAvatar';
import { triggerHapticSelection, triggerHapticComplete } from '../utils/haptics';

interface FeedManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  feeds: Feed[];
  tags: Tag[];
  folders?: string[];
  onCreateFolder?: (folderName: string) => void;
  onMoveFeedToFolder?: (feedId: string, folderName: string) => void;
  onAddFeed: (feed: Omit<Feed, 'id'>) => void;
  onDeleteFeed: (feedId: string) => void;
  onImportOPML: (xmlText: string) => void;
  onExportOPML: () => void;
}

const CURATED_NEWSPAPER_PRESETS = [
  {
    title: 'The Daily Star',
    url: 'https://www.thedailystar.net/rss.xml',
    siteUrl: 'https://www.thedailystar.net',
    category: 'Bangladesh',
    description: 'Leading English-language daily newspaper in Bangladesh.',
    tags: ['tag_bd', 'tag_investigative'],
  },
  {
    title: 'Prothom Alo (English)',
    url: 'https://en.prothomalo.com',
    siteUrl: 'https://en.prothomalo.com',
    category: 'Bangladesh',
    description: 'National news, politics, economy, and views from Prothom Alo.',
    tags: ['tag_bd', 'tag_world'],
  },
  {
    title: 'প্রথম আলো (Prothom Alo Bangla)',
    url: 'https://www.prothomalo.com',
    siteUrl: 'https://www.prothomalo.com',
    category: 'Bangladesh (বাংলা)',
    description: 'বাংলাদেশের শীর্ষস্থানীয় বাংলা দৈনিক পত্রিকা।',
    tags: ['tag_bd'],
  },
  {
    title: 'bdnews24.com',
    url: 'https://bdnews24.com',
    siteUrl: 'https://bdnews24.com',
    category: 'Bangladesh',
    description: 'Loads headlines & full stories directly from bdnews24.com.',
    tags: ['tag_bd', 'tag_breaking'],
  },
  {
    title: 'The Financial Express (BD)',
    url: 'https://thefinancialexpress.com.bd',
    siteUrl: 'https://thefinancialexpress.com.bd',
    category: 'Bangladesh Finance',
    description: 'Financial, trade, and market news from Dhaka.',
    tags: ['tag_bd', 'tag_markets'],
  },
  {
    title: 'The Business Standard (TBS)',
    url: 'https://www.tbsnews.net',
    siteUrl: 'https://www.tbsnews.net',
    category: 'Bangladesh Finance',
    description: 'Business, economy, and policy coverage in Bangladesh.',
    tags: ['tag_bd', 'tag_markets'],
  },
  {
    title: 'Dhaka Tribune',
    url: 'https://www.dhakatribune.com',
    siteUrl: 'https://www.dhakatribune.com',
    category: 'Bangladesh',
    description: 'National politics, foreign affairs, and Dhaka dispatches.',
    tags: ['tag_bd', 'tag_opinion'],
  },
  {
    title: 'New Age Bangladesh',
    url: 'https://www.newagebd.net',
    siteUrl: 'https://www.newagebd.net',
    category: 'Bangladesh',
    description: 'Outspoken English daily newspaper published from Dhaka.',
    tags: ['tag_bd', 'tag_opinion'],
  },
  {
    title: 'যুগান্তর (Daily Jugantor)',
    url: 'https://www.jugantor.com',
    siteUrl: 'https://www.jugantor.com',
    category: 'Bangladesh (বাংলা)',
    description: 'জনপ্রিয় বাংলা দৈনিক সংবাদপত্র।',
    tags: ['tag_bd'],
  },
];

export const FeedManagerModal: React.FC<FeedManagerModalProps> = ({
  isOpen,
  onClose,
  feeds,
  folders = [],
  onMoveFeedToFolder,
  onAddFeed,
  onDeleteFeed,
  onImportOPML,
  onExportOPML,
}) => {
  const [activeTab, setActiveTab] = useState<'my_feeds' | 'add_custom' | 'discover'>('my_feeds');
  const [customTitle, setCustomTitle] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [addedPresetUrls, setAddedPresetUrls] = useState<string[]>([]);

  const availableFolders = useMemo(() => {
    const set = new Set<string>();
    for (const f of folders) {
      if (f.trim()) set.add(f.trim());
    }
    for (const feed of feeds) {
      if (feed.category?.trim()) set.add(feed.category.trim());
    }
    return Array.from(set);
  }, [folders, feeds]);

  if (!isOpen) return null;

  // Add source without forcing any categorization or folder
  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;

    const formattedUrl = customUrl.trim().startsWith('http')
      ? customUrl.trim()
      : `https://${customUrl.trim()}`;

    let cleanTitle = customTitle.trim();
    if (!cleanTitle) {
      try {
        const u = new URL(formattedUrl);
        cleanTitle = u.hostname.replace(/^www\./, '');
      } catch {
        cleanTitle = 'Newspaper Feed';
      }
    }

    triggerHapticComplete();
    onAddFeed({
      title: cleanTitle,
      url: formattedUrl,
      siteUrl: formattedUrl,
      category: '',
      defaultTags: [],
      unreadCount: 0,
    });

    setCustomTitle('');
    setCustomUrl('');
    onClose();
  };

  const handleAddPreset = (preset: (typeof CURATED_NEWSPAPER_PRESETS)[0]) => {
    triggerHapticComplete();
    onAddFeed({
      title: preset.title,
      url: preset.url,
      siteUrl: preset.siteUrl,
      description: preset.description,
      category: '',
      defaultTags: [],
      unreadCount: 0,
    });
    setAddedPresetUrls((prev) => [...prev, preset.url]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        onImportOPML(content);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-md liquid-glass rounded-3xl p-5 shadow-2xl border border-white/40 dark:border-white/[0.08] text-stone-900 dark:text-stone-100 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-stone-200 dark:border-stone-800 mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-serif font-semibold text-base">Newspaper & Blog Sources</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close feed manager modal"
            className="p-1 rounded-full text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-xl mb-3 text-xs font-medium">
          <button
            onClick={() => setActiveTab('my_feeds')}
            className={`py-1.5 rounded-lg transition-all ${
              activeTab === 'my_feeds'
                ? 'bg-white dark:bg-stone-700 shadow-xs text-stone-900 dark:text-white font-semibold'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
            }`}
          >
            Sources ({feeds.length})
          </button>
          <button
            onClick={() => setActiveTab('discover')}
            className={`py-1.5 rounded-lg transition-all ${
              activeTab === 'discover'
                ? 'bg-white dark:bg-stone-700 shadow-xs text-stone-900 dark:text-white font-semibold'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
            }`}
          >
            BD Portals
          </button>
          <button
            onClick={() => setActiveTab('add_custom')}
            className={`py-1.5 rounded-lg transition-all ${
              activeTab === 'add_custom'
                ? 'bg-white dark:bg-stone-700 shadow-xs text-stone-900 dark:text-white font-semibold'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
            }`}
          >
            + Add URL
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto pr-1 no-scrollbar space-y-3">
          {/* TAB 1: Subscribed Feeds + Folder Move Option */}
          {activeTab === 'my_feeds' && (
            <div className="space-y-2">
              {feeds.map((feed) => (
                <div
                  key={feed.id}
                  className="flex items-start justify-between p-3 rounded-2xl liquid-glass border border-white/40 dark:border-white/[0.08] shadow-2xs gap-2.5"
                >
                  <SourceAvatar name={feed.title} url={feed.url} size="sm" />
                  <div className="flex-1 min-w-0 pr-2">
                    <span className="font-serif font-semibold text-sm text-stone-900 dark:text-stone-100 block truncate">
                      {feed.title}
                    </span>
                    <span className="text-xs text-stone-500 dark:text-stone-400 block truncate">
                      {feed.url}
                    </span>

                    {/* Move between folders */}
                    {onMoveFeedToFolder && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <FolderInput className="w-3 h-3 text-[#FF6719] shrink-0" />
                        <select
                          aria-label={`Folder for ${feed.title}`}
                          value={feed.category?.trim() || ''}
                          onChange={(e) => {
                            triggerHapticSelection();
                            onMoveFeedToFolder(feed.id, e.target.value);
                          }}
                          className="text-[11px] bg-stone-100 dark:bg-stone-800/90 border border-stone-200 dark:border-white/10 rounded-lg px-2 py-0.5 text-stone-700 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                        >
                          <option value="">No Folder</option>
                          {availableFolders.map((folder) => (
                            <option key={folder} value={folder}>
                              {folder}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => onDeleteFeed(feed.id)}
                    aria-label={`Unsubscribe from ${feed.title}`}
                    className="p-1.5 text-stone-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    title="Remove Source"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {feeds.length === 0 && (
                <div className="py-8 text-center text-xs text-stone-500">
                  No sources subscribed. Add one using BD Portals or + Add URL.
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Discover Curated Bangladeshi Portals */}
          {activeTab === 'discover' && (
            <div className="space-y-2.5">
              <span className="text-xs text-stone-500 block mb-1">
                Bangladeshi newspapers & portals:
              </span>
              {CURATED_NEWSPAPER_PRESETS.map((preset) => {
                const isAlreadyAdded =
                  feeds.some((f) => f.url === preset.url || f.siteUrl === preset.siteUrl) ||
                  addedPresetUrls.includes(preset.url);

                return (
                  <div
                    key={preset.url}
                    className="p-3 rounded-2xl border border-stone-200/80 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/40 flex items-center justify-between"
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-serif font-semibold text-xs text-stone-900 dark:text-stone-100">
                          {preset.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 line-clamp-1">
                        {preset.description}
                      </p>
                    </div>

                    <button
                      onClick={() => handleAddPreset(preset)}
                      disabled={isAlreadyAdded}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors shrink-0 flex items-center gap-1 ${
                        isAlreadyAdded
                          ? 'bg-stone-200 dark:bg-stone-700 text-stone-500 cursor-default'
                          : 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90'
                      }`}
                    >
                      {isAlreadyAdded ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Added</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: Add Any Website URL or RSS URL (No forced categorization) */}
          {activeTab === 'add_custom' && (
            <form onSubmit={handleAddCustom} className="space-y-3 pt-1">
              <div className="p-2.5 rounded-xl bg-stone-100/80 dark:bg-white/[0.04] border border-stone-200/60 dark:border-white/10 text-[11px] text-stone-600 dark:text-stone-300 leading-relaxed">
                Enter any newspaper or blog URL. The app will automatically try RSS feed combinations (<code>/feed</code>, <code>/rss</code>, <code>/rss.xml</code>, <code>/atom.xml</code>, etc.) and if no RSS feed is found, the website URL itself will be added.
              </div>

              <div>
                <label className="text-[11px] font-medium text-stone-500 block mb-1">
                  Website URL or RSS URL *
                </label>
                <input
                  type="text"
                  required
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://economist.com or https://bdnews24.com"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-stone-500 block mb-1">
                  Source Name (Optional)
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g. The Economist / সমকাল"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                />
              </div>

              <button
                type="submit"
                disabled={!customUrl.trim()}
                className="w-full py-2.5 mt-2 bg-[#FF6719] hover:bg-[#e8560b] text-white rounded-xl text-xs font-semibold disabled:opacity-40 transition-colors shadow-xs"
              >
                Add Source
              </button>
            </form>
          )}
        </div>

        {/* Footer: OPML Export / Import for full portability */}
        <div className="pt-3 mt-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between text-xs text-stone-500">
          <label className="flex items-center gap-1.5 hover:text-stone-800 dark:hover:text-stone-200 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Import OPML</span>
            <input
              type="file"
              accept=".opml,.xml"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>

          <button
            onClick={onExportOPML}
            className="flex items-center gap-1.5 hover:text-stone-800 dark:hover:text-stone-200"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export OPML</span>
          </button>
        </div>
      </div>
    </div>
  );
};
