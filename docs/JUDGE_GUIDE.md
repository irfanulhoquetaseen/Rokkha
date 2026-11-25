# Judge Guide — Live 10-Minute Walkthrough

This step-by-step script verifies **M01–M08**, **A05**, and **A01** on the deployed site (`M01` Complete Functional System · `M02` Database Integration & Persistence · `M03` Authentication & Authorization · `M04` Complex Business Logic · `M05` Dynamic Data Processing · `M06` Error & Edge-Case Handling · `M07` Responsive UI & Accessibility · `M08` Deployment & Documentation · `A05` Concurrency & Transaction Management · `A01` Real-Time Data Synchronization):

- **Live URL:** https://web-production-3fb89dc8.up.railway.app
- **Viewports:** Test on a mobile phone (or browser DevTools `360×800`) alongside a desktop window (`1440×900`).
- **Demo passwords:** Provided privately with the hackathon submission. Keep them handy as `<ADMIN_PW>`, `<STAFF_PW>`, and `<CITIZEN_PW>`.

---

## Step 1 — Pre-flight, Health & Demo Stock Refresh (~1 min)

| Step | Action | Expected Result | Rubric |
|---|---|---|---|
| 1a | Open `https://web-production-3fb89dc8.up.railway.app/api/health` and `/status` | `/api/health` returns `200` with `{"status":"ok","db":"up"}`; `/status` shows API up and Socket.io **connected**. | M08 |
| 1b | Verify the amber banner at the top of the page; click the **`English`** button in the header (optional if testing in English) | Permanent top banner reads `DEMO DATA — not real hospital availability`; UI switches cleanly between Bangla (default) and English. | M07 |
| 1c | Go to `/login`, log in as Admin (`01700000001`), open **`Admin` (`/admin`)**, click **`Refresh demo stock`**, and confirm **`Yes`** | Notice confirms all active demo hospitals reset in Postgres (while preserving any active reservations). Ensures fresh timestamps (`< 30 min`) and `ICU_BED = 1/6` at Dhanmondi Care General before testing. Log out afterwards. | M01, M02, M06 |

---

## Step 2 — Public Emergency Finder, Scoring, First Aid & Directory (~1.5 min)

Use a **logged-out mobile viewport (`360×800`)**.

| Step | Action | Expected Result | Rubric |
|---|---|---|---|
| 2a | Visit `/` and tap **Stroke** (`স্ট্রোক`) | Navigates directly to `/find?condition=STROKE` with **zero login prompt** and zero horizontal scroll at `360 px`. | M01, M07 |
| 2b | Choose **Area: Dhanmondi** (or click **Use my location**), **Blood group**, and try filters (`Govt`, `Resource`, `Radius 5 km`) → **Show results** | Hospitals are ranked `0–100` with `✅` / `⚠️` / `❌` bilingual reasons, distance in km, freshness badge, and hospitals missing a `CRITICAL` requirement listed at the bottom under **Not suitable**. | M04, M05 |
| 2c | Inspect hospital phone numbers vs. the red **`Call 999`** button | **Call 999** is a clickable `tel:999` link; demo hospitals display their number + a `DEMO` badge with calling disabled (prevents panicking users from dialing fictional numbers). | M07 |
| 2d | Expand the **First aid** card or open `/first-aid/STROKE` | Shows plain-language Do's, Don'ts, **Call 999**, cited source (`IFRC International First Aid Guidelines 2020 — Stroke, p. 271`) + PDF page link, `"Checked against source"`, and medical disclaimer. | M02, M07 |
| 2e | Scroll down to **Unverified — call before going** and also open a live hospital name (e.g. `Dhanmondi Care General Hospital` → `/hospitals/dhanmondi-care-general`) | Directory section lists non-live facilities separately; `/hospitals/<slug>` renders a live stock table connected via Socket.io. | M01, M05, A01 |

---

## Step 3 — A05 Concurrency Race from CLI (`npm run demo:race`) (~1.5 min)

Keep the mobile `/find?condition=STROKE&area=dhanmondi` (or `/hospitals/dhanmondi-care-general`) page visible on screen.

