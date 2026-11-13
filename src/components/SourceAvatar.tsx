import React, { useState } from 'react';

export interface SourceAvatarProps {
  name: string;
  url?: string;
  iconUrl?: string;
  size?: 'sm' | 'md' | 'lg';
}

const BRAND_GRADIENTS: Record<string, string> = {
  daily: 'from-blue-600 to-indigo-800 text-white',
  prothom: 'from-red-600 to-rose-800 text-white',
  প্রথম: 'from-red-600 to-rose-800 text-white',
  business: 'from-amber-600 to-orange-700 text-white',
  tbs: 'from-amber-600 to-orange-700 text-white',
  bdnews: 'from-emerald-600 to-teal-800 text-white',
  tribune: 'from-teal-600 to-cyan-800 text-white',
  financial: 'from-cyan-700 to-blue-900 text-white',
  bbc: 'from-red-700 to-red-950 text-white',
  guardian: 'from-blue-800 to-slate-900 text-white',
  travel: 'from-emerald-600 to-green-800 text-white',
  jugantor: 'from-orange-600 to-red-700 text-white',
  যুগান্তর: 'from-orange-600 to-red-700 text-white',
};

function getGradientForName(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, gradient] of Object.entries(BRAND_GRADIENTS)) {
    if (lower.includes(key)) return gradient;
  }
  const charCode = name.charCodeAt(0) || 65;
  const fallbacks = [
    'from-indigo-600 to-violet-800 text-white',
    'from-emerald-600 to-teal-800 text-white',
    'from-orange-500 to-amber-700 text-white',
    'from-rose-600 to-pink-800 text-white',
    'from-sky-600 to-blue-800 text-white',
  ];
  return fallbacks[charCode % fallbacks.length];
}

function isLocalAvatarAsset(iconUrl?: string): boolean {
  if (!iconUrl) return false;
  const trimmed = iconUrl.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  if (/^data:image\/(?:svg\+xml|png|jpeg|jpg|webp);/i.test(trimmed)) return true;
  return false;
}

export const SourceAvatar: React.FC<SourceAvatarProps> = ({ name, iconUrl, size = 'sm' }) => {
  const [imgError, setImgError] = useState(false);
  const initials = name.trim().slice(0, 1).toUpperCase() || '?';

  // Never request icons from third-party favicon services or remote publisher domains
  const safeLocalIcon = isLocalAvatarAsset(iconUrl) ? iconUrl!.trim() : undefined;

  const sizeClass =
    size === 'lg'
      ? 'h-11 w-11 text-base rounded-2xl shadow-md'
      : size === 'md'
      ? 'h-9 w-9 text-xs rounded-xl shadow-xs'
      : 'h-6 w-6 text-[10px] rounded-lg shadow-2xs';

  const gradient = getGradientForName(name);

  return (
    <span
      className={`source-avatar relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br ${gradient} font-bold font-serif select-none ring-1 ring-white/20 ${sizeClass}`}
      aria-hidden="true"
    >
      {safeLocalIcon && !imgError ? (
        <img
          src={safeLocalIcon}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="h-full w-full object-cover p-1 bg-white dark:bg-stone-900 rounded-[inherit]"
          loading="lazy"
        />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
};
