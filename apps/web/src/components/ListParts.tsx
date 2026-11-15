import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Card } from './ui/card';

/** Page title row: heading on the left, main action on the right. */
export const HEAD = 'flex flex-wrap items-center justify-between gap-3';
/** Secondary text. */
export const MUTED = 'text-muted-foreground';
/** Small secondary text (notes under a heading or a list). */
export const SMALL = 'text-muted-foreground text-sm';
/** A list of item cards. */
export const LIST = 'm-0 my-3 grid list-none gap-2 p-0';
/** The tappable body of an item card. */
export const ITEM_BODY =
  'flex min-h-12 min-w-0 flex-1 flex-col gap-0.5 p-3 text-foreground no-underline';
/** Item title line. */
export const TITLE = 'font-semibold [overflow-wrap:anywhere]';
/** Item detail line. */
export const META = 'block text-muted-foreground text-sm [overflow-wrap:anywhere]';
/** A plain list (totals lines). */
export const PLAIN = 'm-0 mt-1 mb-3 list-none p-0';
/** The row of buttons on a detail page. */
export const ROW_ACTIONS = 'mt-4 flex flex-wrap items-center gap-2';
/** Keeps the owner's line breaks. */
export const PREWRAP = 'whitespace-pre-wrap';

const NOTICE_BASE =
  'my-2 rounded-xl border px-3.5 py-3 text-foreground text-sm [&_h2]:mt-0 [&_p]:my-1 [&_ul]:my-1';
/** A coloured notice box (COSS Alert look). Use on a <p> or <div> with its own role. */
export const NOTICE = {
  info: cn(NOTICE_BASE, 'border-info/32 bg-info/4'),
  bad: cn(NOTICE_BASE, 'border-destructive/32 bg-destructive/4'),
  warn: cn(NOTICE_BASE, 'border-warning/32 bg-warning/4'),
};

/** One card in a LIST. */
export function ItemCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card render={<li />} className={cn('flex-row items-center gap-2 pe-3', className)}>
      {children}
    </Card>
  );
}

/** Label / value pairs in a card. Children are <dt>/<dd> pairs. */
export function Details({ children }: { children: ReactNode }) {
  return (
    <Card
      render={<dl />}
      className="m-0 my-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 p-4 [&>dd]:m-0 [&>dd]:[overflow-wrap:anywhere] [&>dt]:text-muted-foreground"
    >
      {children}
    </Card>
  );
}

/** The dashed box shown when a list has nothing in it yet. */
export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="my-3 rounded-2xl border border-input/48 border-dashed px-4 py-5 text-center [&_p]:my-1">
      <p className={MUTED}>{title}</p>
      <p className={SMALL}>{hint}</p>
    </div>
  );
}