1. Run from the repository root (with `.env` populated with `SEED_STAFF_PASSWORD` and `SEED_CITIZEN_PASSWORD`):

```powershell
npm run demo:race -- --url https://web-production-3fb89dc8.up.railway.app --hospital dhanmondi-care-general --resource ICU_BED --n 20 --set-available 1
```

- **Action → Expected Result (A05, A01, M08):**
  - The script caches 20 racer sessions (`01700000101`–`01700000120`), sets `ICU_BED` available to `1`, and fires **20 parallel `POST /api/reservations`** requests at once.
  - Summary table shows **`HELD: 1`, `SOLD_OUT: 19`, `available before: 1`, `available after: 0`** (stock is never negative).
  - Your open mobile Finder / hospital page drops `ICU bed` from `1` to `0` live without a page reload, then restores back when the script automatically cancels its test hold and restores original stock.

---

## Step 4 — Reservation Hold Flow & A05 Edge Cases (~2 min)

| Step | Action | Expected Result | Rubric |
|---|---|---|---|
| 4a | While signed out on `/find?condition=STROKE&area=dhanmondi`, tap **`Log in to hold`** → log in as Citizen 1 (`01700000021`) | Redirects through `/login?next=...` and returns directly to the exact Finder URL (`GET` params preserved). | M03, M06 |
| 4b | Double-click **`Hold ... for 30 min`** twice rapidly on an available bed (e.g. `General bed`) | Same client `Idempotency-Key` ensures **only 1 reservation** is persisted; opens `/reservations/<id>` tracker with a server-anchored 30:00 countdown and `"First aid while travelling"` link. | M01, M02, M06, A05 |
| 4c | Go back to `/find` (or open a second tab) and try holding another **`General bed`** | Blocked with `409 LIMIT_REACHED` (`"You already have an active hold for this resource type"`). Hold a different resource at a sold-out row (e.g. Mirpur Janata Health Complex `ICU_BED` at `0`) → shows `409 SOLD_OUT` with **up to 3 nearby alternative hospitals**. | M04, M06, A05 |
| 4d | On `/reservations/<id>`, click **`Cancel hold`** → **`Yes, cancel hold`** | Transitions `HELD → CANCELLED` via CAS, returns stock (`+1`), and logs a timeline entry. Retrying cancel returns `409 INVALID_TRANSITION`. | M02, M04, M06, A05 |

*(Overdue expiry note: any `HELD` past `expiresAt` is automatically marked `EXPIRED` on server boot, every `30 s` by the sweeper, and lazily on citizen/staff reads; attempting Check-in or Cancel on an overdue hold transitions it to `EXPIRED`, returns stock once, and responds `409 INVALID_TRANSITION` `"This hold has expired"`.)*

---

## Step 5 — A01 Two-Browser Live Sync, Optimistic Conflict & Offline Recovery (~2 min)

Open **Window A (Desktop, signed in)** and **Window B (Mobile / Incognito)**.

