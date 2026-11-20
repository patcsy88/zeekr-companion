# ADR-014: Push notifications for the geofence alert and the automatic Sentry send (proposal)

Status: **Drafted 2026-11-20. The owner approved the design, the data model, the API contract and the new external service (the phone maker's push service) on 2026-11-20 ("Approve"). The Python sender library is not yet approved: its version, licence and advisories are checked first, before build step 2. Build step 1 (no new package, fake sender) is built and tested (2026-11-20); each step is approved before the next.**

## Context

The app has no push. The owner finds out about a geofence alert or an automatic Sentry send (ADR-011) only by opening the app. The owner asked on 2026-11-20 for a notification for both events.

Web Push on iOS works only for a Home Screen app, on iOS 16.4 or later, over HTTPS, after a permission prompt that follows a tap. HTTPS exists now (Tailscale). The owner's phone is an iPhone 15 Pro Max.

## Events

| Event                                                               | Where it happens                                        | Notification text (fixed, no position)                       |
| ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| A geofence alert opens and the automatic send is off                | `GeofenceCheck.run_once`, outcome `alert opened`        | "Car is away from home and Sentry is off."                   |
| A geofence alert opens and the automatic send worked                | same place, after `AutoSentrySender.after_alert_opened` | "Car is away from home. Sentry was turned on automatically." |
| A geofence alert opens and the automatic send failed or was skipped | same                                                    | "Car is away from home. Sentry could not be turned on."      |

One notification per new alert, never two, so the phone buzzes once. The text carries no coordinate, address, plate or distance. Tapping it opens the Sentry tab.

## Decisions proposed

1. **Server sends, best effort.** The send happens after the alert is saved, with a short timeout. A failed send logs one line (no endpoint, no keys) and never stops the geofence loop or the automatic send.
2. **One owner, a few phones.** At most 5 saved devices. Subscribing is per device and means "both events". Turning it off on a device removes its row.
3. **Dead subscriptions clean themselves.** A `404` or `410` from the push service deletes that row.
4. **Keys live on the host only.** `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` in the host `.env`. The subject is a contact address, so it is never committed. If they are unset, push is off and the Geofence tab says so. Everything else works as today.
5. **Custom service worker.** The generated worker moves to `injectManifest` so it can handle `push` and `notificationclick`. Caching stays app shell only, with nothing under `/api` cached, and updates stay user-confirmed (`registerType: 'prompt'`).
6. **Permission flow.** A button on the Geofence tab, "Turn on alerts", asks for permission only after a tap, and says it needs the Home Screen app. A "Send a test" button sends one fixed test message.

## Data model (needs approval)

New table `push_subscription`, migration `0019`:

| Column            | Type                          | Notes                                                          |
| ----------------- | ----------------------------- | -------------------------------------------------------------- |
| `id`              | uuid, primary key             |                                                                |
| `endpoint`        | text, unique, not null        | The phone's push address. Sensitive: never logged or returned. |
| `p256dh`          | text, not null                | The phone's public key. Sensitive.                             |
| `auth`            | text, not null                | The phone's auth secret. Sensitive.                            |
| `created_at`      | timestamptz, not null         | UTC                                                            |
| `last_success_at` | timestamptz, null             | UTC                                                            |
| `failure_count`   | smallint, not null, default 0 | Reset on success. At 5 in a row the row is deleted.            |

Checks: `endpoint` length 1 to 2048; key lengths bounded. No home, office, position or vehicle data is stored. Downgrade drops the table (all devices must subscribe again).

## API contract (needs approval)

All need the bearer token, answer `Cache-Control: no-store`, and report a bad body as `400`, never `422`.

| Method and path                     | Purpose                                    | Body                                                                   | Response                                                                                                      |
| ----------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/push/config`           | Is push on, and the public key             | none                                                                   | `{ "enabled": bool, "public_key": string or null, "devices": int, "max_devices": 5 }`                         |
| `POST /api/v1/push/subscriptions`   | Save this phone                            | `{ "endpoint": string, "keys": { "p256dh": string, "auth": string } }` | `201 { "devices": int }`; the same endpoint again updates the keys and answers `200`; a sixth device is `409` |
| `DELETE /api/v1/push/subscriptions` | Remove this phone                          | `{ "endpoint": string }`                                               | `200 { "devices": int }`; an unknown endpoint is also `200` (repeatable)                                      |
| `POST /api/v1/push/test`            | Send one fixed test message to all devices | none                                                                   | `200 { "sent": int, "failed": int }`; `409` when push is off                                                  |

`endpoint` must be an `https` URL. The server never returns an endpoint or a key.

## New dependency and external service (need approval)

- **Dependency:** a Web Push sender library for Python (for example `pywebpush`), pinned exactly like the other packages. I have not checked a version, its licence or its advisories; `pip-audit` and the licence check run before it is approved for the image.
- **External service:** the host sends outbound HTTPS to the phone maker's push service. That path is not self-hosted (ADR-004), because Web Push cannot avoid it. It sees that a message was sent, its size and timing, not the text (the payload is encrypted for the phone).
- **Content Security Policy:** no change. The browser talks to its own push service, and the page never calls it.

## Limits to accept

- iOS can delay or drop web push, and it does not work in a normal Safari tab.
- Removing the app from the Home Screen drops the subscription.
- A real notification cannot be tested in jsdom. The server side is tested with a fake sender; a real iPhone check is **deferred, not run** until the owner tries it.
- If the owner revokes permission in iOS settings, the server finds out only when the push service answers `410`.

## Build steps (each approved before the next)

1. Migration `0019`, model, repository, config values, and the four endpoints with a fake sender and tests. Contract written into `api-contracts.md`.
2. The sender behind a small interface, the hook in `run_once`, failure and clean-up rules, and tests.
3. Custom service worker, the Geofence tab buttons and tests.
4. Docs, deploy guide (generating the VAPID keys on the host, the host `.env` values), and a fresh encrypted export before deploying, because of the migration.

## Not in scope

Reminder notifications, expense or warranty notifications, any command from a notification, actions inside the notification, and quiet hours.
