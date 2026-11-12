import React from 'react';

interface PerspectiveLogoProps {
  className?: string;
}

/**
 * Custom Apple-style Perspective Logo:
 * Overlapping multi-angle prism lenses representing multiple viewpoints on a single news story.
 */
export const PerspectiveLogo: React.FC<PerspectiveLogoProps> = ({
  className = 'w-4 h-4',
}) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Left angled perspective plane */}
      <path
        d="M12 2.75L3.75 7.5V16.5L12 21.25L20.25 16.5V7.5L12 2.75Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Inner intersecting prism facets (multiple viewpoints converging) */}
      <path
        d="M3.95 7.65L12 12.25L20.05 7.65"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 12.25V21"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Top lens highlight facet */}
      <circle cx="12" cy="7.5" r="1.4" fill="currentColor" />
    </svg>
  );
};
