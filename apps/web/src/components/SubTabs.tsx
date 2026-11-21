import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { tabFor } from '../lib/nav';
import { cn } from '../lib/cn';

/**
 * A row under the header for a main tab with several pages. It shows on the list pages only, so
 * forms and detail pages keep their full width. A long row scrolls sideways and keeps the current
 * page in view.
 */
export function SubTabs() {
  const { pathname } = useLocation();
  const tab = tabFor(pathname);
  const current = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    current.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  if (!tab || tab.subs.length === 0 || !tab.subs.some((s) => s.to === pathname)) return null;
  return (
    <nav aria-label={`${tab.label} pages`} className="-mx-4 mb-3 overflow-x-auto px-4">
      <ul className="m-0 flex w-max min-w-full list-none gap-1 p-0">
        {tab.subs.map((s) => {
          const active = s.to === pathname;
          return (
            <li key={s.to}>
              <Link
                to={s.to}
                ref={active ? current : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-9 items-center whitespace-nowrap rounded-full px-3.5 font-semibold text-sm no-underline',
                  active ? 'bg-accent text-foreground' : 'text-muted-foreground',
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
