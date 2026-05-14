import { Skeleton } from '@tether/design';

export function TerminalSurfaceSkeleton() {
  return (
    <div className="terminal-skeleton" aria-hidden="true">
      {Array.from({ length: 13 }).map((_, index) => (
        <Skeleton
          className={`terminal-skeleton-line terminal-skeleton-line-${(index % 5) + 1}`}
          key={index}
        />
      ))}
    </div>
  );
}
