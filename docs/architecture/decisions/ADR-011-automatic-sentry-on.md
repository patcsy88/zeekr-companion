# ADR-011: Automatic Sentry on, behind a toggle (proposal)

Status: **ADR accepted by the owner on 2026-11-06 ("Approve the whole ADR"), with the quiet-period range 5 to 1440 whole minutes confirmed. The data model and the API contract (`api-contracts.md`, "automatic Sentry on") were approved by the owner on 2026-11-06 ("Yes approve"). The API build may start; each build step is approved before the next. Nothing is built or deployed yet.**

## Context

ADR-010 allows one command to the car, Sentry on or off, sent by hand, and says "no unattended or automatic command". The geofence (Pieces B and C, deployed) opens an advisory alert, `sentry_off_outside_geofence`, when the car is parked asleep outside the home area with Sentry off. The alert sends nothing.

The owner now wants the app to turn Sentry on by itself in that case, controlled by a toggle. This would be the first command the app sends without a human pressing Send, so it needs its own ADR and approval (ADR-010 "Not allowed", proposal `docs/product/sentry-control-and-geofence-proposal.md`).

## Owner choices already made (2026-11-06)

1. **Send, then show.** The app sends once by itself, then shows what it did on the Sentry tab and in a log. It does not ask first. The earlier safeguard "notify and ask first" is therefore **replaced**: the app has no push notifications (ADR-002 lists Web Push as a separate decision), so the owner sees an automatic send only when they open the app.
2. **After a manual command, wait one hour.** If a command (manual or automatic) was logged in the last 60 minutes, the automatic send is skipped, and the alert still shows.
3. **The toggle is on the Sentry tab**, next to the manual switch.

Safeguards the owner chose earlier and that stay: off by default, fresh reading only, once per episode, and every automatic send is logged.

## Decision (proposed)

- **Direction:** automatic **on** only. The app never turns Sentry off by itself.
- **Trigger:** the geofence check opens a new alert (`alert opened`), the toggle is on, the reading that caused it is fresh (inside the existing stale limit) and the car's own reading shows Sentry off.
- **Once per episode:** one automatic attempt for each alert. If it fails or the car does not report Sentry on, there is no retry in the same episode. A new episode starts after the alert closes (the car comes back inside the area, or Sentry reads on).
- **Quiet period (configurable):** no automatic send if any command was logged within the quiet period, by hand or automatic. The default is 60 minutes and the owner can change it on the Sentry tab. It is stored in the same one-row setting as the toggle (column `quiet_minutes`). The allowed range is **proposed, not yet approved**: 5 to 1440 minutes, whole numbers. This is separate from the 60-second spacing in `sentry_command.py`, which still applies.
- **Skipped sends are shown:** when the send is skipped (quiet period, toggle off after the alert opened, host switch off), the Sentry tab shows fixed wording such as "Automatic send skipped: a command was sent 20 minutes ago." Skips are logged without a car call.
- **Same code path:** the automatic send uses the existing `SentryCommandService.send("on")` and its locks, spacing and read-back. No second way to call the car is added. `zeekr_sentry_command.py` remains the only file that names the write method, and a test keeps that true.
- **Log:** each automatic attempt is a row in `car_command_log` with the source `auto`, the result and the state after. (Correction, 2026-11-06: the `source` column already exists from migration `0012` with a check that allows only `manual`; migration `0015` widens that check. It does not add the column.) No position, distance, payload or VIN is stored.
- **Show:** the Sentry tab shows the last automatic send in fixed wording, for example "Sentry was turned on automatically at 18:42 (KL). The car reports on." or "An automatic send was tried at 18:42 (KL) and the car did not report Sentry on."
- **Toggle:** a new one-row setting `auto_sentry_on`, default **off**. It is **separate** from the geofence settings row, so "Use the host values" on the Geofence tab does not touch it. The API refuses to turn it on unless the geofence and live readings are both on. A host switch `GEOFENCE_AUTO_SENTRY_ALLOWED` (default `false`, in `infra/.env`) must also be `true`; with it false the toggle is shown disabled with a fixed explanation. This keeps the final say on the host.
- **Failure behaviour:** if the live provider is stopped, the send is busy or rate-limited, or the car does not accept the command, the app logs it and shows it. It does not retry and does not turn the toggle off.

## Not allowed

- Any other automatic command, and any automatic Sentry **off**.
- Sending from the model or an advisory agent (ADR-008 stays advisory).
- Sending on a stale, incomplete or missing reading.
- A second automatic attempt in the same episode.
- Logging a position, distance, home point, payload or VIN.

