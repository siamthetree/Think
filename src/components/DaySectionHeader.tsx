import React from 'react';

interface DaySectionHeaderProps {
  label: string;
  count?: number;
}

export const DaySectionHeader: React.FC<DaySectionHeaderProps> = ({ label, count }) => (
  <div className="sticky top-0 z-10 px-4 sm:px-5 py-2 bg-stone-100/95 dark:bg-stone-900/95 backdrop-blur-md border-b border-stone-200/60 dark:border-stone-800/60 flex items-center justify-between select-none">
    <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
      {label}
    </span>
    {count !== undefined && (
      <span className="text-[11px] text-stone-400 dark:text-stone-500 font-mono">
        {count} stories
      </span>
    )}
  </div>
);
