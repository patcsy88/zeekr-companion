# ADR-015: Notification rules (approved 2026-11-21, not built)

Status: **Drafted 2026-11-21. The owner approved the design answers in chat on 2026-11-21: own radius per rule with the home and office points from the Geofence tab, a cooldown default of 10 minutes, AND or OR per rule, up to 5 rules, the position used as a true or false result, the central locking label in a push, and the engine status read in memory. The owner approved the data model and the API contract on 2026-11-21 ("yes"). No code is written yet; each build step is approved before it starts.**

## Context

The owner wants to be told when a set of vehicle states holds, for example: Vehicle Status is Deep Sleep or Parked, and Engine Status is `engine-off`, then send the Central locking label (Locked or Unlocked). Rules must be configurable and send once when first observed. The rules are independent of the geofence alert and automatic Sentry (ADR-011), and the geofence's inside or outside test may be one of a rule's conditions.

The code tables are in `docs/architecture/vehicle-status-codes.md`. All labels there are `unverified`.

## Decisions proposed

1. **Independent of the geofence.** Rules never open an alert, never send Sentry and never write to the geofence tables. They run in their own loop, so they work when the geofence is off. They read the geofence's home and office points and stale limit, and nothing else of it.
2. **One shared reading.** Each check takes one read through `LiveVehicleService.card()`, the same provider, spacing, lock and login cap as the Vehicle card and the geofence. Rules add no Zeekr call. A rule cannot be quicker than the read interval (5 minutes or more).
3. **Conditions.** One to four conditions per rule, each field at most once:

   | Field            | Shape                       | Allowed values                                                      |
   | ---------------- | --------------------------- | ------------------------------------------------------------------- |
   | `vehicle_status` | `{field, codes}`            | `0`, `1`, `2`, `3`, `4`, `13`                                       |
   | `engine_status`  | `{field, codes}`            | `engine-off`, `engine-running`, `ready`, `charging`                 |
   | `gear`           | `{field, codes}`            | `0`, `1`, `2`, `3`                                                  |
   | `location`       | `{field, where, radius_km}` | `where` is `outside` or `inside`; radius above 0 and at most 100 km |

   Within one field, any ticked code matches. The screen shows labels, and the API stores codes.

4. **AND or OR (`match`).** A rule is either `all` (every condition) or `any` (at least one). The default is `all`. A rule cannot mix them. For a mix, use two rules.
5. **Unknown readings.** Each condition is true, false or unknown. A condition is unknown when the reading it needs is missing, when the whole reading is older than the stale limit, or when it is `location` and the position or the home point is missing.

   | `match` | Result                                                                           |
   | ------- | -------------------------------------------------------------------------------- |
   | `all`   | Any false: not matched. Otherwise any unknown: not evaluated. Otherwise matched. |
   | `any`   | Any true: matched. Otherwise any unknown: not evaluated. Otherwise not matched.  |

   Not evaluated means the stored state stays as it was and nothing is sent.

6. **Editing.** A change to `match` or `conditions` resets `last_matched` and `last_result` to null, so the edited rule can send once. A change to the name, `enabled` or the cooldown keeps them. `last_sent_at` is kept.
7. **Once when first observed.** A push is sent when the result goes from not true (or never evaluated) to matched. While it stays matched, nothing more is sent. When it turns not matched, `last_matched` becomes false, so a later match sends again. A new rule whose conditions already hold sends once.
8. **Cooldown.** `cooldown_minutes` is 0 to 1440, default 10, and 0 means none. A send less than that long after `last_sent_at` is held back, and `last_matched` is not set to true. If the conditions still hold at a later check after the cooldown, it sends then.
9. **Message.** The Central locking label only in v1, fixed text with no place, distance, reading age or rule name:

   | Central locking code | Text                           |
   | -------------------- | ------------------------------ |
   | `1`                  | "Central locking: Locked."     |
   | `0`                  | "Central locking: Unlocked."   |
   | No reading           | "Central locking: no reading." |

   The tap target is the Vehicle tab. Geofence pushes keep opening the Sentry tab.

