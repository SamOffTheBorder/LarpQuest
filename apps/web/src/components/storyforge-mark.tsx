/** The hexagonal-rune mark, tinted by the current accent color via currentColor. */
export function StoryForgeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 56" fill="none" className={className} aria-hidden="true">
      <path
        d="M28 6 L48 18 L48 38 L28 50 L8 38 L8 18 Z"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <path d="M28 16 L40 23 L40 33 L28 40 L16 33 L16 23 Z" stroke="currentColor" strokeWidth="2" />
      <path
        d="M28 16 L28 40 M16 23 L40 33 M40 23 L16 33"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.5"
      />
    </svg>
  );
}
