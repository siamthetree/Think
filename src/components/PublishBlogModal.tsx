import React, { useState } from 'react';
import { X, Send, Compass, User, Users, MapPin, Link as LinkIcon, Image, Sparkles } from 'lucide-react';
import type { TravelBlog } from '../types';

interface PublishBlogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPublish: (blogData: Omit<TravelBlog, 'id' | 'publishedAt' | 'timestamp' | 'readTimeMin' | 'likesCount'>) => Promise<void>;
  isSubmitting?: boolean;
}

const POPULAR_GROUPS = [
  'Travelers of Bangladesh (TOB)',
  'BD Travelers Club',
  'Chhayanaut Wanderers',
  'Bengal Trekkers',
  'Sajek Rovers Club',
  'Sylhet Trail Explorers',
  'Independent Backpackers BD',
];

const PHOTO_PRESETS = [
  { label: 'Bandarban Hills', url: 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=800&q=80' },
  { label: 'Tanguar Haor Waters', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80' },
  { label: 'Sreemangal Tea Trails', url: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=800&q=80' },
  { label: 'Mountain Ridge Camp', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=800&q=80' },
];

export const PublishBlogModal: React.FC<PublishBlogModalProps> = ({
  isOpen,
  onClose,
  onPublish,
  isSubmitting = false,
}) => {
  const [author, setAuthor] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupContact, setGroupContact] = useState('');
  const [location, setLocation] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!author.trim()) {
      setErrorMsg('Please enter your name as the writer.');
      return;
    }
    if (!title.trim()) {
      setErrorMsg('Please enter a title for your blog post.');
      return;
    }
    if (!content.trim() || content.trim().length < 40) {
      setErrorMsg('Please write at least a few sentences describing the experience or group.');
      return;
    }

    try {
      const summary = content.trim().replace(/\s+/g, ' ').slice(0, 190) + '...';
      await onPublish({
        author: author.trim(),
        groupName: groupName.trim() || 'Bangladeshi Travel Group',
        groupContact: groupContact.trim(),
        location: location.trim() || 'Bangladesh',
        title: title.trim(),
        summary,
        content: content.trim(),
        coverImage: coverImage.trim() || undefined,
      });

      // Reset form on success
      setAuthor('');
      setGroupName('');
      setGroupContact('');
      setLocation('');
      setTitle('');
      setContent('');
      setCoverImage('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to publish blog. Please try again.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-blog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg max-h-[92vh] bg-stone-900 border border-stone-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-stone-100 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-stone-800 flex items-center justify-between bg-stone-900/95">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-950/70 border border-emerald-800/80 flex items-center justify-center text-emerald-400">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <h2 id="publish-blog-title" className="font-serif font-bold text-base text-stone-100">
                Publish Travel Group Blog
              </h2>
              <p className="text-[11px] text-stone-400">
                Share your journey and introduce your travel group to all readers
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-full hover:bg-stone-800 text-stone-400 hover:text-stone-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Row 1: Writer Name & Travel Group */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-stone-300 mb-1">
                <User className="w-3.5 h-3.5 text-emerald-400" />
                <span>Your Name (Writer) *</span>
              </label>
              <input
                type="text"
                required
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g. Tamim Hasan"
                className="w-full px-3 py-2 bg-stone-800/80 rounded-xl text-xs text-stone-100 border border-stone-700/80 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-stone-300 mb-1">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span>Travel Group / Organization</span>
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Travelers of Bangladesh (TOB)"
                className="w-full px-3 py-2 bg-stone-800/80 rounded-xl text-xs text-stone-100 border border-stone-700/80 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Popular Group Quick Chips */}
          <div>
            <span className="text-[10px] text-stone-400 block mb-1">Quick Select Group:</span>
            <div className="flex flex-wrap gap-1.5">
              {POPULAR_GROUPS.map((grp) => (
                <button
                  type="button"
                  key={grp}
                  onClick={() => setGroupName(grp)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] transition-colors border ${
                    groupName === grp
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      : 'bg-stone-800/70 text-stone-400 hover:text-stone-200 border-stone-700/60'
                  }`}
                >
                  {grp}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: Blog Title */}
          <div>
            <label className="block text-xs font-medium text-stone-300 mb-1">
              Blog Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Amiakhum Expedition: Tips, Trail Cost & Our Group Journey"
              className="w-full px-3 py-2 bg-stone-800/80 rounded-xl text-xs text-stone-100 border border-stone-700/80 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Row 3: Destination & Group Contact Link */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-stone-300 mb-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                <span>Destination / Region</span>
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Bandarban, Sajek, Tanguar Haor"
                className="w-full px-3 py-2 bg-stone-800/80 rounded-xl text-xs text-stone-100 border border-stone-700/80 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-stone-300 mb-1">
                <LinkIcon className="w-3.5 h-3.5 text-emerald-400" />
                <span>Group Link or WhatsApp / FB Group</span>
              </label>
              <input
                type="text"
                value={groupContact}
                onChange={(e) => setGroupContact(e.target.value)}
                placeholder="e.g. facebook.com/groups/... or +880 17..."
                className="w-full px-3 py-2 bg-stone-800/80 rounded-xl text-xs text-stone-100 border border-stone-700/80 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Cover Photo URL + Quick Presets */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-stone-300 mb-1">
              <Image className="w-3.5 h-3.5 text-emerald-400" />
              <span>Cover Photo (URL or Preset)</span>
            </label>
            <input
              type="url"
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              placeholder="Paste image URL (https://...) or choose below"
              className="w-full px-3 py-2 bg-stone-800/80 rounded-xl text-xs text-stone-100 border border-stone-700/80 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 mb-1.5"
            />
            <div className="flex flex-wrap gap-1.5">
              {PHOTO_PRESETS.map((photo) => (
                <button
                  type="button"
                  key={photo.label}
                  onClick={() => setCoverImage(photo.url)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] transition-colors border ${
                    coverImage === photo.url
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      : 'bg-stone-800/70 text-stone-400 hover:text-stone-200 border-stone-700/60'
                  }`}
                >
                  {photo.label}
                </button>
              ))}
            </div>
          </div>

          {/* Blog Content / Paragraphs */}
          <div>
            <label className="block text-xs font-medium text-stone-300 mb-1">
              Your Travel Story & Group Information *
            </label>
            <textarea
              required
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your paragraphs here... Describe the trek route, boat journey, camping tips, team experience, and how people can join or learn more about your group."
              className="w-full px-3 py-2.5 bg-stone-800/80 rounded-xl text-xs text-stone-100 border border-stone-700/80 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 leading-relaxed"
            />
            <span className="text-[10px] text-stone-500 block text-right mt-0.5">
              Separate paragraphs with a blank line for clean reading view formatting.
            </span>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !title.trim() || !author.trim() || !content.trim()}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-md transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Publishing to Database...' : 'Publish Blog to All Feeds'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
