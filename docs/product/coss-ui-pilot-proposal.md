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
- `button.tsx` adds `no-underline` (kept after stage 5, where the base styles underline plain links without a class).

## Design choices

1. **Native dropdowns.** The Vehicle form keeps `<select>` elements inside the COSS input frame, so iOS keeps its picker wheel and the tests keep working.
2. **Theme.** First pass: the COSS colour names mapped to the app's own teal palette. After seeing that on the phone, the owner chose COSS's own neutral theme (2026-11-15, option 2 then 1). The COSS colour names (`primary`, `muted-foreground`, `destructive`, and so on) now take COSS's published light and dark values (`coss.com/ui/r/style.json`), written out in `src/app.css` as `--coss-*` variables: near-black main buttons in light mode, near-white in dark, neutral cards and COSS's red, blue, green and amber. One exception: field borders (`--color-input`) keep the app's `--control-border`, because COSS's 10% black edge is about 1.25:1 on white, below the 3:1 a control edge needs; the app colour is 3.03:1 light and about 5:1 dark. Other pairs, computed: main button text 14.5:1 light and 13.9:1 dark, muted text 5.6:1 light and 4.4:1 dark, error text 6.4:1 light and 6.0:1 dark. The light, dark and system picker stays, and Tailwind's `dark:` variant follows the same `data-theme` attribute and the phone setting. Stage 5 (owner, 2026-11-15, "Fully neutral") moved the rest to the same neutral theme: page background, header, sync bar, tab bar (the current tab gets a light grey tint), text links and the switches (on is near-black in light mode, near-white in dark). Only the logo keeps its teal. The browser bar and install colours follow (owner, "Neutral, update the test"): `#ffffff` light and `#161616` dark, close to the COSS dark background; the install splash background is `#ffffff`. The field border colour was retuned to grey to match: `#8c8c8c` light (3.36:1 on white) and `#808080` dark (4.58:1 on `#161616`).
3. **Font.** Inter is bundled and served from the app itself. Only the Latin file (48 KB) is precached for offline use; the other scripts load on demand. System fonts are the fallback.
4. **Security policy (CSP).** No change. Tailwind compiles to an ordinary stylesheet. The app is wrapped in `CSPProvider disableStyleElements`, and the one inline style Base UI would inject (hidden scrollbars) is in `app.css` instead. The end-to-end tests run under the production policy.
5. **No global reset (pilot to stage 4; replaced in stage 5).** Tailwind's preflight was left out so the unconverted pages did not shift. Instead:
   - `styles.css` is imported into a `legacy` cascade layer, below Tailwind's utilities, so the COSS classes win where both apply.
   - The app's global `button`, `input`, `label` and `select` rules skip elements that carry `data-slot`, which every COSS component sets.
   - A small reset in `app.css` applies only to `[data-slot]` elements (box sizing, border style, font).
   - Tailwind scans only the converted files (`@source` in `app.css`). Each page is added there as it moves.
   - Stage 5 removed all of this: preflight is on, `styles.css` is deleted, and Tailwind scans the whole of `src`.

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
3. **Templates and filters (done, 2026-11-15).** The reminder and warranty template pages use `TextField`, `TextArea` and `SelectField`, with each checkpoint or term as a COSS card (still an `<li>`, which the reminders e2e test relies on), the suggestion notice as `NOTICE.info`, and COSS buttons ("Add it yourself" renders a link through `Button`). The checkboxes stay native. The baseline date error is now linked to its field through `aria-describedby` (`baseline-error`), like every other form. The Expenses filter is a COSS card form with `SelectField`, `TextField` and outline buttons. The select chevron in `Field.tsx` is now drawn with CSS, not an `<svg>`, because the expenses QA test checks that no `<svg>` appears in page content. No test changed. Measured again with Node zlib on fresh builds of stage 2 and stage 3: CSS gzip 10,759 to 10,826 bytes; JS gzip 175,596 to 175,324 bytes (the select icon went).
4. **Sentry, Geofence, Advisory and live history (done, 2026-11-15).** The Sentry command panel and the Automatic Sentry panel are COSS cards; the command panel is green-edged when the car reports Sentry on and dashed when the state is unknown (it keeps the `sentry-panel-<tone>` class the tests read). The geofence alert uses a new `NOTICE.warn` (COSS warning colours). The Geofence fields and the quiet period use `TextField`, so their hints and errors are now linked to the field; the Vehicle State(s) checkboxes stay native, styled like the tyre Wheels. Advisory suggestions and the stored readings are COSS cards; the trend charts stay as they were (an `<svg>` with `role="img"`, now styled with utilities). All buttons are COSS buttons ("Delete all history" and its confirm are the red ones; Back renders a link through `Button`). The two Sentry switches are unchanged. No test changed. CSS gzip 10,826 to 10,932 bytes; JS gzip 175,324 to 175,616 bytes.
5. **App shell, preflight and the old stylesheet (done, 2026-11-15).** The header, skip link, sync bar (COSS badges and an outline Sync now button), account menu, theme picker (a ghost icon button), tab bar and update banner are built with utilities and COSS parts. The sign-out confirmation keeps its `alertdialog` role and Cancel focus, and now opens as a panel under the header instead of inside the header row. The live card and the Vehicle page lost their last old classes; the tyre boxes keep the `tyre` and `dash-label` classes the tests read. The two Sentry switches and the read-only indicators share a new `SwitchTrack` (same size, same `role="switch"` markup). The skeleton shimmer moved to `app.css` and keeps its `skeleton-line` class. Tailwind's preflight is on and `styles.css` (858 lines) is deleted. The few page-wide rules still needed are in the `base` layer of `app.css`: body colours, line height and room for the tab bar; `h1`/`h2` sizes; paragraph and plain list spacing; underlined plain text links; the focus outline; and reduced motion. Only `test/theme.test.tsx` changed (the new bar colours). CSS gzip 10,932 to 10,978 bytes; JS gzip 175,616 to 176,450 bytes.
6. **Sign-in code as COSS OTP Field (done, 2026-11-15; owner approved the design: six boxes in one row, sent by the Sign in button).** `ui/otp-field.tsx` is copied from COSS (the separator part is left out). The Code field on the sign-in screen is now six digit boxes (number pad, one digit per box, Backspace goes back, a pasted code fills them all; Base UI puts `autocomplete="one-time-code"` on the first box). A "Use a recovery code" link swaps in a plain "Recovery code" text field, and "Use an app code" swaps back; each switch empties the code. Empty is still allowed for MFA off, the code is still cleared after sign-in, and the same 401 wording is kept. No server or contract change: the request still sends `code`, trimmed, only when it is not empty. `test/components.test.tsx` changed: the code tests now type into the boxes, and new tests cover digits only, focus moving along, Backspace, paste, and the recovery switch. Not checked on an iPhone: whether the iOS code suggestion fills all six boxes. JS gzip about 176.5 to 183.5 KB, CSS gzip about 11.0 to 11.5 KB (the stage 5 build and this one, not measured the same way).
7. **Confirmations as COSS Alert Dialog (done, 2026-11-15; owner approved the design: all eight confirmations, a bottom sheet on a phone, the Sentry confirm left as it is).** `ui/alert-dialog.tsx` is copied from COSS; the only change is room for the iPhone home indicator under the buttons. A new `components/ConfirmDialog.tsx` builds the one confirmation all eight use: service record, expense, reminder, tyre event, coverage and claim delete, Live History "delete all", and sign-out. Each now opens over the page with a dimmed background instead of replacing the action row inside the page. On a phone it slides up from the bottom; on wider screens it is centred. Titles, descriptions, button labels, the unsent-change count and the sign-out error are unchanged. The claim and Live History confirmations used to have only an `aria-label` ("Delete claim", "Confirm delete"); they now have a title ("Delete this claim?", "Delete all stored readings?") and the description "This cannot be undone.". Cancel has the focus when it opens; Escape or Cancel closes it and focus goes back to the button that opened it; a tap on the dimmed background does nothing. The dialog is rendered outside `main`, and the page behind is hidden from screen readers and cannot be reached while it is open. The Sentry command confirm (`SentryControl.tsx`) is vehicle control and is not changed. Tests: `test/tyres.test.tsx` now waits for Cancel to get the focus (the dialog moves it after it opens); a new test in `test/components.test.tsx` covers Escape, focus going back, the page behind being hidden and the dialog sitting outside `main`; three e2e specs (`slice`, `expenses`, `regressions`) wait for the dialog to close after Cancel. Not checked on an iPhone. JS gzip about 183.5 to 200.9 KB, CSS gzip about 11.5 to 12.2 KB.
