# ADR-009: Live Zeekr telemetry provider (read-only)

- Status: **Accepted by the owner on 2026-10-30 as the design (gate 1 only), with the Zeekr Malaysia enquiry still unsent.** Nothing in this ADR is built, installed or run. No dependency is added, no Zeekr login is made, no key is extracted. Acceptance does not approve gates 2 to 7: each still needs the owner's explicit approval when the time comes.
- Date: 2026-10-30
- Related: ADR-008 (decisions 1, 3 and 4), `docs/research/vehicle-integrations.md` (R1, M29, M30, M42), `docs/operations/zeekr-malaysia-enquiry.md`, AGENTS.md principles 5 to 8 and the approval gates.

## Context

The owner wants the app to read vehicle data through the Zeekr API (`zeekrlife.com` gateways) instead of typing it in. ADR-008 decision 3 left the live provider for a separate ADR after the account, terms and warranty questions are answered.

What is known (research M42, read from source on 2026-10-29, nothing run):

- No official or documented data interface for Malaysian owners has been found (R1, M29). This is absence of evidence, not proof that none exists.
- The only route found is the unofficial `zeekr_ev_api` client (MIT licence, single maintainer). It presents itself as the Zeekr Android app. It needs the owner's Zeekr username and password plus six values extracted from the phone app: an HMAC access key, an HMAC secret key, a password public key, a production signing secret (`prod_secret`), a VIN key and an IV (corrected 2026-10-30; this ADR first said five). Extracting them is left to the user.
- Its read calls cover the vehicle list, latest status, VTM status, charging status, remote-control state, charge limit, charge plan, travel plan, trip history and GPS trackpoints. The status calls return raw JSON, so field names are **unverified**.
- Its write calls (`do_remote_control`, `set_charge_plan`, `set_travel_plan`) are not restricted by the library.
- Each call logs the phone app out unless a second account has the car shared to it. `export_session()` returns the password in plain text. It defaults to the SEA region and country `AU`; whether a Malaysian account resolves correctly is **unknown**.
- Upstream is undocumented and can break without notice.

Unanswered, and not answerable from this repo: whether Zeekr's terms forbid this access, whether it can suspend the account, and whether it affects the vehicle or battery warranty. The enquiry to Zeekr Malaysia is drafted but **the owner has decided not to send it for now**, so these stay open.

## Proposal

If the owner decides to go ahead, knowingly accepting the open risks above, the provider is built like this.

1. **It sits behind the existing port.** `VehicleTelemetryProvider` in `app/adapters/telemetry.py` has one method today, `read_odometer`. A live provider adds more `read_*` methods that return a `Reading` with `source` and `observed_at`. The existing test that fails when a non-`read_*` method is added stays.
2. **The library is never exposed.** A wrapper holds the client and calls only a short allow-list of `get_*` methods. It has no attribute that reaches `do_remote_control`, `set_charge_plan`, `set_travel_plan` or `export_session`. A test fails if the wrapper exposes any of them, and another proves a write method on the client is never called.
3. **A second Zeekr account.** The car is shared to a second account and the app logs in as that account only. The owner's main account and phone app are never used by the app (owner answer 2026-10-30). Whether the share gives the second account the read calls needed is **unverified**.
4. **Credentials live only on the host.** The account login and the six extracted values go only in the host `infra/.env`, as secrets. They are never in the repo, logs, Sentry events, model prompts, or chat. Nobody but the owner extracts the values or logs in. An agent does not do either.
5. **Off by default.** A setting switches the provider on. With it off, or when Zeekr is unreachable, every feature works from manual records as today (ADR-008 decision 2).
6. **Minimum data kept.**
   - GPS coordinates are dropped on arrival and never stored, logged or sent anywhere.
   - Trip history is reduced to odometer, distance and energy.
   - Raw responses are not stored. The first readings are mapped field by field after the owner has seen the real field names.
   - Nothing from the live provider reaches the model except the derived values already approved in ADR-008.
