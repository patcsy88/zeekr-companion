# Vehicle status codes

Lookup tables for the status fields the app reads, or has approved reading, from the live Zeekr reply. Every label here is `unverified`: the labels come from a public project or from the owner's own readings, not from Zeekr. This file is a reference and not a contract. The accepted codes for each feature are in `api-contracts.md` and the ADRs.

## Vehicle Status: `basicVehicleStatus.usageMode`

| Code | Label (public project) | Seen on the owner's car                                                           | Accepted by the geofence |
| ---- | ---------------------- | --------------------------------------------------------------------------------- | ------------------------ |
| `0`  | Deep Sleep             | Used in a real asleep-and-away stay, 2026-11-08 (owner-reported, no values shown) | Yes                      |
| `1`  | Parked                 | No                                                                                | Yes                      |
| `2`  | Unlocked               | Yes, 1 dump                                                                       | No                       |
| `3`  | System Active          | No                                                                                | No                       |
| `4`  | Ready to Go            | No                                                                                | No                       |
| `13` | Active                 | Yes, 2 dumps                                                                      | No                       |

- **Code list in the app:** `USAGE_MODE_OPTIONS` in `services/api/app/schemas.py` holds only `0` and `1`. That is the owner's geofence decision of 2026-11-08 (`api-contracts.md`, geofence amendment). It does not mean the other four codes are wrong.
- **Format:** the app reads the value as a short whole number given as text, such as `"0"` or `"13"`. Anything else is no reading (`_code` in `app/adapters/zeekr_live.py`).
- **Sources:** the labels are from `ZeekrVehicleStatusSensor` (`_STATUS_MAP`, line 704) in `custom_components/zeekr_ev/sensor.py` of `Fryyyyy/zeekr_homeassistant` (MIT licence). Nothing of the owner's was sent to it. Which codes were seen on the owner's car is from `docs/product/sentry-control-and-geofence-proposal.md` and `docs/operations/deploy-plan.md`.

## Engine Status: `basicVehicleStatus.engineStatus` (owner approved 2026-11-21)

| Normalised value | Label (public project) | Seen on the owner's car |
| ---------------- | ---------------------- | ----------------------- |
| `engine-off`     | Parked                 | No                      |
| `engine-running` | Driving                | No                      |
| `ready`          | Ready                  | No                      |
| `charging`       | Charging               | No                      |

- **Spelling:** the public project expects hyphens, while evcc traces from another Geely-group car show underscores (`engine_off`, `engine_running`). The app trims the value, lowercases it and turns `_` into `-` before the lookup. Which form the owner's car sends has not been seen.
- **Anything else** (empty, not text, or an unlisted value) is no reading.
- **Code:** `map_engine_status` and `ENGINE_STATUS_LABELS` in `services/api/app/adapters/zeekr_live.py`. Nothing calls it yet. See the ADR-009 amendment of 2026-11-21.
- **Sources:** `ZeekrEngineStatusSensor` (`_STATUS_MAP`, line 747) in the same `sensor.py`, and evcc traces for the underscore spelling.

## Gear: `additionalVehicleStatus.drivingBehaviourStatus.gearAutoStatus`

| Code | Gear        | Times read (as of 2026-11-05) | Accepted by the geofence |
| ---- | ----------- | ----------------------------- | ------------------------ |
| `0`  | Park (P)    | 4                             | Yes, it is required      |
| `1`  | Reverse (R) | 1                             | No                       |
| `2`  | Neutral (N) | 1                             | No                       |
| `3`  | Drive (D)   | 2                             | No                       |

- **Labels:** these are the owner's own, stated for each reading. They are the only source, because no outside project labels this key (searched 2026-11-05, `docs/product/sentry-control-and-geofence-proposal.md`). They are the owner's readings, not confirmed by Zeekr.
- **Geofence:** gear must be `0` (P). It is fixed in code and is not a setting (`GEAR_PARK` in `services/api/app/services/geofence.py`; `api-contracts.md`, geofence amendment).
- **Format:** the app reads it as a short whole number given as text. Anything else is no reading (`_code` in `app/adapters/zeekr_live.py`).

## Central locking: `additionalVehicleStatus.drivingSafetyStatus.centralLockingStatus`

| Code          | Meaning    | Status                                     |
| ------------- | ---------- | ------------------------------------------ |
| `"1"`         | Locked     | `confirmed` on the owner's car, 2026-11-15 |
| `"0"`         | Unlocked   | `confirmed` on the owner's car, 2026-11-15 |
| Anything else | No reading | Not seen                                   |

- **Source:** the owner-run `--dump --include-lock-door` piped to `grep`, with only the lock line shared (ADR-009, amendment of 2026-11-15). The public Home Assistant integration's `lock.py` uses the same two codes. That is a second source and not proof.
- **Where it is used:** the Vehicle card only, as `locked`, `unlocked` or `null`. The value is kept in memory with the last good read, and a failed read clears it. It is never stored, logged or sent to the model. Code: `map_central_lock` and `CENTRAL_LOCK_PATH` in `app/adapters/zeekr_live.py`.
- **Not approved:** sending it in a notification. That needs its own ADR-009 amendment.
- **Excluded:** the door, trunk and window lock fields are not approved and are not listed here.

## "Parked" means two things

| Field                          | "Parked" means         |
| ------------------------------ | ---------------------- |
| Vehicle Status (`usageMode`)   | Code `1`               |
| Engine Status (`engineStatus`) | The value `engine-off` |

They are two separate fields. Always name the field beside the label on any screen or message.

Third-party line numbers are from the public project's code at the time of writing and may move.
