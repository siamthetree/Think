import React, { useState, useRef } from 'react';
import {
  Plus,
  Trash2,
  AlertCircle,
  Globe,
  ExternalLink,
  Search,
  ChevronRight,
  ChevronDown,
  Upload,
  Download,
  RefreshCw,
  FolderPlus,
  Sparkles,
  Check,
  ShieldCheck,
  Edit3,
  X,
} from 'lucide-react';
import type { FeedSource } from '../types';
import { PRESET_FEEDS } from '../constants';
import { getFaviconUrl } from '../utils/feedParser';
import { exportToOpml, parseOpml } from '../utils/opml';
import { SourceAvatar } from './SourceAvatar';
import { getSourceHealthBadge } from '../utils/feedIntelligence';

interface SourcesSectionProps {
  sources: FeedSource[];
  activeSourceId: string | null;
  onSelectSource: (id: string | null) => void;
  onAddSource: (url: string) => Promise<void>;
  onAddPreset: (preset: Omit<FeedSource, 'id'>) => Promise<void>;
  onRemoveSource: (id: string) => void;
  onUpdateSourceCategory: (id: string, category: string) => void;
  onEditSource?: (
    id: string,
    updates: { title: string; url: string; category?: string }
  ) => Promise<void>;
  onImportSources: (newSources: Omit<FeedSource, 'id'>[]) => Promise<void>;
  onResetDefaultSources?: () => Promise<void>;
  isAdding: boolean;
  error: string | null;
  onRefreshAll?: () => void;
  isRefreshing?: boolean;
}