7. **Gentle on the upstream API.** Polling is infrequent and fixed (the interval is set at build time and proposed at no more than a few times an hour), with back-off after any error and a stop after repeated failures. One broken login attempt must not retry in a loop, since repeated failures could lock the account.
8. **Failures are visible, not silent.** The app shows "live data unavailable" and the age of the last reading. A stale reading is never shown as current.
9. **Pinned and audited.** If approved, the client is pinned exactly, covered by `pip-audit` and the licence check, and read again at the pinned version before use. It is a single-maintainer package that impersonates an app, so it gets a dependency review of its own.
10. **Scrubbing.** Sentry events already drop messages and request data. A test with fake credentials proves they cannot reach an event or a log line from this provider.

## Risks the owner accepts by approving this

- Zeekr may treat the access as a terms breach and suspend the second account, or the main one if linked.
- It might affect the warranty. This is unknown.
- It can stop working at any time.
- A second account and shared access add one more place where the car's data lives.
- The extracted keys are credentials for impersonating the app. If they leak, someone else could do the same.
- The library can send commands. The wrapper blocks them in this code, but the library underneath still can.

## Gates (each needs the owner's explicit approval)

1. Accept or reject this ADR, knowing the enquiry is unsent. **Done: accepted 2026-10-30.** The owner was pointed to the "Risks the owner accepts" section before answering.
2. Add the client as a dependency (new external dependency). **Done: approved by the owner 2026-10-30.** `zeekr-ev-api==0.1.15` is pinned in `services/api/pyproject.toml` and installed from a wheel into the local venv only (`pycryptodome` 3.24.1 came with it; `requests` was already present). Nothing imports it, nothing was run from it and no login was made. `pip-audit` reports no known vulnerabilities, and `ruff` and `mypy` pass. The wheel's own SHA-256 was not compared (the earlier check was of the sdist), its licence field is empty (the sdist's `LICENSE` file is MIT), and the full backend tests were not re-run because no code uses the package. It is **not deployed**: the host image has not been rebuilt.
3. Create the second Zeekr account and share the car to it. **Done: reported by the owner 2026-10-30; not checked by an agent.** Still unverified: whether the share gives the second account the read calls needed, and whether it shows the car in the vehicle list (see the issue #2 report above).
4. Extract the six values from the phone app. The owner does this. The method is not described here, because the README leaves it to the user and nothing has been checked.
5. Put credentials in the host `.env`.
6. Make the first live login. The owner runs it, with the output reviewed for field names before any mapping is written.
7. Deploy.

## Gate 2 review: `zeekr-ev-api` 0.1.15 (read by the agent on 2026-10-30; nothing installed, run or logged in)

Source: the PyPI sdist for 0.1.15 (uploaded 2026-09-01), downloaded to a scratch folder outside the repo. Its SHA-256 (`87be36a9...2311`) equals the digest PyPI lists. The repo was not changed by the download.

- **Size and shape.** 1,618 lines of Python in 7 files (`client.py` 957, `zeekr_app_sig.py` 249, `network.py` 167, `zeekr_hmac.py` 121, `const.py` 110). Small enough to read in full before pinning. What was actually read: `const.py` in full; `client.py` as a method list plus the constructor, `export_session`, `do_remote_control` and the region lookup; `network.py` only through a search of its log calls. The login flow, the signing and HMAC modules and the rest of `client.py` were **not** read, so the findings below are a partial review, not a full audit.
- **Dependencies.** `pycryptodome` (3.23.0 or newer, below 4) and `requests` (2.32.5 or newer, below 3). No other packages. PyPI lists no known vulnerabilities for the package (this does not prove it is safe). `pip-audit` and the licence check have not been run on it, because it is not a dependency yet.
- **Licence.** MIT (`LICENSE` read; the PyPI licence field is empty).
- **Hosts it contacts.** Only `zeekrlife.com` gateways (SEA) and `zeekr.eu` (EU), plus region login servers on `zeekrlife.com`. A search found no other URLs, and none of `eval`, `exec`, `subprocess`, `os.system`, `pickle`, `socket` or analytics code.
- **Read methods (names as defined):** `get_vehicle_list`, `get_status`, `get_vtm_status`, `get_charging_status`, `get_remote_control_state`, `get_charging_limit`, `get_charge_plan`, `get_travel_plan`, `get_journey_log`, `get_trip_trackpoints`. Longer `get_vehicle_*` names also exist; whether they are aliases was not checked.
- **Write methods:** `do_remote_control` (any command, service id and setting the caller supplies; service id `RCS` goes to the charge-control endpoint), `set_charge_plan`, `set_travel_plan`. This matches the earlier research (M42). The wrapper in decision 2 must not expose them.
- **Other sensitive methods:** `export_session` returns the username, the plain-text password and the tokens. `load_session` takes the same.
- **Region.** It defaults to country `AU` and the SEA hosts. It looks the country up in an EU region list and uses EU hosts if found. How a Malaysian account resolves was not traced and stays **unknown**.
- **Impersonation.** It sends hard-coded app identifiers: a client id, app version `1.4.1`, an Android user agent and an emulator device name (`const.py`). Open issue #45 (opened by the maintainer on 2026-09-23, "Update DEFAULT/LOGGED_IN headers") suggests these go stale. Only the issue titles were read, not the bodies.
- **Logging.** At debug level it logs full request URLs, headers, signed request bodies and response text; at error level it logs the start of a response body. These can hold the login body and, for trip calls, GPS. The wrapper must pass its own logger and keep it at warning or above, and a test must prove no credential or response text reaches a log line.
- **Retries and timeouts.** Default timeout is 10 seconds to connect and 30 to read. It retries connection errors and 429/5xx responses twice with back-off, and only retries a bad status on GET/HEAD, so a command POST is not re-sent. Our own back-off (decision 7) still applies on top.
- **Open issues (titles only):** #44 "Charging action intermittently stops responding until phone app usage"; #40 send destination; #37 charging status; #2 whether the China region can be used. None names Malaysia.
- **Maintainer risk.** One maintainer, 15 releases since December 2025, so the upstream API changes often and a pinned version may stop working without notice.

### Second pass (2026-10-30): login flow, request signing and issue bodies

Read this pass: `login` and its helpers in `client.py` (lines 189 to 420), all of `network.py`, all of `zeekr_hmac.py`, and the bodies and comments of issues #45, #44, #37 and #2. **Not read:** `zeekr_app_sig.py` (only searched for imports and network calls), the read methods' parsing code (`get_status` and the others), and the region lookup in full. This is still not a full audit.

- **Login is a chain of about eight requests**, all to `zeekrlife.com` hosts: region URL lookup, user check, password login, user info, protocol, inbox, TSP code, language, then a bearer login. Each login therefore touches the account many times, which supports the single-attempt rule in Proposal 7.
- **The account name is sent as an `email` field.** The second account must be an email-based Zeekr account. A Malaysian account that logs in by phone number is untested.
- **The password is RSA-encrypted with the extracted public key before sending.** It is held in plain text on the client object.
- **Failures put server responses into exception text**, for example `Login failed: {login_data}` and `Bearer login failed: {block}`. The password is not in these, but tokens may be in a success-shaped response. Our wrapper must catch every exception from the client and re-raise a fixed message with no response text.
- **Automatic re-login.** When a token expires, `network.py` logs in again by itself under a lock. Whether it repeats on repeated failure was not traced. Our own back-off and stop-after-failures rule must wrap every call, not just the first login.
- **Fixed device identity.** The bearer login sends an Android emulator device id and model. To Zeekr this looks like an emulator, not a phone.
- **Signing.** Requests are signed with HMAC-SHA256 using the two extracted keys. `zeekr_hmac.py` only signs and does no network calls.
- **Issue #45** is the maintainer noting the hard-coded headers need a new capture from the app, so they may be stale now.
- **Issue #44:** a user reports that the vehicle enters "deep sleep" and does not answer commands until the phone app wakes it. That was about a command, not a read, but a sleeping car may return old or empty status. For us this is a reason to show the age of every reading (Proposal 8), and it is not yet tested.
- **Issue #37:** the charging status is a bare number that the maintainer has not mapped to meanings, and the library no longer logs it. We would have to work out the meanings from real output.
- **Issue #2 (most relevant):** a user reports that the current Zeekr app API has changed. The old vehicle list call still logs in but returns an empty list, even for the main account. The maintainer replied that he cannot test or develop against this and asked for a pull request. That user was on the iOS app stack; which region and app version is unknown. If this applies to Malaysia, the library would log in and read nothing.
- **Third-party key extractor.** A commenter links a separate project that claims to extract the values. Reviewed in the section below.

Conclusion for gate 2: nothing found in the code disqualifies it as a dependency. The risks are that it impersonates the Zeekr app, a Malaysian account is untested, and there is a credible report that the vehicle list now comes back empty on the current app. Gate 2 is **not yet approved** by the owner. Adding the dependency would not show whether any of this works for a Malaysian car, because only a login by the owner would.

## Gate 4 review: third-party key extractor (read by the agent on 2026-10-30; nothing run)

Project: `zeekr_key_extractor` (MIT), read at commit `4fff1aa3`, downloaded to a scratch folder outside the repo. Nothing was installed or run, and no APK was pulled.

**Correction.** The library needs **six** values, not five: the extractor and the library's constructor both include a production signing secret (`prod_secret`). Earlier text in this ADR and in research M42 said five.

What was read: the README in full, `frida/zeekr_runtime_keys_3x.js` in full (95 lines), and `zeekr_extract_secrets.py` in full (869 lines, read in a second pass the same day). The tests folder and the two linked third-party pages were not read.

**Result of reading the Python script in full.**
- It makes **no network calls and starts no other programs**. Its only imports are `argparse`, `json`, `os`, `re`, `struct`, `sys`, `tempfile`, `zipfile`, `pathlib`, plus `capstone` and `pyelftools`.
- It opens the two APK files you give it for reading. It unzips only `.dex` files and ARM64 `.so` files into a temporary folder that is removed afterwards, and searches them with patterns.
- It prints every value it finds to the terminal in full, and writes them in plain text to `zeekr_secrets.json` **in the same folder as the base APK**. That is the only file it writes.
- The host names it matches are Zeekr gateway names held in the app. The `SEA` region matches a Singapore-hosted gateway and `EM` matches an emerging-markets gateway. Which one a Malaysian account uses is unknown.
- It may print several `prod_secret` candidates and says to try each if the first fails. Trying them means repeated logins, which conflicts with the one-attempt rule in Proposal 7. Each candidate would need the owner's go-ahead.
- Nothing in the script touches the phone or the Zeekr servers. The risk is in the inputs (pulling the APK) and the plain-text output, not in hidden behaviour.
- This is a read by an agent, not a security audit. Dependencies `capstone` and `pyelftools` were not reviewed.

- **What it does.** A Python script reads two APK files you pull from an Android phone with `adb`, and recovers the HMAC keys, the password public key and (on older builds) the other secrets from the app's code and its native library. A Frida script reads the other three values from the running app.
- **Network and code execution.** The Python script's imports are `argparse`, `json`, `os`, `re`, `struct`, `sys`, `tempfile`, `zipfile` and `pathlib`, plus `capstone` and `pyelftools` per `requirements.txt`. The search found no network, `subprocess`, `eval` or `exec` calls. This is a search, not a read of the logic.
- **Output.** It prints the values and writes them in plain text to `zeekr_secrets.json` next to the APK. That file must never enter this repo, a backup or chat.
- **The Frida part is invasive.** It needs a rooted phone or an emulator, matching Frida versions, and the Zeekr app running and logged in. It hooks the live app. The script only prints three values to the console; I saw no network code in it.
- **Which route applies is unknown.** The README says the static route works on some app versions and not others, and that the newest EU build needs the Frida route for three values. Which app package and version a Malaysian phone has is **not known**; the README names `com.zeekr.global` for Singapore, Australia and SEA. The region flag (`SEA` or `EM`) that matches a Malaysian account is also unknown.
- **Terms and risk.** The README says reverse engineering may be restricted in the owner's jurisdiction. Decompiling the app may breach Zeekr's terms, and this is part of the open terms question.
- **The README's own example** sets the username as an email and calls `login()`, the same as the library.
- **Two more third-party links** appear (a Home Assistant walkthrough). They were not opened.

**Gate 4 run (owner, 2026-10-30, reported).** The owner ran the extractor on the Mac against `com.zeekr.global` **v1.5.5** (build 10552) from a third-party APK mirror, region flag `EM`. All six values were found. Seven `prod_secret` candidates were printed. The values are not recorded here. Not established: whether the mirror file is genuine (no known-good certificate was found to compare), whether the v1.5.5 values match the app version on the owner's iPhone, which region fits a Malaysian account, and which of the seven `prod_secret` candidates is right, if any. Only a login can show that. Each candidate tried is a login attempt and needs the owner's go-ahead (Proposal 7). The owner pasted the extractor output into the agent chat, so the values appear in that session's transcript; the README describes them as app-global constants, not account secrets. The working folder is under the owner's Desktop, which may sync to iCloud (unconfirmed).

Gate 4 is **partly done: values extracted, not yet shown to work.** If the owner chooses to run this, the safest shape is: run it on the Mac, never on the host; keep the APKs and `zeekr_secrets.json` outside the repo; and delete both after the values are in the host `.env`.

## Gate 6 helper: `app/cli/zeekr_login_check.py` (written 2026-10-30; not run)

A one-off command for the owner, not part of the running app and not wired into `docker-compose.yml` or `infra/.env.example`.

- **One attempt.** It refuses to run unless `ZEEKR_LOGIN_CHECK_CONFIRM=one-attempt` is set, makes a single `login()` with `max_retries=0`, and does not retry on failure.
- **Calls only** `login`, `get_vehicle_list` and, with `--status`, one `get_status` on the first vehicle. A test fails if the file names a write method, `export_session` or `load_session`.
- **Prints names and types only**, for example `$.soc: float`. No value, VIN or token. On failure it prints only the exception class, because the library puts server responses into exception text. The library's logger is silenced.
- **Settings are read from environment variables only**, never from a file. Proposed names (not found elsewhere in the repo, taken from the library's constructor arguments): `ZEEKR_USERNAME`, `ZEEKR_PASSWORD`, `ZEEKR_COUNTRY_CODE`, `ZEEKR_HMAC_ACCESS_KEY`, `ZEEKR_HMAC_SECRET_KEY`, `ZEEKR_PASSWORD_PUBLIC_KEY`, `ZEEKR_PROD_SECRET`, `ZEEKR_VIN_KEY`, `ZEEKR_VIN_IV`.
- **Tested with a fake client** and canary values (`tests/test_zeekr_login_check.py`, 10 tests). No Zeekr call has been made.
- **Owner decisions for the first attempt (2026-10-30):** use `prod_secret` candidate 1 (the extractor's primary), country code `MY`, and the owner accepts that a failed attempt may count against the second account. The owner runs it from the Mac, with the values read from the extractor's JSON into the shell at run time. One attempt per go-ahead; a further candidate or country code needs a new go-ahead. This is not gate 5: nothing goes in the host `.env`.
- **Attempt 1 result (owner, 2026-10-30, reported): `Login failed: AuthException`.** One attempt, `prod_secret` candidate 1, country `MY`, v1.5.5 values. The helper hides the message, so the failing stage is not known. From the library source read earlier: the region lookup raises the base `ZeekrException`, not `AuthException`, so the failure was probably after that lookup (user check, password login or bearer login), but this is an inference, not an observation. No retry was made. Next attempts need a new go-ahead, and the helper should first report the failing stage (function name only) so an attempt is not wasted.
- **Not known:** the right `ZEEKR_COUNTRY_CODE` for a Malaysian account (the library's default is `AU`), and whether the account's username is the email the login expects.

## Not decided

- Which fields the app should read first. That depends on the real field names from gate 6.
- The polling interval, and whether the data is stored or only shown live.
- New data model and screens for live readings. Each needs its own design before code, as with ADR-008.
- Whether a supported route appears. If Zeekr Malaysia ever offers one, it replaces this proposal.
