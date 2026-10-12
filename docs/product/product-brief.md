# Product Brief: Zeekr Companion

Status legend: **confirmed** (owner decision), **proposed** (recommended, awaiting approval), **unverified** (depends on facts not yet established).

## Objective (confirmed)

A personal mobile application for managing a Zeekr 7X AWD, right-hand-drive, for a single owner. iOS first, with a path to Android.

## Principle (confirmed)

Managing information about the car is not the same as controlling it. The app must be fully useful with no live vehicle connection.

## Confirmed decisions

| Area | Decision |
|---|---|
| Platform | iOS first, Android later |
| Hosting | Self-hosted on homelab/Unraid |
| Vehicle data | Manual records first. Official integrations researched in parallel |
| First release focus | Maintenance, expenses and ownership records |

## Capability areas

| Area | Status | Release |
|---|---|---|
| Vehicle profile | confirmed | MVP |
| Maintenance and service history | confirmed | MVP |
| Expenses, warranty, reminders (tyres, insurance, road tax) | confirmed | MVP |
| Aftermarket equipment register (including Audison audio) | proposed | Release 2 |
| Charging log and cost tracking | proposed | Release 3 |
| Vehicle integrations (official, verified only) | unverified | Release 3+ |
| AI assistant grounded in manuals and records | proposed | Release 4 |
| Live status and remote functions | unverified | Not planned |

## MVP scope (proposed)

1. Vehicle profile
2. Service records and mileage
3. Expenses
4. Warranty details and claims
5. Reminders for service, insurance and road tax
6. Tyre records

## Out of scope for the MVP

Charging logs, equipment register, any Zeekr integration, AI features, remote vehicle control, multi-user sharing and Android release.

## Non-goals

- Reverse-engineered or unofficial vehicle APIs.
- Storing vehicle account credentials.
- Any vehicle-control capability without explicit owner approval.

## Success criteria for the MVP (proposed)

- The owner can record a service, an expense and a reminder from the phone in under a minute each.
- Data persists across app restarts and survives temporary loss of server connectivity.
- Reminders appear before their due date.
- Server data can be backed up and restored.

## Assumptions

| # | Assumption | Status |
|---|---|---|
| A1 | Single user, single vehicle | proposed |
| A2 | Currency is MYR (market is Malaysia) | confirmed 2026-10-11 |
| A3 | Distance unit is kilometres | confirmed (2026-10-11) |
| A4 | Owner has a means of reaching the home server remotely | unverified |
| A5 | Running on a personal iPhone needs a development build or TestFlight, which needs an Apple Developer account | unverified, owner approval needed |