export const SourcesSection: React.FC<SourcesSectionProps> = ({
  sources,
  activeSourceId,
  onSelectSource,
  onAddSource,
  onAddPreset,
  onRemoveSource,
  onUpdateSourceCategory,
  onEditSource,
  onImportSources,
  onResetDefaultSources,
  isAdding,
  error,
  onRefreshAll,
  isRefreshing,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [discoverCategory, setDiscoverCategory] = useState<string>('All');
  const [discoverLang, setDiscoverLang] = useState<'all' | 'bn' | 'en'>('all');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catInput, setCatInput] = useState('');
  const [editingSource, setEditingSource] = useState<FeedSource | null>(null);
  const [editTitleInput, setEditTitleInput] = useState('');
  const [editUrlInput, setEditUrlInput] = useState('');
  const [editCategoryInput, setEditCategoryInput] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [opmlMessage, setOpmlMessage] = useState<string | null>(null);
  const [isAddingPack, setIsAddingPack] = useState<string | null>(null);
  const [isResettingDefaults, setIsResettingDefaults] = useState(false);
  const [confirmDeleteSource, setConfirmDeleteSource] = useState<FeedSource | null>(null);
  const [confirmResetModal, setConfirmResetModal] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [showAllSubscribed, setShowAllSubscribed] = useState(false);
  const [showAllDirectory, setShowAllDirectory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleGroupCollapse = (groupName: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || isAdding) return;
    try {
      await onAddSource(urlInput.trim());
      setUrlInput('');
    } catch {
      // handled in parent
    }
  };

  const isSourceAdded = (url: string) => {
    const clean = url.replace(/\/$/, '').toLowerCase();
    return sources.some((s) => s.url.replace(/\/$/, '').toLowerCase() === clean);
  };

  const handleExportOpml = () => {
    const xml = exportToOpml(sources);
    const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chinta-subscriptions-${new Date().toISOString().slice(0, 10)}.opml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setOpmlMessage(`Exported ${sources.length} feeds to OPML`);
    setTimeout(() => setOpmlMessage(null), 3500);
  };

  const handleImportOpmlFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseOpml(text);
      if (parsed.length === 0) {
        setOpmlMessage('No valid RSS feeds found in that OPML file.');
      } else {
        await onImportSources(parsed);
        setOpmlMessage(`Imported ${parsed.length} feed(s) from OPML`);
      }
    } catch {
      setOpmlMessage('Failed to parse OPML file.');
    }
    e.target.value = '';
    setTimeout(() => setOpmlMessage(null), 4000);
  };

  const handleAddStarterPack = async (
    packId: string,
    filterFn: (preset: Omit<FeedSource, 'id'>) => boolean
  ) => {
    setIsAddingPack(packId);
    try {
      const matching = PRESET_FEEDS.filter(filterFn).filter((p) => !isSourceAdded(p.url));
      if (matching.length > 0) {
        await onImportSources(matching);
        setOpmlMessage(`Added ${matching.length} sources from starter pack!`);
      } else {
        setOpmlMessage('All sources in this pack are already subscribed.');
      }
    } finally {
      setIsAddingPack(null);
      setTimeout(() => setOpmlMessage(null), 3500);
    }
  };

  const openEditSourceModal = (source: FeedSource) => {
    setEditingSource(source);
    setEditTitleInput(source.title);
    setEditUrlInput(source.url);
    setEditCategoryInput(source.category || 'General');
    setEditError(null);
  };

  const handleSaveSourceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSource || !onEditSource) return;
    const trimmedUrl = editUrlInput.trim();
    if (!trimmedUrl) {
      setEditError('Feed or website URL cannot be empty.');
      return;
    }
    setIsSavingEdit(true);
    setEditError(null);
    try {
      await onEditSource(editingSource.id, {
        title: editTitleInput.trim() || editingSource.title,
        url: trimmedUrl,
        category: editCategoryInput.trim() || 'General',
      });
      setEditingSource(null);
      setOpmlMessage(`Updated "${editTitleInput.trim() || editingSource.title}"`);
      setTimeout(() => setOpmlMessage(null), 3500);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not update source.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Discover categories
  const allDiscoverCategories = [
    'All',
    ...Array.from(new Set(PRESET_FEEDS.map((p) => p.category || 'General'))),
  ];

  const filteredPresets = PRESET_FEEDS.filter((p) => {
    const matchesSearch =
      !searchQuery.trim() ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.category || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.url.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = discoverCategory === 'All' || p.category === discoverCategory;

    const isBangla =
      (p.category || '').toLowerCase().includes('bangla') ||
      (p.category || '').toLowerCase().includes('bd') ||
      /[\u0980-\u09FF]/.test(p.title);

    const matchesLang =
      discoverLang === 'all' ||
      (discoverLang === 'bn' && isBangla) ||
      (discoverLang === 'en' && !isBangla);

    return matchesSearch && matchesCategory && matchesLang;
  });

  // Group user's active sources by folder/category
  const groupedSources = sources.reduce<Record<string, FeedSource[]>>((acc, s) => {
    const cat = s.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  // Keep Subscriptions compact on initial open unless user searches or expands
  const INITIAL_VISIBLE_SUBSCRIPTIONS = 6;
  const shouldCompactSubscriptions =
    !showAllSubscribed && !searchQuery.trim() && sources.length > INITIAL_VISIBLE_SUBSCRIPTIONS;

  const displayedSubscriptions = shouldCompactSubscriptions
    ? sources.slice(0, INITIAL_VISIBLE_SUBSCRIPTIONS)
    : sources;

  const displayedGroupedSources = displayedSubscriptions.reduce<Record<string, FeedSource[]>>(
    (acc, s) => {
      const cat = s.category || 'General';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(s);
      return acc;
    },
    {}
  );

  // Keep Curated Directory compact unless user searches, filters, or taps "Show All"
  const INITIAL_VISIBLE_PRESETS = 6;
  const isDirectoryFiltered =
    Boolean(searchQuery.trim()) || discoverCategory !== 'All' || discoverLang !== 'all';
  const shouldCompactDirectory =
    !showAllDirectory && !isDirectoryFiltered && filteredPresets.length > INITIAL_VISIBLE_PRESETS;
  const displayedPresets = shouldCompactDirectory
    ? filteredPresets.slice(0, INITIAL_VISIBLE_PRESETS)
    : filteredPresets;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-28 space-y-7">
      {/* Header + OPML Actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            Sources & Discovery
          </h1>
          <p className="text-sm text-stone-600 dark:text-stone-400 mt-1">
            Subscribe to any RSS feed, Atom XML, or newspaper portal. 100% tracker-free & IP-shielded.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {onRefreshAll && (
            <button
              type="button"
              onClick={onRefreshAll}
              disabled={isRefreshing}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-stone-200/70 dark:bg-stone-800/80 text-stone-700 dark:text-stone-300 hover:bg-stone-300/70 dark:hover:bg-stone-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh All</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2 rounded-xl text-xs font-medium bg-stone-200/70 dark:bg-stone-800/80 text-stone-700 dark:text-stone-300 hover:bg-stone-300/70 dark:hover:bg-stone-700 flex items-center gap-1.5 transition-colors"
            title="Import subscriptions from an OPML file"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import OPML</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            onChange={handleImportOpmlFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleExportOpml}
            disabled={sources.length === 0}
            className="px-3 py-2 rounded-xl text-xs font-medium bg-stone-200/70 dark:bg-stone-800/80 text-stone-700 dark:text-stone-300 hover:bg-stone-300/70 dark:hover:bg-stone-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Export your feeds to a portable OPML file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export OPML</span>
          </button>
          {onResetDefaultSources && (
            <button
              type="button"
              disabled={isResettingDefaults || isAdding}
              onClick={() => setConfirmResetModal(true)}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-stone-200/70 dark:bg-stone-800/80 text-stone-700 dark:text-stone-300 hover:bg-stone-300/70 dark:hover:bg-stone-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Restore default Bangla & International starter sources"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#FF6719]" />
              <span>{isResettingDefaults ? 'Restoring...' : 'Restore Defaults'}</span>
            </button>
          )}
        </div>
      </div>

      {opmlMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{opmlMessage}</span>
        </div>
      )}

      {/* Custom URL Form */}
      <div className="p-4 sm:p-5 rounded-2xl liquid-glass">
        <label
          htmlFor="feed-url-input"
          className="block text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2.5"
        >
          Add Any Website or RSS Feed URL
        </label>
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Globe className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="feed-url-input"
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="e.g. prothomalo.com, thedailystar.net, or any RSS link..."
              className="w-full pl-10 pr-4 py-2.5 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-xl text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-600/30 focus:border-amber-600 transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={isAdding || !urlInput.trim()}
            className="px-5 py-2.5 bg-[#FF6719] hover:bg-[#e55b15] text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all cursor-pointer shrink-0 shadow-xs"
          >
            {isAdding ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            <span>Add Source</span>
          </button>
        </form>

        {error && (
          <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Starter Packs (One-Click Bundles) */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 px-1 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#FF6719]" />
          <span>1-Click Starter Packs</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            disabled={isAddingPack !== null}
            onClick={() =>
              handleAddStarterPack('bd-pack', (p) =>
                (p.category || '').toLowerCase().includes('bangla') ||
                (p.category || '').toLowerCase().includes('bd')
              )
            }
            className="p-3.5 rounded-2xl liquid-glass text-left hover:border-[#FF6719]/50 transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#FF6719]">
                Bangladesh Pack
              </span>
              <Plus className="w-4 h-4 text-stone-400 group-hover:text-[#FF6719] transition-colors" />
            </div>
            <p className="font-serif font-semibold text-sm text-stone-900 dark:text-stone-100 mt-1">
              Top Bangla & English BD Portals
            </p>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
              Prothom Alo, Daily Star, bdnews24, Ittefaq, Jugantor & more
            </p>
          </button>

          <button
            type="button"
            disabled={isAddingPack !== null}
            onClick={() =>
              handleAddStarterPack(
                'world-pack',
                (p) => (p.category || '').toLowerCase() === 'world'
              )
            }
            className="p-3.5 rounded-2xl liquid-glass text-left hover:border-[#FF6719]/50 transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                Global Wire
              </span>
              <Plus className="w-4 h-4 text-stone-400 group-hover:text-sky-500 transition-colors" />
            </div>
            <p className="font-serif font-semibold text-sm text-stone-900 dark:text-stone-100 mt-1">
              World & Geopolitics
            </p>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
              BBC World, Al Jazeera, The Guardian, NYT & DW News
            </p>
          </button>

          <button
            type="button"
            disabled={isAddingPack !== null}
            onClick={() =>
              handleAddStarterPack(
                'tech-pack',
                (p) =>
                  (p.category || '').toLowerCase() === 'tech' ||
                  (p.category || '').toLowerCase() === 'science'
              )
            }
            className="p-3.5 rounded-2xl liquid-glass text-left hover:border-[#FF6719]/50 transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Tech & Science
              </span>
              <Plus className="w-4 h-4 text-stone-400 group-hover:text-emerald-500 transition-colors" />
            </div>
            <p className="font-serif font-semibold text-sm text-stone-900 dark:text-stone-100 mt-1">
              Builders & Research
            </p>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
              Hacker News, Ars Technica, The Verge, TechCrunch & Nature
            </p>
          </button>
        </div>
      </div>

      {/* Subscribed Feeds Grouped by Folder/Category */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Your Subscriptions ({sources.length})
          </h2>
          {activeSourceId && (
            <button
              type="button"
              onClick={() => onSelectSource(null)}
              className="text-xs font-medium text-[#FF6719] hover:underline cursor-pointer"
            >
              Show All Feeds
            </button>
          )}
        </div>

        {sources.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-dashed border-stone-300 dark:border-stone-800 text-stone-500 text-sm">
            No feeds subscribed yet. Add a URL above or pick a Starter Pack.
          </div>
        ) : (
          <div className="space-y-4">
            {(Object.entries(displayedGroupedSources) as [string, FeedSource[]][]).map(
              ([categoryName, groupItems]) => {
                const isCollapsed = Boolean(collapsedGroups[categoryName]);
                const totalInGroup = groupedSources[categoryName]?.length || groupItems.length;
                return (
                  <div key={categoryName} className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapse(categoryName)}
                      className="w-full flex items-center justify-between px-2 py-1 rounded-lg hover:bg-stone-200/50 dark:hover:bg-white/[0.04] transition-colors text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        {isCollapsed ? (
                          <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                        )}
                        <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                          {categoryName}
                        </span>
                        <span className="text-[10px] font-mono text-stone-400 dark:text-stone-500">
                          ({totalInGroup})
                        </span>
                      </div>
                      <span className="text-[10px] text-stone-400 dark:text-stone-500">
                        {isCollapsed ? 'Expand' : 'Collapse'}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="divide-y divide-stone-200/60 dark:divide-white/[0.06] rounded-2xl liquid-glass overflow-hidden">
                        {groupItems.map((source) => {
                          const isSelected = activeSourceId === source.id;
                          const health = getSourceHealthBadge(source);
                          return (
                            <div
                              key={source.id}
                              className={`p-3.5 sm:px-4 flex items-center justify-between gap-3 transition-colors ${
                                isSelected
                                  ? 'bg-amber-500/5 dark:bg-amber-500/10'
                                  : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => onSelectSource(isSelected ? null : source.id)}
                                className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                              >
                                <SourceAvatar name={source.title} url={source.url} size="md" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-sm text-stone-900 dark:text-stone-100 truncate">
                                      {source.title}
                                    </p>
                                    <span
                                      title={health.label}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium shrink-0 ${
                                        health.tone === 'emerald'
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                          : health.tone === 'amber'
                                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                            : 'bg-stone-200/70 dark:bg-white/[0.06] text-stone-500 dark:text-stone-400'
                                      }`}
                                    >
                                      <span
                                        className={`w-1.5 h-1.5 rounded-full ${
                                          health.tone === 'emerald'
                                            ? 'bg-emerald-500'
                                            : health.tone === 'amber'
                                              ? 'bg-amber-500'
                                              : 'bg-stone-400'
                                        }`}
                                      />
                                      <span className="hidden sm:inline">{health.label}</span>
                                    </span>
                                  </div>
                                  <p className="text-xs text-stone-400 dark:text-stone-500 truncate">
                                    {source.url}
                                  </p>
                                </div>
                              </button>

                              <div className="flex items-center gap-1 shrink-0">
                                {editingCatId === source.id ? (
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      if (catInput.trim()) {
                                        onUpdateSourceCategory(source.id, catInput.trim());
                                      }
                                      setEditingCatId(null);
                                    }}
                                    className="flex items-center gap-1"
                                  >
                                    <input
                                      type="text"
                                      value={catInput}
                                      onChange={(e) => setCatInput(e.target.value)}
                                      placeholder="Folder..."
                                      autoFocus
                                      onBlur={() => setEditingCatId(null)}
                                      className="w-24 px-2 py-1 text-xs rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 focus:outline-none"
                                    />
                                  </form>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCatId(source.id);
                                      setCatInput(source.category || 'General');
                                    }}
                                    className="p-2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg transition-colors cursor-pointer"
                                    title="Move to folder / category"
                                  >
                                    <FolderPlus className="w-4 h-4" />
                                  </button>
                                )}

                                {onEditSource && (
                                  <button
                                    type="button"
                                    onClick={() => openEditSourceModal(source)}
                                    className="p-2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg transition-colors cursor-pointer"
                                    title={`Edit ${source.title}`}
                                    aria-label={`Edit ${source.title}`}
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                )}

                                <a
                                  href={source.siteUrl || source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  referrerPolicy="no-referrer"
                                  className="p-2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg transition-colors"
                                  title="Open site"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>

                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteSource(source)}
                                  className="p-2 text-stone-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg transition-colors cursor-pointer"
                                  title={`Remove ${source.title}`}
                                  aria-label={`Remove ${source.title}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
            )}

            {/* Show All / Compact Toggle for Subscriptions */}
            {sources.length > INITIAL_VISIBLE_SUBSCRIPTIONS && !searchQuery.trim() && (
              <button
                type="button"
                onClick={() => setShowAllSubscribed((prev) => !prev)}
                className="w-full py-2.5 px-4 rounded-2xl liquid-glass text-xs font-semibold text-stone-700 dark:text-stone-200 hover:border-[#FF6719]/50 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                {showAllSubscribed ? (
                  <>
                    <ChevronDown className="w-4 h-4 rotate-180 text-[#FF6719]" />
                    <span>Show Fewer Subscriptions</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4 text-[#FF6719]" />
                    <span>
                      Show All {sources.length} Subscriptions (
                      {sources.length - INITIAL_VISIBLE_SUBSCRIPTIONS} more)
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Curated Directory with Search + Category + Language Filter */}
      <div className="space-y-3.5 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Curated Directory ({filteredPresets.length})
          </h2>

          {/* Language Filter Segment */}
          <div className="flex items-center gap-1 bg-stone-200/70 dark:bg-stone-900 p-1 rounded-xl self-start">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'bn', label: 'বাংলা / BD' },
                { id: 'en', label: 'Global / EN' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDiscoverLang(tab.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  discoverLang === tab.id
                    ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-2xs'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search Input inside Directory */}
        <div className="relative">
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search directory (e.g. Prothom Alo, BBC, Science, Bangla)..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800/80 rounded-xl text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-600/30"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {allDiscoverCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setDiscoverCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                discoverCategory === cat
                  ? 'bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900'
                  : 'bg-stone-200/60 dark:bg-stone-900 text-stone-600 dark:text-stone-400 hover:bg-stone-300/60 dark:hover:bg-stone-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {displayedPresets.map((preset) => {
            const added = isSourceAdded(preset.url);
            const favicon = getFaviconUrl(preset.url);
            return (
              <div
                key={preset.url}
                className="p-3.5 rounded-2xl liquid-glass flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {favicon ? (
                    <img
                      src={favicon}
                      alt=""
                      className="w-7 h-7 rounded-md bg-stone-100 dark:bg-stone-800 p-0.5 shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <Globe className="w-7 h-7 text-stone-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-stone-900 dark:text-stone-100 truncate">
                      {preset.title}
                    </p>
                    <span className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
                      {preset.category}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={added || isAdding}
                  onClick={() => onAddPreset(preset)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                    added
                      ? 'bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500 cursor-default'
                      : 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90'
                  }`}
                >
                  {added ? 'Added' : '+ Subscribe'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Show All / Compact Toggle for Curated Directory */}
        {filteredPresets.length > INITIAL_VISIBLE_PRESETS && !isDirectoryFiltered && (
          <button
            type="button"
            onClick={() => setShowAllDirectory((prev) => !prev)}
            className="w-full py-2.5 px-4 rounded-2xl liquid-glass text-xs font-semibold text-stone-700 dark:text-stone-200 hover:border-[#FF6719]/50 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            {showAllDirectory ? (
              <>
                <ChevronDown className="w-4 h-4 rotate-180 text-[#FF6719]" />
                <span>Show Fewer Directory Sources</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4 text-[#FF6719]" />
                <span>
                  Browse All {filteredPresets.length} Curated Sources (
                  {filteredPresets.length - INITIAL_VISIBLE_PRESETS} more)
                </span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Edit Source Modal */}
      {editingSource && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit Source"
          onClick={() => !isSavingEdit && setEditingSource(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl liquid-glass bg-white/95 dark:bg-stone-900/95 border border-stone-200/80 dark:border-white/15 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#FF6719]" />
                <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
                  Edit Source
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingSource(null)}
                disabled={isSavingEdit}
                className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-white hover:bg-stone-200/50 dark:hover:bg-white/10 transition-colors"
                aria-label="Close edit source modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSourceEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={editTitleInput}
                  onChange={(e) => setEditTitleInput(e.target.value)}
                  placeholder="e.g. Prothom Alo"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-100 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-[#FF6719]/40"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1">
                  Feed or Website URL
                </label>
                <input
                  type="text"
                  value={editUrlInput}
                  onChange={(e) => setEditUrlInput(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-100 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-[#FF6719]/40 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1">
                  Category / Folder
                </label>
                <input
                  type="text"
                  value={editCategoryInput}
                  onChange={(e) => setEditCategoryInput(e.target.value)}
                  placeholder="e.g. Bangla, World, Tech..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-100 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-[#FF6719]/40"
                />
              </div>

              {editError && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={() => setEditingSource(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#FF6719] hover:bg-[#e55b15] text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {isSavingEdit ? (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>{isSavingEdit ? 'Verifying & Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Source Confirmation Modal */}
      {confirmDeleteSource && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Remove Source"
          onClick={() => setConfirmDeleteSource(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl liquid-glass bg-white/95 dark:bg-stone-900/95 border border-stone-200/80 dark:border-white/15 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
              <Trash2 className="w-5 h-5 shrink-0" />
              <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
                Remove Source?
              </h3>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">
              Are you sure you want to unsubscribe from{' '}
              <span className="font-semibold text-stone-900 dark:text-white">
                {confirmDeleteSource.title}
              </span>
              ? Its cached stories will be removed from your timeline (saved bookmarks are kept).
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteSource(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = confirmDeleteSource;
                  setConfirmDeleteSource(null);
                  onRemoveSource(target.id);
                  setOpmlMessage(`Removed "${target.title}"`);
                  setTimeout(() => setOpmlMessage(null), 3000);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Defaults Confirmation Modal */}
      {confirmResetModal && onResetDefaultSources && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Restore Default Sources"
          onClick={() => !isResettingDefaults && setConfirmResetModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl liquid-glass bg-white/95 dark:bg-stone-900/95 border border-stone-200/80 dark:border-white/15 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center gap-2.5 text-[#FF6719]">
              <Sparkles className="w-5 h-5 shrink-0" />
              <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
                Restore Default Sources?
              </h3>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">
              This will restore Chinta&apos;s starter Bangla &amp; Global news sources and refresh
              your timeline. Your saved bookmarks will remain untouched.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isResettingDefaults}
                onClick={() => setConfirmResetModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isResettingDefaults}
                onClick={async () => {
                  setIsResettingDefaults(true);
                  try {
                    await onResetDefaultSources();
                    setConfirmResetModal(false);
                    setOpmlMessage('Restored default starter sources!');
                  } finally {
                    setIsResettingDefaults(false);
                    setTimeout(() => setOpmlMessage(null), 3500);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF6719] hover:bg-[#e55b15] text-white transition-colors disabled:opacity-50"
              >
                {isResettingDefaults ? 'Restoring...' : 'Restore Defaults'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 100% On-Device & IP-Shielded Privacy Guarantee Card */}
      <div className="p-4 sm:p-5 rounded-2xl liquid-glass border border-stone-200/70 dark:border-white/10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                <span>100% Tracker-Free &amp; IP-Shielded</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  Local Only
                </span>
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Zero cloud servers, zero accounts, and zero third-party telemetry. Every feed,
                article, and image is fetched through the privacy relay so publishers never see your
                IP address. Use Export/Import OPML above for offline backups.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
