# Vehicle Integrations Research

Status: **Malaysia research updated on 2026-10-22 (desk research only, no logins).** The owner's market is Malaysia (RHD Zeekr 7X AWD Performance, kilometres and MYR, both confirmed by the owner on 2026-10-11 per AGENTS.md). An earlier pass assumed the UK. Its non-Malaysian findings are kept below and labelled "No (not Malaysia)".

Malaysia has an official Zeekr Malaysia website with warranty and service PDFs. Firecrawl parsed both official PDFs on 2026-10-22. The figures below now come from the PDF contents, rather than search-result excerpts. A Malaysian owner's manual was still not found.

Every entry records a source, the date checked, a status (`verified`, `assumption` or `unverified`) and whether it applies to Malaysia.

## Rules

- Prefer official, documented interfaces.
- Reverse-engineered or unofficial mechanisms are recorded for awareness only, with their account, warranty and security risk. They are not recommended.
- Nothing here is a dependency of the MVP.
- Anything requiring login to the owner's account needs owner approval.
- Third-party and press sources are labelled as such and carry lower confidence.

## Questions to answer

| # | Question | Status |
|---|---|---|
| R1 | Does Zeekr offer a documented public API for owners in Malaysia? | **None found.** No official public or developer API appears on the Zeekr Malaysia site or in any official source searched. An unofficial reverse-engineered client exists (awareness only, M23). |
| R2 | What does the official Zeekr app expose to Malaysian owners? | **Partially answered.** The global "ZEEKR" app store listing (also used for Malaysia, with a Malaysia "Discover" page) lists remote lock/unlock, vehicle status, tyre pressure, trunk, climate, location, geo-fencing, journey log, charging status, start/stop and scheduled charging. The exact Malaysian feature set and which parts need the paid connected service are not confirmed. Digital Key on the 7X is unconfirmed for Malaysia. |
| R3 | Official warranty terms and service intervals for the 7X in Malaysia? | **Answered.** The official Malaysia PDFs specify the warranty terms and an every 20,000 km or one-year service schedule, whichever occurs first. The owner’s AWD Performance schedule and costs are recorded below. |
| R4 | Where are the manual and warranty/service booklet for Malaysia, and can they be imported? | **Partially answered.** The official Malaysia Services page links readable Warranty and Service Maintenance Schedule and Pricing PDFs. A Malaysian owner's manual was not found. The PDFs can be parsed outside the repository; licence terms still need checking before storing source copies in the product. |
| R5 | Can charging data be exported from any official source or home charger vendor? | **None found.** Home wallbox is supplied through Zeekr Malaysia (22 kW AC). The wallbox make is not named in any source I found. Public charging apps used with Zeekr in Malaysia are named below. No official export from the Zeekr app or these apps was verified. |
| R6 | 7X AWD tyre size and pressures for Malaysia? | **Partially answered.** Michelin Malaysia lists 265/45 R20 as one of the 7X fitments and the official brochure confirms 20-inch wheels for AWD Performance; no official pressure was found. The door-jamb placard is the authority. |

## Findings: Malaysia

All entries checked 2026-10-11.

### Distributor, website, channels, app

