import React, { useState } from 'react';
import { X, Plus, Trash2, Check, Tag as TagIcon } from 'lucide-react';
import type { Tag, FeedItem } from '../types';

interface TagManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  tags: Tag[];
  articles: FeedItem[];
  selectedArticle?: FeedItem | null;
  onSaveArticleTags?: (articleId: string, tagIds: string[]) => void;
  onCreateTag: (name: string, color: string) => void;
  onDeleteTag: (tagId: string) => void;
}

const PRESET_COLORS = [
  '#2563EB', // Blue
  '#7C3AED', // Violet
  '#0D9488', // Teal
  '#059669', // Emerald
  '#B45309', // Amber
  '#DC2626', // Red
  '#BE185D', // Rose
  '#4338CA', // Indigo
  '#475569', // Slate
];

export const TagManagerModal: React.FC<TagManagerModalProps> = ({
  isOpen,
  onClose,
  tags,
  articles,
  selectedArticle,
  onSaveArticleTags,
  onCreateTag,
  onDeleteTag,
}) => {
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0]);
  const [assignedTagIds, setAssignedTagIds] = useState<string[]>(
    selectedArticle ? [...selectedArticle.tags] : []
  );

  if (!isOpen) return null;

  // Toggle tag for the current article
  const toggleArticleTag = (tagId: string) => {
    if (!selectedArticle) return;
    const next = assignedTagIds.includes(tagId)
      ? assignedTagIds.filter((id) => id !== tagId)
      : [...assignedTagIds, tagId];

    setAssignedTagIds(next);
    if (onSaveArticleTags) {
      onSaveArticleTags(selectedArticle.id, next);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    onCreateTag(newTagName.trim(), newTagColor);
    setNewTagName('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-white dark:bg-stone-900 rounded-3xl p-5 shadow-2xl border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-stone-200 dark:border-stone-800 mb-4">
          <div className="flex items-center gap-2">
            <TagIcon className="w-4 h-4 text-stone-600 dark:text-stone-400" />
            <h3 className="font-serif font-semibold text-base">
              {selectedArticle ? 'Assign Story Tags' : 'Manage Custom Tags'}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close tag modal"
            className="p-1 rounded-full text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* If an article is selected, show article title snippet */}
        {selectedArticle && (
          <div className="mb-4 p-2.5 bg-stone-50 dark:bg-stone-800/60 rounded-xl text-xs text-stone-600 dark:text-stone-300">
            <span className="font-semibold block text-stone-900 dark:text-stone-100 truncate mb-0.5">
              {selectedArticle.title}
            </span>
            <span className="text-[11px] opacity-75">
              Tap tags below to add or remove categorization.
            </span>
          </div>
        )}

        {/* Existing Tags List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-4 no-scrollbar">
          {tags.map((tag) => {
            const count = articles.filter((a) => a.tags.includes(tag.id)).length;
            const isAssigned = assignedTagIds.includes(tag.id);

            return (
              <div
                key={tag.id}
                className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                  selectedArticle && isAssigned
                    ? 'border-blue-500/60 bg-blue-50/50 dark:bg-blue-950/20'
                    : 'border-stone-200/80 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectedArticle && toggleArticleTag(tag.id)}
                  className="flex items-center gap-2.5 flex-1 text-left"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-xs font-medium text-stone-800 dark:text-stone-200">
                    {tag.name}
                  </span>
                  <span className="text-[11px] text-stone-400 dark:text-stone-500">
                    ({count})
                  </span>
                </button>

                <div className="flex items-center gap-1.5">
                  {selectedArticle && (
                    <button
                      type="button"
                      onClick={() => toggleArticleTag(tag.id)}
                      aria-label={`Toggle tag ${tag.name}`}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
                        isAssigned
                          ? 'bg-blue-600 text-white'
                          : 'border border-stone-300 dark:border-stone-600 hover:border-blue-400'
                      }`}
                    >
                      {isAssigned && <Check className="w-3.5 h-3.5" />}
                    </button>
                  )}

                  {!selectedArticle && (
                    <button
                      type="button"
                      onClick={() => onDeleteTag(tag.id)}
                      aria-label={`Delete tag ${tag.name}`}
                      className="p-1.5 text-stone-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      title="Delete Tag"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Create New Custom Tag Form */}
        <form onSubmit={handleCreate} className="pt-3 border-t border-stone-200 dark:border-stone-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 block mb-2">
            Create Custom Tag
          </span>

          <div className="flex items-center gap-2 mb-2.5">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Tag name (e.g., Weekend Read)"
              className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!newTagName.trim()}
              aria-label="Add new tag"
              className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white text-white dark:text-stone-900 rounded-xl text-xs font-medium disabled:opacity-40 transition-colors flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          {/* Color palette selector */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-stone-400">Color:</span>
            <div className="flex items-center gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewTagColor(c)}
                  className={`w-4 h-4 rounded-full transition-transform ${
                    newTagColor === c ? 'scale-125 ring-2 ring-stone-400 ring-offset-1' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Select color ${c}`}
                />
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
