import React from 'react';

interface SourceAvatarProps {
  name: string;
  iconUrl?: string;
  size?: 'sm' | 'md';
}

export const SourceAvatar: React.FC<SourceAvatarProps> = ({ name, iconUrl, size = 'sm' }) => {
  const initials = name.trim().slice(0, 1).toUpperCase() || '?';
  const sizeClass = size === 'md' ? 'h-9 w-9 text-sm' : 'h-6 w-6 text-[10px]';

  return (
    <span
      className={`source-avatar inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-200 font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300 ${sizeClass}`}
      aria-hidden="true"
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initials
      )}
    </span>
  );
};