| # | Claim | Source | Status | Confidence | Applies to Malaysia |
|---|---|---|---|---|---|
| M1 | Zeekr established its own national sales company, **Zeekr Intelligent Technology (Malaysia) Sdn Bhd**, in June 2025. It runs wholesale, dealer network, marketing and after-sales and is the official distributor. Press reports it before then ran through an importer. | https://paultan.org/2025/06/30/zeekr-intelligent-technology-malaysia-established-principal-takes-over-as-ev-brands-official-distributor/ ; https://www.carz.com.my/webview/2025/06/zeekr-group-establishes-national-sales-company-in-malaysia (press); the official site's General Manager quote in https://www.zeekrlife.com/en-my/posts/zeekr-malaysia-partners-with-jomcharge-to-bring-more-charging-convenience-and-benefits-to-zeekr-owners/ names "Zeekr Intelligent Technology Malaysia" | verified (company name on the official release, details from press) | High | **Yes** |
| M2 | Official Malaysian site: https://www.zeekrlife.com/en-my/ (English). Pages: models, services, news, test drive, find us, contact us. | https://www.zeekrlife.com/en-my/ | verified | High | **Yes** |
| M3 | Official customer care: hotline 1300-88-6868, WhatsApp +6010-849 3119, email customersupport@service.zeekr.my, Monday to Friday 8:30 AM to 5:30 PM excluding public holidays. The same hotline is given for Zeekr Roadside Assistance. | https://www.zeekrlife.com/en-my/service/ | verified | High | **Yes** |
| M4 | Official social channels listed on the site: Facebook (zeekrmalaysia), Instagram (@zeekrmy), TikTok (@zeekrmalaysia), LinkedIn (zeekr-cars-malaysia), YouTube (@zeekrmalaysia). | https://www.zeekrlife.com/en-my/ footer | verified | High | **Yes** |
| M5 | Zeekr dealers/partners named in 2025 to 2026 press: Sentinel Automotive, Preeminent Auto, Carro (authorised dealer since June 2025; Carro opened a Zeekr service centre in Bandar Sri Damansara in August 2026), and EON (Klang Valley partnership, September 2026). First East Malaysia retail presence is in Kuching (29 September 2026). | paultan.org 2025-06-30 (above); https://paultan.org/2026/08/12/carro-opens-its-first-zeekr-service-centre-in-bandar-sri-damansara-end-to-end-aftersales-support-with-bp/ ; headlines on https://www.zeekrlife.com/en-my/ | unverified (press, headlines) | Medium | **Yes** |
| M6 | The Zeekr app is the global "ZEEKR" app. Google Play: `com.zeekr.global` (listing updated 5 Aug 2026, 10K+ downloads, 2.2 stars). App Store: "ZEEKR App" id6504061076 (developer Hangzhou ZEEKR Automobile Sales and Services Co., Ltd.). The App Store release notes for version 1.5.3 say "Discover page now live in Malaysia". The listing I saw was the Mexico App Store page, so whether the Malaysian store lists it is **not directly confirmed**. | https://play.google.com/store/apps/details?hl=en_AU&id=com.zeekr.global ; https://apps.apple.com/mx/app/zeekr/id6504061076?l=en-GB | verified (store text), Malaysian availability unverified | Medium | Likely (Malaysia is named in release notes) |
| M7 | The earlier EU listings (`com.zeekr.overseas`, App Store id6448229216) are for the European app (see E7). Do not assume Malaysian owners use them. | https://www.zeekr.eu/en-se/connected | unverified for Malaysia | Low | Unknown |

### R3: Warranty, service and packages