| Step | Action | Expected Result | Rubric |
|---|---|---|---|
| 5a | **Live Finder (< 1 s):** Window B opens `/find?condition=STROKE&area=dhanmondi` (logged out). Window A (Citizen `01700000022`) holds `ICU bed` (`1` left) at Dhanmondi Care General. | Window B updates `ICU bed` (`1` → `0` / `"Nothing left to hold here right now"`) in under 1 second without reloading. | A01 |
| 5b | **Live Staff Console & Queue:** Open `/staff` as Dhanmondi Staff (`01700000011`) in Window A while keeping Window B on Citizen `01700000022`'s `/reservations/<id>` tracker. Click **`Check in`** → then **`Complete`** on the queue row (or **`Reject`** with a reason ≥ 3 chars). | Citizen's tracker updates live (`Held` → `Arrived` → `Completed`, no reload). Note that completing a non-consumable bed returns stock `+1`, whereas completing blood/antivenom keeps stock consumed. | M01, M02, M04, A05, A01 |
| 5c | **Optimistic Concurrency (409 Conflict UI):** Open `/staff` as `01700000011` in **two tabs**. In Tab 2, click `Set` on `General bed` (don't save yet). In Tab 1, adjust `General bed` (`+1` and Save). Note Tab 2 displays `"Changed by someone else — saving will show both values"` without erasing your typed form; click **Save** in Tab 2. | Tab 2 rejects with `409 CONFLICT` and renders **`"Another staff member changed this"`**, showing server values vs. your edit with **`Reload`** and **`Re-apply`** buttons. | M02, M06, A05, A01 |
| 5d | **Offline → Reconnect:** In Window B (`/hospitals/dhanmondi-care-general` or `/staff`), open Browser DevTools → Network → **Offline**. | Amber **`Reconnecting…`** banner appears. Adjust a stock row in Window A, then restore Window B to **Online** → banner clears and snapshot refetch brings Window B into sync. | M06, A01 |

*(Cleanup note: cancel any remaining test holds on `01700000021`/`01700000022` or run Step 1c **`Refresh demo stock`** again if needed.)*

---

## Step 6 — Security Isolation & Negative Edge Cases (~1 min)

| Step | Action | Expected Result | Rubric |
|---|---|---|---|
| 6a | Logged in as Dhanmondi staff (`01700000011`), try visiting Mirpur Shastho Medical's URL (`/staff/hospitals/<mirpur-id>`) | Returns a **real HTTP 404** (never 403) and records `AUTHZ_DENIED` in `/admin/audit`. | M03 |
| 6b | Logged in as Citizen (`01700000021`), visit `/admin` (or fetch `/api/admin/hospitals`) | Returns a **real HTTP 404** (`NOT_FOUND` + `AUTHZ_DENIED` audit). | M03 |
| 6c | Visit `/first-aid/NOPE`, `/hospitals/does-not-exist`, and `/signup` with phone `12345` | Unknown routes return **HTTP 404**; invalid BD phone fails inline client validation (`01[3-9]` + 8 digits) without firing a request. | M06, M07 |

---

## Step 7 — Admin CRUD, Archive, CSV Import, Users & SQL Analytics (~1 min)

Log in as Admin (`01700000001`) and open **`Admin` (`/admin`)**:

| Step | Action | Expected Result | Rubric |
|---|---|---|---|
| 7a | Click **`+ Add new hospital`**, fill valid Bangladesh coords (`lat: 23.75, lng: 90.38`), attach an initial `ICU bed` resource (`total: 2, available: 2`), and click **Save** | Hospital + initial stock + `ADMIN_CHANGE` audit created in one transaction and immediately searchable on `/find`. | M01, M02, M05 |
| 7b | Edit the new hospital, then click **`Delete`** (or test archiving a hospital with a `HELD` reservation) | A hospital with `0` prior reservations hard-deletes cleanly; one with history **archives** (`archivedAt`), returns **404** on `/hospitals/<slug>`, and vanishes from `/find`. Active `HELD`/`ARRIVED` reservations block archiving with `409 CONFLICT`. | M02, M04, M06, A05 |
| 7c | Click **`Import CSV`**, paste 1 valid row and 1 invalid-coordinate row (`lat: 55`), click **Run import** | Returns a per-row status table (`created: 1`, `errors: 1` naming the failing row and field). Re-running the valid row reports `unchanged: 1` (idempotent by `slug`). | M05, M06 |
| 7d | Open **`Users`** (`/admin/users`), **`Audit log`** (`/admin/audit`), and **`Analytics`** (`/admin/analytics`) | Users supports `CITIZEN ↔ HOSPITAL_STAFF` assignment (with immediate session revocation + socket disconnect, self-demotion blocked with 409); Audit shows `STOCK_CHANGE`, `RESERVATION_TRANSITION`, `ADMIN_CHANGE`, and `AUTHZ_DENIED`; Analytics displays SQL-aggregated 7-day demand, sold-out unmet demand, hold outcome rates, avg hold→arrival minutes, and stale hospitals (`> 30 min`). | M01, M02, M03, M05 |