10. **Memory only.** Vehicle status, engine status, gear, central locking, position and distance are read in memory, used for the check and dropped. Only `last_matched`, `last_result` and `last_sent_at` are stored. Nothing is logged or sent to the model.
11. **Rules only notify.** Nothing here sends a command to the car (ADR-008).
12. **Push not set up.** Rules can be saved. The screen says nothing will be sent. No send is attempted.

## Data model (approved 2026-11-21)

Table `notification_rules`, migration `0021`:

| Column                     | Type                     | Note                                                                                                                                                  |
| -------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID                     |                                                                                                                                                       |
| `name`                     | text, 1 to 60 characters | The owner's label. Never sent in a push.                                                                                                              |
| `enabled`                  | boolean                  |                                                                                                                                                       |
| `match`                    | `all` or `any`           | Default `all`.                                                                                                                                        |
| `conditions`               | JSON list, 1 to 4 items  | Checked on save against the fixed lists above.                                                                                                        |
| `cooldown_minutes`         | integer, 0 to 1440       | Default 10.                                                                                                                                           |
| `last_matched`             | boolean or null          | Only the last true or false result. Never a reading.                                                                                                  |
| `last_result`              | text or null             | One fixed phrase (see the API contract), chosen by a check constraint. Added on the owner's approval, 2026-11-21. Never a reading, position or place. |
| `last_sent_at`             | timestamp (UTC) or null  |                                                                                                                                                       |
| `created_at`, `updated_at` | timestamp (UTC)          |                                                                                                                                                       |

At most 5 rows. A fresh encrypted export is taken before deploying the migration.

## API contract (approved 2026-11-21)

Written in `docs/architecture/api-contracts.md`, section "Notification rules".

## Approvals this needs

- **ADR-009 amendment:** `engineStatus` is read in memory for rules (the mapping exists and is not yet called). The position is used for a true or false inside or outside result, as the geofence does, and dropped. The central locking value may be sent in a push, as the fixed text above. See the amendment dated 2026-11-21.
- **ADR-014 amendment:** rule pushes use the same sender and the same saved phones, with the Vehicle tab as the tap target.
- **New dependency or service:** none.

## Limits to accept

- **Delay:** readings are at least 5 minutes apart and push delivery delay is unknown. This cannot be instant.
- **Unverified labels:** Parked (Vehicle Status), Deep Sleep's label and all Engine Status values have not all been seen on the owner's car. A rule using them might never fire. The engine status spelling (hyphen or underscore) has not been seen either.
- **Stale readings:** a car that is asleep may keep serving its last snapshot, so a rule can fire on a reading that is older than the real state. The reading age check only limits this.
- **Lock freshness:** the lock value is as fresh as the last read.
- **Single-owner scale:** the check loop and the evaluation are tuned for one owner and five rules.

## Build steps (each approved before the next)

1. **Built 2026-11-21, not released.** Migration `0021`, model, repository, options and the four endpoints, and the evaluation function with tests. No loop yet.
2. **Built 2026-11-21, not released.** The loop, the shared read, the send and the cooldown, with a fake sender and tests. The check runs every `ZEEKR_LIVE_INTERVAL_MINUTES` (first check about 75 seconds after start), needs live readings and not the geofence, and uses the geofence stale limit. A send counts only if a phone accepted it; otherwise the rule stays unmarked and retries.
3. The Setup, Notifications, Rules screen, the drop-down tick lists and tests.
4. Docs, deploy notes, and a fresh encrypted export before deploying.

## Not in scope

- Mixing AND and OR in one rule, and grouped conditions.
- Messages other than the Central locking label.
- Reading or sending door, trunk or window lock fields.
- Sending a command to the car.