| # | Claim | Source | Status | Confidence | Applies to Malaysia |
|---|---|---|---|---|---|
| M8 | New vehicle warranty: **5 years / 150,000 km**. Paint and surface-corrosion warranty: **5 years / 150,000 km**. Coverage starts on first registration or entry into service, whichever is earlier. | https://assets.zeekrlife.com/assets/my/Warranty.pdf (linked from https://www.zeekrlife.com/en-my/service/; parsed 2026-10-22) | verified | High | **Yes** |
| M9 | Electric powertrain warranty: **8 years / 160,000 km**; it covers the high-voltage battery, electric drive system and high-/low-voltage charging-system assemblies. A battery state-of-health threshold is not stated in the PDF. | https://assets.zeekrlife.com/assets/my/Warranty.pdf (parsed 2026-10-22) | verified | High | **Yes** |
| M10 | Wear-and-tear cover: **6 months / 10,000 km** for cabin filter, brake pads, bulbs, wipers and tyres; **12 months / 20,000 km** for the 12 V battery, remote-key battery, fuses and non-integrated relays. Genuine replacement parts: up to **2 years / 20,000 km**, varying by part type. | https://assets.zeekrlife.com/assets/my/Warranty.pdf (parsed 2026-10-22) | verified | High | **Yes** |
| M11 | Warranty period for commercial use differs (global PDF: 12 months / 100,000 km). Not read for Malaysia. | global PDF snippet (above) | unverified | Low | Unknown |
| M12 | AWD Performance service checkpoints are **20,000 km / 1 year, then each 20,000 km / year through 160,000 km / year 8**, whichever occurs first. The official schedule shows maintenance inspection, cabin-air-filter replacement, brake-fluid replacement and front-and-rear reducer-lubricant replacement at every even-year / 40,000-km checkpoint; coolant replacement at 80,000 km / year 4 and 160,000 km / year 8. | https://assets.zeekrlife.com/assets/my/Service_Maintenance_Schedule_And_Pricing.pdf (parsed 2026-10-22) | verified | High | **Yes** |
| M13 | An earlier global manual PDF (May 2025) said 20,000 km or 12 months for all models. It was replaced by the Nov 2025 version, which separates the 7X. Whirlpool forum users (Australia) saw a similar change to 12 months / 20,000 km locally. Treat any other interval as a market difference. | https://www.datocms-assets.com/145936/1746431206-new-zeekr-owners-warranty-and-servicing-manual.pdf ; https://forums.whirlpool.net.au/thread/3rvj6xr7?p=78 (forum) | unverified | Low | No (Australia forum), unclear for the global PDF |
| M14 | Prepaid or bundled service: paultan's advertorial (7 Oct 2026, for the ACE expo 31 Oct to 1 Nov 2026) says current 7X offers include a complimentary AC wallbox and a **two-year / 40,000 km free maintenance and service package**. This is a promotion, not a standing term. The Malaysian price list for paid service packages is in the unreadable PDF. | https://paultan.org/2026/10/07/ace-2026-get-the-zeekr-7x-from-only-rm193800-and-enjoy-a-free-wallbox-and-2-years-free-service/ (advertorial) | unverified (promotion, press) | Low to medium | **Yes**, but depends on the owner's purchase date and deal |
| M15 | Extended Warranty Programme: Silver = vehicle and high-voltage components to 8 years / 160,000 km; Gold = 8 years / 180,000 km. Prices reported by Carz: 7X Silver RM5,999, Gold RM12,888. Available to new owners within 7 days of delivery, and to existing owners until 30 September 2026 (now ended). | https://www.zeekrlife.com/en-my/posts/zeekr-malaysia-celebrates-5000-deliveries-with-enhanced-ownership-privileges (official, plans and dates) ; https://www.carz.com.my/2026/08/is-zeekrs-8-year-warranty-worth-it-5-game-changing-perks-every-buyer-needs-to-see (prices, press) | plans verified (official), prices unverified (press) | Medium | **Yes** |
| M16 | Roadside assistance: 24/7 on 1300-88-6868 during the general warranty period. Product-failure support and towing to the nearest authorised service centre. Towing is free if the cause is a manufacturing defect and chargeable if due to misuse or user error such as battery depletion. | https://www.zeekrlife.com/en-my/service/ | verified | High | **Yes** |
| M17 | Standard inclusions at launch: 5 years / 150,000 km vehicle, 8 years / 160,000 km battery, one year of free connected service (app, navigation, OTA), and a 22 kW AC wallbox plus window tint as a launch offer. Zeekr X brochure shows 6 GB per month for 12 months of connectivity (X brochure, not 7X). Terms after the first year (price) not found. | paultan 2025-08-22 (above); https://assets.zeekrlife.com/assets/my/Zeekr_X_Brochure.pdf (snippet) | unverified (press, brochure snippet) | Medium | **Yes** |

### R4: Manual and booklet

