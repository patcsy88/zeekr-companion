# COSS UI pilot (proposal)

Status: **design approved by the owner on 2026-11-15 (option A, bundled Inter).** Built on the local branch `ui-coss-pilot`. Not merged, not pushed, not deployed. No API, data model or server change.

## Scope

- Converted: the sign-in screen (`SignIn.tsx`) and the Vehicle page (`VehiclePage.tsx`: view, edit form, and the live card in `LiveVehicleCard.tsx`).
- Unchanged: the other 21 pages and the shared components, including `components/Field.tsx`.
- The rest of the app moves only if the owner approves the pilot on the phone.

## Library

[COSS UI](https://coss.com/ui) (MIT), built on Base UI and Tailwind CSS v4. Components are copied into the repo as source, so they are our code to edit.

| Package                            | Version | License    | Kind                 |
| ---------------------------------- | ------- | ---------- | -------------------- |
| `@base-ui/react`                   | 1.9.0   | MIT        | runtime              |
| `class-variance-authority`         | 0.7.1   | Apache-2.0 | runtime              |
| `clsx`                             | 2.1.1   | MIT        | runtime              |
| `tailwind-merge`                   | 3.7.0   | MIT        | runtime              |
| `@fontsource-variable/inter`       | 5.3.0   | OFL-1.1    | runtime (font files) |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.5   | MIT        | build only           |

No paid or external service. `npm audit` is unchanged (0 high, 0 critical).

Copied components (`apps/web/src/components/ui/`): button, spinner, input, label, card, badge and alert, plus `cn` in `src/lib/cn.ts`. Local changes:

- `spinner.tsx` draws its icon as inline SVG, so `lucide-react` is not needed.
- `card.tsx` and `alert.tsx` keep only the parts in use, and COSS Field is not copied, so unused code does not lower the coverage floors.
- `button.tsx` adds `no-underline`, because links rendered as buttons would otherwise keep the browser underline.

## Design choices

1. **Native dropdowns.** The Vehicle form keeps `<select>` elements inside the COSS input frame, so iOS keeps its picker wheel and the tests keep working.
2. **Theme.** First pass: the COSS colour names mapped to the app's own teal palette. After seeing that on the phone, the owner chose COSS's own neutral theme (2026-11-15, option 2 then 1). The COSS colour names (`primary`, `muted-foreground`, `destructive`, and so on) now take COSS's published light and dark values (`coss.com/ui/r/style.json`), written out in `src/app.css` as `--coss-*` variables: near-black main buttons in light mode, near-white in dark, neutral cards and COSS's red, blue, green and amber. One exception: field borders (`--color-input`) keep the app's `--control-border`, because COSS's 10% black edge is about 1.25:1 on white, below the 3:1 a control edge needs; the app colour is 3.03:1 light and about 5:1 dark. Other pairs, computed: main button text 14.5:1 light and 13.9:1 dark, muted text 5.6:1 light and 4.4:1 dark, error text 6.4:1 light and 6.0:1 dark. The light, dark and system picker stays, and Tailwind's `dark:` variant follows the same `data-theme` attribute and the phone setting. The header, bottom bar, page background, links and switches still use the app's palette, so the converted screens differ from the rest of the app until every page is converted.
3. **Font.** Inter is bundled and served from the app itself. Only the Latin file (48 KB) is precached for offline use; the other scripts load on demand. System fonts are the fallback.
4. **Security policy (CSP).** No change. Tailwind compiles to an ordinary stylesheet. The app is wrapped in `CSPProvider disableStyleElements`, and the one inline style Base UI would inject (hidden scrollbars) is in `app.css` instead. The end-to-end tests run under the production policy.
5. **No global reset.** Tailwind's preflight is left out so the unconverted pages do not shift. Instead:
   - `styles.css` is imported into a `legacy` cascade layer, below Tailwind's utilities, so the COSS classes win where both apply.
   - The app's global `button`, `input`, `label` and `select` rules skip elements that carry `data-slot`, which every COSS component sets.
   - A small reset in `app.css` applies only to `[data-slot]` elements (box sizing, border style, font).
   - Tailwind scans only the converted files (`@source` in `app.css`). Each page is added there as it moves.

## Findings

- **Unconverted pages:** in the screenshots, Service history and Reminders match the committed README images, except that the text is now Inter (the font is app-wide).
- **Bundle (production build, gzip):**
  - JavaScript: 158,036 to 174,650 bytes (+16.6 KB), mostly Base UI.
  - CSS: 3,469 to 10,013 bytes (+6.5 KB).
  - Font: +48 KB precached (Latin Inter).
- **Tests:** all unit and end-to-end tests pass without change, because labels, roles, ids, `aria-*` attributes and test ids are kept. Web coverage after: 87.72 / 82.4 / 84.95 / 90.76 (statements / branches / functions / lines), above every floor.

## Seeing it on the phone

Published images are built only from release tags on `main`, so this branch cannot reach the host as an image. Trying it on the phone needs an owner deploy from a clone of the branch, which is a separate approval. The commands will be given from the repo at that point.

## If approved

Convert the remaining pages in stages (shared form parts first, then each section), with the full gates after each stage. Once every page is converted, add Tailwind's preflight and delete the replaced parts of `styles.css`.

Merged to `main` and released as `v0.9.3` (owner, 2026-11-15). Stages after the pilot:

1. **Shared form parts (done, 2026-11-15).** `components/Field.tsx` now builds `TextField`, `TextArea` and a new `SelectField` (native `<select>` in the COSS frame, moved out of `VehiclePage.tsx`) on COSS parts, with the same ids, `name`s and `aria-describedby` wiring. It also exports `HINT`, `ERROR`, `FORM` and `ACTIONS` class strings. A trimmed COSS `ui/textarea.tsx` (native textarea, no Base UI Field) is added. The service, reminder, expense, claim, coverage and tyre forms and the Complete service page use them, with COSS buttons. The tyre Wheels checkboxes stay native (`accent-primary`). The legacy `textarea` rules skip `[data-slot]`. No test changed. CSS gzip 10,013 to 10,499 bytes; JS gzip 174,650 to 175,008 bytes.
2. **Lists and detail pages (done, 2026-11-15).** A new `components/ListParts.tsx` holds the shared list look: `ItemCard` (a COSS card as a list item), `Details` (label and value pairs in a card), `EmptyState`, `NOTICE.info|bad` (COSS alert colours) and class strings for titles, detail lines and action rows. Service history, Reminders, Expenses (list and totals), Warranty and Tyres, and the service, reminder, expense, coverage (with claims) and tyre event detail pages use them. The sync, reminder and warranty status badges are COSS badges. Edit, Delete and the other actions are COSS buttons (Delete is the red one), and links styled as buttons render through `Button`. The delete confirmations keep their `alertdialog` role and Cancel focus. The rotation reminder field uses `TextField`. No test changed. CSS gzip 10,499 to 10,778 bytes; JS gzip 175,008 to 175,614 bytes.
3. **Templates and filters:** the reminder and warranty template pages and the Expenses filter.
4. **Sentry, Geofence, Advisory and live history.** The switches stay as they are unless the owner asks.
5. **App shell:** header, sync bar, account menu, theme picker, tab bar, update banner. Then add preflight and delete the replaced `styles.css` rules.