## Consequences

- The "no automatic command" rule in ADR-010 is narrowed to: none except this one, behind the toggle and the host switch. ADR-010 gets a pointer to this ADR when it is accepted.
- The owner finds out about an automatic send only by opening the app, because the app has no push. The send ignores time of day, by the owner's decision (2026-11-06).
- Zeekr's terms on unattended commands are unconfirmed. The owner has acknowledged them and accepted the associated risks (2026-11-06).
- A wrong geofence verdict (for example a bad reading or a wrong home point) now causes a command, not only a notice. The geofence's own proof on a real asleep-and-away case is still **unrun**, so the first automatic send would be on an untested real case.
- **Update 2026-11-06:** the owner reported the first real automatic send (car away more than 5 km, in-app switch on, host switch `true`; one send, then the alert closed). See `docs/operations/deploy-plan.md`. The owner then accepted the feature as done (see below).
- Zeekr's terms on repeated or unattended commands are unconfirmed. Account-lock risk is unknown.
- Gear and `usageMode` labels are unverified except for the owner's readings (`0` and `0`).

## Build plan (after approval, each step owner-approved before the next)

1. **Docs and contract:** this ADR accepted, `api-contracts.md` amendment (settings endpoint, `source` field on the log), data model note. The data model and API contract need the owner's approval before code.
2. **API:** migration `0015` (the setting row, the `source` column), the automatic send, tests with a fake car. A fresh encrypted export first, as for any migration. Backend gates and `pip-audit`.
3. **Web:** the toggle, the last-automatic-send line, tests, screenshots.
4. **First trial, owner-run:** the owner turns the host switch and the toggle on for one watched real case, then reports. Until then it is **unverified**.

## Owner answers (2026-11-06)

1. **Quiet period:** "Yes - make it configurable." One hour is the default and the owner can change it. The range (5 to 1440 minutes) is the agent's proposal and still needs approval.
2. **Show skipped sends:** yes.
3. **Host switch `GEOFENCE_AUTO_SENTRY_ALLOWED`** as a second lock: yes. The name is proposed, not found in the repo.
4. **`source` column on the command log** (migration `0015`): yes.
5. **First real case waits** until the geofence alert has been proven on a real asleep-and-away stay: yes. Step 4 of the build plan is gated on that proof, so the host switch stays false until then.

## Still needed before code

- ~~The owner's written approval of this ADR as a whole.~~ Given on 2026-11-06.
- ~~The owner's approval of the data model and the API contract amendment.~~ Given on 2026-11-06. The final table is `auto_sentry_settings` (`enabled`, `quiet_minutes`), with the `source` check widened and `skipped` and `skip_reason` added to `car_command_log`, as written in `api-contracts.md`.
- ~~The quiet-period range.~~ Confirmed on 2026-11-06: 5 to 1440 whole minutes.

## Acceptance (2026-11-06)

The owner stated in chat that the feature is "good and tested" and asked for it to be marked properly done. Recorded as the owner's acceptance. What the engineering record itself shows:

- **Seen by the agent:** the code, the tests and gates on the Mac, the pasted deploy output, and the pasted host log lines of the first automatic send (`alert opened; automatic send: sent`, then `alert closed`, then `clear`).
- **Owner-reported only:** that the car was away more than 5 km, asleep or not (not stated), that the in-app switch was on, and that the result was as intended.
- **Not resolved:** the owner said they also sent Sentry on manually at 16:11 KL, yet the automatic send was not skipped by the quiet period. The command log rows were not shown, so whether the quiet-period guard failed or the order of events differed is **unknown**. Restating this does not reopen the decision; it is recorded so the gap is not lost.
- **Still open risks:** Zeekr's terms on unattended commands and account-lock risk (accepted by the owner), and the position having no timestamp of its own (the reply-level `updateTime` is the rule).
- **Owner decisions (2026-11-06):** the owner states that Sentry uses the main battery (owner statement, not verified by the agent). The app and docs make no claim about Sentry and battery use. The owner acknowledges Zeekr's terms on unattended commands and accepts the risks. The send ignores night versus day. If the reading has no readable top-level `updateTime`, nothing is sent: the geofence reads `incomplete`, no alert opens and no automatic send happens (already how it works; no code change).
- **Closed as not an issue (owner, 2026-11-06):** the earlier note about a 16:11 manual send and a 16:12 automatic `sent` against the 60-minute quiet period. It supersedes the "Not resolved" bullet above.