| # | Claim | Source | Status | Confidence | Applies to Malaysia |
|---|---|---|---|---|---|
| M18 | The official Services page links two Malaysian PDFs: "Warranty" (https://assets.zeekrlife.com/assets/my/Warranty.pdf) and "Service Maintenance Schedule and Pricing" (https://assets.zeekrlife.com/assets/my/Service_Maintenance_Schedule_And_Pricing.pdf). Both were parsed on 2026-10-22. | https://www.zeekrlife.com/en-my/service/ | verified | High | **Yes** |
| M19 | A Malaysian 7X brochure exists (PM and EM versions, and https://assets.zeekrlife.com/assets/my/Zeekr_7X_Brochure.pdf). It lists price, registration fee, road tax and specification for Malaysia. It is not the owner's manual. | https://www.zeekrlife.com/en-my/models/7x/ | verified | High | **Yes** |
| M20 | **No Malaysian owner's manual was found** on the Malaysian site or in searches repeated on 2026-10-22. The in-car or app manual is the likely source. Do not copy it into the repo until licence and owner-provision questions are resolved. | Zeekr Malaysia site map and Firecrawl searches, 2026-10-11 and 2026-10-22 | unverified (absence of evidence) | Low to medium | Yes (not found) |

### R5, R2: Charging, wallbox, apps

| # | Claim | Source | Status | Confidence | Applies to Malaysia |
|---|---|---|---|---|---|
| M21 | Home charger: Zeekr Malaysia gives a 22 kW AC wallbox (and a portable charger) as part of launch or current offers. The wallbox supplier/make is **not named** in the sources I found. | paultan 2025-08-22, autobuzz.my 2025-08-22 https://autobuzz.my/2025/08/22/all-new-zeekr-7x-launched-in-malaysia-3-variants-up-to-610-km-range-from-rm180k/ ; paultan 2026-10-07 | unverified (press) | Medium for existence, none for vendor | **Yes** |
| M22 | **Zeekr Power** is Zeekr Malaysia's ultra-fast charging network, co-branded with DC Handal. Owners get RM1.20/kWh at DC Handal chargers via the **chargEV** app (register, then submit an onboarding form with the same email). Valid 1 Aug 2026 to 31 Jul 2028. A separate chargEV "Zeekr Charging Plan" gives 100% off at chargEV and DC Handal chargers up to a cap (RM1,500 for the base plan), valid one year, subject to Zeekr (Preeminent Auto) dealer eligibility. | https://help.chargev.my/hc/en-us/articles/60805610581785-Zeekr-DC-Handal-Preferred-Rate-Zeekr-Power-Plan ; https://help.chargev.my/hc/en-us/articles/52152956600857-Zeekr-Charging-Plan | verified (operator help pages) | Medium to high | **Yes** |
| M23 | **JomCharge**: Zeekr owners can claim a complimentary JomCharge Platinum membership until 31 December 2026 (25% off at 1,000+ JomCharge-owned points). Registration by form, matching email. | https://www.zeekrlife.com/en-my/posts/zeekr-malaysia-partners-with-jomcharge-to-bring-more-charging-convenience-and-benefits-to-zeekr-owners/ (official, 2026-08-20) | verified | High | **Yes** |
| M24 | Other public charging apps seen in Malaysia: **Gentari** (Petronas, https://www.gentari.com/go/charging-network/malaysia) and **ChargeSini**, which added Gentari roaming in September 2026 (Carz, press). Whether the Zeekr owner is expected to use them is not stated by Zeekr. | https://www.carz.com.my/2026/09/one-app-more-chargers-chargesini-and-gentari-roaming-goes-live | verified (apps exist), relevance to the owner unverified | Medium | **Yes** |
| M25 | **No charging-data export** was found for the Zeekr app, chargEV, JomCharge, Gentari or ChargeSini. I did not open their apps (needs a login). Receipts or history in these apps are an owner-side check. | Searches 2026-10-11 | unverified (absence of evidence) | Low | Yes (not found) |
| M26 | The global Zeekr app listing includes Remote Charge (check charging status, start/stop charging and discharging, scheduled charging), Car Control (remote lock/unlock, vehicle status, tyre pressure, trunk, climate) and Map (location, geo-fencing, journey log, nearby charging stations on the Google Play version). Users on Google Play say it is unreliable as a key; a 19 Aug 2026 review says sharing the 7X to another person cannot set the required PIN. A January 2026 App Store review (Mexico) asked for Digital Key on the 7X. | https://play.google.com/store/apps/details?hl=en_AU&id=com.zeekr.global ; https://apps.apple.com/mx/app/zeekr/id6504061076?l=en-GB (store text and user reviews) | verified (store text); reviews unverified | Medium | Likely (same global app) |
| M27 | Malaysian press lists the 7X key options as NFC key card, Zeekr app Bluetooth key and keyless entry. Digital Key (Apple Wallet) for Malaysia is not stated. | https://www.carz.com.my/cars/zeekr/zeekr-7x | unverified (press) | Low to medium | **Yes** |
| M28 | Malaysian 7X charging specs (official site): 22 kW AC, DC up to 420 kW on the 100 kWh battery (10 to 80% in 16 minutes), V2L 3.3 kW (press). | https://www.zeekrlife.com/en-my/models/7x/ ; https://paultan.org/2025/08/15/2025-zeekr-7x-malaysian-brochure-out/ | verified (official page) | High | **Yes** |

### R1: API

| # | Claim | Source | Status | Confidence | Applies to Malaysia |
|---|---|---|---|---|---|
| M29 | No official public or developer API for owners is mentioned on the Zeekr Malaysia site, in the Malaysian press, or in any Zeekr source searched. | Searches 2026-10-11 | unverified (absence of evidence) | Low to medium | Yes (not found) |
| M30 | **Awareness only, not recommended.** An unofficial reverse-engineered client for the global Zeekr app exists (GitHub Fryyyyy/zeekr_ev_api, discussed on the Home Assistant forum). It requires secrets extracted from the app and the owner's account credentials. Risks: it may breach the app's terms, may cause account lock or warranty disputes, stores credentials, and can break at any time. The repository was not opened. | https://community.home-assistant.io/t/zeekr-connected/898959 (forum) | unverified | Low | Unknown |

### R6: Tyres

| # | Claim | Source | Status | Confidence | Applies to Malaysia |
|---|---|---|---|---|---|
| M31 | Malaysian-spec AWD Performance has 20-inch wheels (official brochure). Michelin Malaysia lists **265/45 R20 108W** as a front and rear ZEEKR 7X fitment. This supports, but does not prove, that size for the owner's exact vehicle; the door-jamb placard is the authority. | https://assets.zeekrlife.com/assets/my/Zeekr_7X_Brochure.pdf (official, parsed 2026-10-22); https://www.michelin.com.my/auto/manufacturers/zeekr/7x/7x (Michelin Malaysia, parsed 2026-10-22) | partly verified | Medium | **Yes** |
| M32 | Conflicting listings: Zigwheels Malaysia says 255/55 R20 for the AWD Performance and 245/45 R19 for the RWD Standard. These disagree with paultan and look generic. Treat as unreliable. | https://www.zigwheels.my/ms/new-cars/zeekr/7x/awd-performance ; https://www.zigwheels.my/new-cars/zeekr/7x/specifications | unverified (conflict) | Low | Yes (conflicting) |
| M33 | Michelin Malaysia’s 7X page lists 255/50 R19 107V, 265/45 R20 108W and 265/40 R21 105V as fitments. It displays no pressure values. Michelin cautions that displayed load/speed ratings can differ from the vehicle label and that a tyre professional should confirm replacement fitment. | https://www.michelin.com.my/auto/manufacturers/zeekr/7x/7x (parsed 2026-10-22) | verified (Michelin catalogue); not manufacturer-authoritative for the specific car | Medium | **Yes** |
| M34 | **No official recommended tyre pressure** for the Malaysian car was found. The only figures seen are earlier non-Malaysian ones (E13 to E15). Do not ship a default. | Searches 2026-10-11 | unverified (not found) | n/a | Yes (not found) |

### Malaysian ownership items (context only, no feature proposals)

| # | Claim | Source | Status | Confidence | Applies to Malaysia |
|---|---|---|---|---|---|
| M35 | Malaysian EV road tax exemption ended on 31 December 2025. From 1 January 2026, EV road tax (LKM) is calculated from motor power in kW. Press quotes the AWD Performance road tax at **RM1,740 a year** and the RWD variants at **RM575 to RM615 a year**. The official Malaysian 7X brochure text (OCR, garbled) shows 575 for the RWD variants and 1,740 for the AWD Performance. The amount JPJ charges at renewal is the authority. | https://paultan.org/research/compare/zeekr-7x/rwd-long-range-2026-vs-awd-performance-2026/ (press) ; https://assets.zeekrlife.com/assets/my/Zeekr_7X_Brochure.pdf (snippet); https://www.carlist.my/news/ev-road-tax-malaysia-2026-new-kw-based-structure-explained-how-much-will-you-pay-149237/149237/ (press, 2026-05-15) | unverified (press, brochure snippet) | Medium | **Yes** |
| M36 | Road tax (LKM) renewal: private vehicles can renew for 6 or 12 months. JPJ requires valid motor insurance for the period applied for. Renewal is allowed within two months before expiry. | https://www.jpj.gov.my/en/motor-vehicle-license-renewal-guide-lkm/ (official JPJ guide) | verified (official JPJ) | High | **Yes** |
| M37 | Renewal channels and digital road tax: MyJPJ app (login via MyDigital ID since 1 May 2026 per press), MySikap, MyEG, Pos Malaysia, JPJ offices. Since 1 February 2026 JPJ no longer issues printed road tax slips for private vehicles and none is required on the windscreen (press). | https://covermi.com.my/blog/quick-and-easy-how-to-renew-your-road-tax-directly-via-myjpj-app (insurance broker blog, 2026-07-07) ; https://www.motorist.my/article/5421/new-2026-ev-road-tax-structure | unverified (third-party) | Low to medium | **Yes** |
| M38 | Motor insurance in Malaysia does not auto-renew, and must be active before road tax is renewed. A renewal notice usually arrives about 30 to 45 days before expiry (third-party guide). | https://hlteoh37.github.io/sorted-my/guides/renewing-road-tax/ (third-party guide) | unverified | Low | **Yes** |
| M39 | Press quotes typical insurance for the 7X at about RM5,001 a year. A general estimate, not the owner's premium. | https://paultan.org/research/zeekr/7x (press) | unverified | Low | Yes (estimate) |
| M40 | Not found: PUSPAKOM inspection rules for a new EV at this age (only a general note that a B2 inspection is needed after more than 12 months of expired road tax, from a third-party guide). Not relevant for a new car. | M38 source | unverified | Low | Yes (context) |
| M41 | The Malaysian 7X is imported complete (CBU) from China. Registered units in Malaysia are tracked from JPJ data on paultan (3,959 since Aug 2025 to Aug 2026). Not needed for the build. | https://paultan.org/car-sales-data/zeekr/7x/ | unverified (press, from JPJ open data) | Medium | Yes (context) |

## Findings: from the owner's own documents (2026-10-11)

Source: documents supplied by the owner, held outside the repo. Personal identifiers (name, address, phone, VIN, plate, contract number) are deliberately not recorded here. Pages were read as images, so the figures are as printed on the documents.

| # | Claim | Source document | Status | Applies to Malaysia |
|---|---|---|---|---|
| O1 | Vehicle is a Zeekr 7X AWD Performance, electric, registered as a new imported vehicle, body type sport utility vehicle, year 2025. | JPJ vehicle ownership certificate | verified | **Yes** |
| O2 | First registration date is 27 November 2025. The warranty invoice date is the same day. This is the working warranty start date (M8 says warranty runs from first registration or entry into service). | JPJ ownership certificate; extended warranty certificate | verified | **Yes** |
| O3 | Original warranty is 5 years or 150,000 km, whichever comes first. This upgrades M8 for the vehicle warranty from search-text to a document the owner holds. | Extended warranty certificate | verified | **Yes** |
| O4 | The owner bought an Extended Warranty, "ZEEKR 7X Whole Vehicle (excl. 3E system), Silver Plan", priced RM5,999, signed 15 September 2026. It extends cover to 8 years or 160,000 km, whichever comes first. The extension period runs from 27 November 2030 to 26 November 2033, and the mileage limit rises from 150,000 km to 160,000 km. Provider is a third-party warranty services company named on the certificate. | Extended warranty certificate | verified | **Yes** |
| O5 | Extended warranty terms: private non-commercial use only; wear-and-tear parts are excluded (tyres, glass, brake pads, wipers, filters, 12V battery, bulbs, fuses, relays and others); repairs only at authorised Zeekr service centres in Malaysia; keep complete maintenance records; failure to follow the maintenance schedule or to use authorised outlets can void cover for related faults. | Extended warranty agreement, sections 1 to 4, 8, 9 | verified | **Yes** |
| O6 | The extended warranty is tied to the VIN and is transferable to later private owners if the current owner notifies an authorised service centre in writing with the new owner's details and the transfer date. Cancellation is refunded only within 7 days. | Extended warranty agreement, section 6 | verified | **Yes** |
| O7 | Towing: free to an authorised centre inside Malaysia; any portion above RM400 is paid by the owner. | Extended warranty agreement, section 8; leaflet Q&A | verified | **Yes** |
| O8 | Three versions of an extended warranty leaflet were supplied. Only the first page of V3 was read (a Q&A on transfer, free repairs and towing). V1 and V2 were not read. | Leaflets V1 to V3 | partly read | Yes |

Implications for the MVP (record only):
- The warranty start date, end date and kilometre limits are owner-entered from these documents. The app should hold two layers: the original 5 years / 150,000 km and the extension to 8 years / 160,000 km.
- The agreement says maintenance records must be kept and servicing done at authorised outlets, which supports FR-2 to FR-4 and the warranty record in FR-6.
- Not found in any supplied document: the service schedule and interval, the tyre placard, the tyre pressures, and the high-voltage battery terms. R3 service interval and R6 remain unverified.

## Findings: not Malaysia (kept from the earlier pass)

All were checked on 2026-10-11. None of these is a Malaysian source.

| # | Claim | Source | Status | Confidence | Applies to Malaysia |
|---|---|---|---|---|---|
| E1 | Sweden: new vehicle warranty 5 years or 100,000 km (mileage limit applies from month 25). Extension of up to 10 years or 200,000 km in 24 month / 40,000 km steps if serviced at Zeekr or Zeekr-authorised workshops. | Zeekr EU, Warranty Terms and Conditions v1.0, Sweden (Swedish text is binding): https://www.zeekr.eu/policy?type=warranty_teams | verified (for Sweden) | High for Sweden | **No (not Malaysia)** |
| E2 | Sweden: service schedule year 2 / 40,000 km, year 4 / 80,000 km, health checks at years 5, 7 and 9, services at years 6, 8 and 10. Servicing at non-Zeekr workshops keeps cover only for the first two services. | Same as E1, section 4 | verified (for Sweden) | High for Sweden | **No (not Malaysia)** |
| E3 | Sweden: high-voltage battery 8 years or 200,000 km; replaced or repaired if capacity falls below 70%. | Same as E1, section 5.8 | verified (for Sweden) | High for Sweden | **No (not Malaysia)** |
| E4 | Sweden: paint and surface 4 years or 80,000 km; corrosion 12 years or 200,000 km; wear-and-tear parts 2 years; adjustment cover 3 months; original parts 1 year; accessories 2 years. Tyres covered by the tyre maker. | Same as E1, sections 5.1 to 5.7 and 8.1 | verified (for Sweden) | High for Sweden | **No (not Malaysia)** |
| E5 | Sweden: bi-annual paint inspection and keeping service records are named as warranty conditions. | Same as E1, sections 7.3 and 7.4 | verified (for Sweden) | High for Sweden | **No (not Malaysia)** |
| E6 | EU site 7X: 8 years high-voltage battery, 4 years paint, 12 years corrosion, 3 years roadside assistance, "up to 10 years" warranty when serviced at recommended points. The two EU pages disagree on roadside assistance. | https://www.zeekr.eu/models/7x ; https://www.zeekr.eu/care | verified (EU site text) | Medium | **No (not Malaysia)** |
| E7 | EU Zeekr Connected page: app offers remote control, battery charging, remote monitoring and Digital Key. Standard connectivity four years from activation, then a Premium Package annual fee. App is "Zeekr" on App Store id6448229216 and Google Play com.zeekr.overseas. Digital Key 3.0 (UWB, Apple Wallet) supported on the 7X (OS 2.1 or later). | https://www.zeekr.eu/en-se/connected | verified (EU site text) | Medium | **No (not Malaysia)** |
| E8 | EU Zeekr Care Service Plan: up to four services bought in advance, one every two years or 40,000 km. Transferable to the next owner. | https://www.zeekr.eu/care | verified (EU site text) | Medium | **No (not Malaysia)** |
| E9 | Australia: 5 years unlimited km vehicle, 8 years / 160,000 km battery, free 12-month service on the official AU site. Press says capped-price servicing every 12 months / 20,000 km. | https://www.zeekrlife.com/en-au/models/zeekr-7x ; https://www.chasingcars.com.au/reviews/midsize-suvs/zeekr-7x-performance-awd-2026-review (press) ; https://www.datocms-assets.com/130529/1770683613-australian-warranty-policy.pdf | unverified for Malaysia | Medium for AU | **No (Australia)** |
| E10 | EU "Owner's Manual" page per country loads by script, so the Netherlands list was empty when fetched. | https://www.zeekr.eu/en-nl/manual-result | unverified | Low | **No (not Malaysia)** |
| E11 | The EU warranty terms say the Swedish warranty extends to the UK for 60 days a year, and the Owner's Manual is digital. | Same as E1, sections 7.2 and 9 | verified (for Sweden) | High | **No (not Malaysia)** |
| E12 | Owner-run Australian site hosts 7X manual, service schedule, tyre pressure and rim documents. Not official. | https://www.zeekr7xaustralia.com.au/info.htm | unverified | Low | **No (Australia)** |
| E13 | Tyre database lists 265/40 R21 (V, load index 105) at about 2.7 bar (39 psi) for the AWD and 265/45 R20 at 2.5 bar for the 20-inch option. Not from Zeekr. This does not match the Malaysian-spec 265/45 R20 (M31) in size for the standard fit. | https://www.wheel-size.com/size/zeekr/7x/2025 | unverified | Low | **No (not Malaysia)** |
| E14 | Australian 7X Performance AWD is reported with 265/40 R21 Continental EcoContact tyres. | https://www.chasingcars.com.au/reviews/midsize-suvs/zeekr-7x-performance-awd-2026-review | unverified | Low to medium | **No (Australia)** |
| E15 | Forum posts quote the Australian manual as advising 39 psi with minimal load and 42 psi loaded, and 250 kPa minimum for the RWD Long Range. | Reddit r/Zeekr7xAustralia (via search, not fetched) | unverified (forum) | Low | **No (Australia)** |
| E16 | EU site: the AWD trim has 21-inch wheels and other trims 19-inch. | https://www.zeekr.eu/models/7x | verified (EU site text) | Medium | **No (not Malaysia)**. Malaysian AWD is 20-inch (M31). |
| E17 | Privacy policy lists a right to data portability for personal data a user has given Zeekr (Zeekr EU B.V., last updated 18 September 2023). Not vehicle telemetry. | https://www.zeekr.eu/policy | verified (EU policy text) | Medium | **No (EU only)**. Malaysian privacy policy exists at https://www.zeekrlife.com/en-my/policy but was not read. |
| E18 | EU website terms prohibit screen scraping and reverse engineering of the website. | https://www.zeekr.eu/policy?type=terms_of_use | verified (EU site text) | High | **No (website terms only)** |
| E19 | The European "ZEEKR Charge" app (built by Plugsurfing) lists charging history and downloadable receipts, across 27 European countries. | https://play.google.com/store/apps/details?id=com.plugsurfing.zeekrcharge ; https://apps.apple.com/fi/app/zeekr-charge/id6462404483 | verified (store text) | Medium | **No (Europe only)** |
| E20 | EVSE Master example shows a generic charger app can export charging records. Different vendor, not tied to Zeekr. | https://evse.com/export-all-ev-charging-records-using-evsemaster-app | unverified | Low | **No** |
| E21 | Armenia and UAE warranty books show other terms (4 years / 100,000 km and 8 years / 160,000 km; 60 months / 120,000 km). They confirm terms differ by market. | https://www.zeekrlife.com/en-am/service ; https://saofficewebsiteprod.blob.core.windows.net/assets-em/assets/ZEEKR_Warranty+Book+2024.04.30-GCC-UAE-01072024.pdf | verified (for those markets) | Medium | **No (not Malaysia)** |
| E22 | The UK was not on official sale at the time of the earlier pass. No UK distributor was found. This is no longer relevant to the owner. | Autocar, Electrifying (undated) | unverified | Low | **No (UK)** |

## Searched but not found

- Malaysian owner's manual for the 7X (web, Zeekr Malaysia site; searches repeated 2026-10-22).
- The battery state-of-health threshold and the full wear-item list for Malaysia.
- Any official Malaysian tyre pressure table. Michelin Malaysia lists fitment sizes but no pressure values.
- Wallbox make and model supplied in Malaysia, and the vendor app.
- Official owner API or developer portal.
- Any official data export for charging sessions or telemetry (Zeekr app, chargEV, JomCharge, Gentari, ChargeSini).
- Malaysian Zeekr app feature list and which features need the paid connected service after year one. Price of connected service after year one.
- Confirmation that the "ZEEKR" app is in the Malaysian App Store and Google Play (listing seen was Mexico and Australia).
- Digital Key availability for Malaysia.

## Candidate adapters

None. A candidate needs a `verified` entry above before an adapter is designed. M30 is not a candidate.

## Findings for the MVP (record only, no new features)

- The application may offer the official AWD Performance schedule from M12 as an owner-confirmed template; do not silently apply it, because the PDF says requirements can vary by model, build date, operating conditions and local requirements.
- Store the original Malaysian warranty terms from M8–M10 plus the owner’s separately verified extended warranty records (O3–O5). Keep all dates and kilometre limits owner-editable.
- Do not ship a default tyre pressure. Let the owner enter pressures from the door-jamb placard.
- Context for existing records only: road tax is yearly or 6-monthly and depends on insurance being active first (M35 to M38).
- Market, units and currency (Malaysia, km, MYR) are confirmed in `AGENTS.md` Conventions as of 2026-10-11.

## Next steps

0. 2026-10-11: owner supplied the JPJ ownership certificate, the extended warranty agreement and three leaflets (see "Findings: from the owner's own documents"). Still missing: the door-jamb tyre placard photo, the service maintenance schedule, and the original warranty booklet if it differs from the agreement.


1. **Owner (no login needed):** photograph the following. Do not include the VIN in anything committed to the repo; crop or blank it.
   - the driver door-jamb tyre placard (size and pressures, front and rear);
   - the warranty and service booklet or card supplied at delivery (warranty start date, any service-package page);
   - the sales or delivery paperwork showing any free service package, free wallbox, extended warranty and connected-service term (blank out personal details);
   - the date of first registration (from the registration card or JPJ record, without the VIN);
   - the road tax amount shown in MyJPJ and the insurance renewal date (no policy number).
2. **Owner:** say which wallbox is installed (make and model label) and which charging apps they use.
3. **Owner:** check the in-car or app manual for a Malaysian version. If supplied, record its document version and licence before using it for the future manual-retrieval feature.
4. **Owner (with approval, no researcher login):** note the Malaysian Zeekr app screens for vehicle status, charging history and any export, and whether Digital Key is available. Check whether chargEV, JomCharge or Gentari show charging history or receipts that can be downloaded.
5. R1: monitor for an official developer programme. Until then, record only. Do not use M30.
