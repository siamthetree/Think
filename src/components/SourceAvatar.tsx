import React from 'react';

export interface SourceAvatarProps {
  name: string;
  url?: string;
  iconUrl?: string;
  size?: 'sm' | 'md' | 'lg';
}

const MUTED_PALETTES = [
  'bg-[#2D3748] text-[#EDF2F7] border-[#4A5568]/40',
  'bg-[#3B3A36] text-[#F5F5F0] border-[#57534E]/40',
  'bg-[#284B63] text-[#DCE6ED] border-[#3C6E71]/40',
  'bg-[#385144] text-[#E0EBE4] border-[#4E6B5B]/40',
  'bg-[#5C3D2E] text-[#F3EBE6] border-[#785443]/40',
  'bg-[#4A3E56] text-[#EBE7F0] border-[#655577]/40',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export const SourceAvatar: React.FC<SourceAvatarProps> = ({ name, iconUrl, size = 'sm' }) => {
  const isLocalIcon = Boolean(
    iconUrl && (iconUrl.startsWith('/') || iconUrl.startsWith('data:'))
  );

  const initials = name.trim().slice(0, 1).toUpperCase() || '?';
  const paletteIndex = hashString(name) % MUTED_PALETTES.length;
  const palette = MUTED_PALETTES[paletteIndex];

  const sizeClass =
    size === 'lg'
      ? 'h-11 w-11 text-base rounded-2xl shadow-md'
      : size === 'md'
      ? 'h-9 w-9 text-xs rounded-xl shadow-xs'
      : 'h-6 w-6 text-[10px] rounded-lg shadow-2xs';

  return (
    <span
      className={`source-avatar relative inline-flex shrink-0 items-center justify-center overflow-hidden font-bold font-serif select-none border ${palette} ${sizeClass}`}
      aria-hidden="true"
    >
      {isLocalIcon ? (
        <img
          src={iconUrl}
          alt=""
          className="h-full w-full object-cover p-1 bg-white dark:bg-stone-900 rounded-[inherit]"
          loading="lazy"
        />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
};
