# LWH PTO & Absence Calendar

A installable PWA that shows PTO and absences as a visual, printable month
calendar — themed to match the customer portal. Pulls live data directly
from the tracker (via published Google Sheets tabs), so it's always
current with no manual export/upload step.

## How it works

1. `PTO_TLand_Export.gs` (the same script that feeds TLand) now also
   writes two "clean" tabs into the tracker spreadsheet on every export:
   `Export_PTORequests`, `Export_Employees`, `Export_AbsenceTypes` —
   canonical headers, ISO dates, same as the TLand CSVs.
2. Those three tabs get published to the web as CSV (one-time setup,
   see below). The published URL is tied to the tab, not a file — it
   never changes, and Google refreshes it within a few minutes of any
   edit or scheduled export run.
3. This app fetches all three CSVs on load, joins Requests to Employees
   for department info, expands each request's date range into
   individual weekdays (skipping weekends), and renders a month
   calendar. Both past and future-dated requests show up — there's no
   "current month only" restriction like the local upload-based tool.

## One-time setup

### 1. Publish the three tabs
In the tracker spreadsheet:
1. Run **TLand Export → Export All to TLand** at least once (creates the
   `Export_` tabs if they don't exist yet).
2. **File → Share → Publish to web**.
3. In the dropdown, select **Export_PTORequests** (not "Entire Document").
4. Set the format dropdown to **Comma-separated values (.csv)**.
5. Click **Publish**, confirm, and copy the URL it gives you.
6. Repeat for **Export_Employees** and **Export_AbsenceTypes**.

### 2. Configure the app
Open `app.js` and paste the three URLs into `CONFIG` near the top:
```js
const CONFIG = {
  PTO_REQUESTS_CSV_URL:  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuPdjvjICInergHmx_qGJF4mI_iYgsrmWeF1nCr-WTdz3jhqG0yZ9LPcL1M9vJWP9i7n-1-JD8Q3xb/pub?gid=491852524&single=true&output=csv',
  EMPLOYEES_CSV_URL:     'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuPdjvjICInergHmx_qGJF4mI_iYgsrmWeF1nCr-WTdz3jhqG0yZ9LPcL1M9vJWP9i7n-1-JD8Q3xb/pub?gid=1288918784&single=true&output=csv',
  ABSENCE_TYPES_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuPdjvjICInergHmx_qGJF4mI_iYgsrmWeF1nCr-WTdz3jhqG0yZ9LPcL1M9vJWP9i7n-1-JD8Q3xb/pub?gid=2133598834&single=true&output=csv'
};
```

### 3. App icons — already included
`icon-192.png`, `icon-512.png`, and `logo-header.png` are generated from
your real LWH Logistics Warehouse logo and already sit in this folder —
nothing to do here.

### 4. Deploy to GitHub Pages
Same pattern as Warehouse Toolkit and Driver Toolkit:
1. Create a new repo (e.g. `LWH-PTO-Calendar`).
2. Push these files to it.
3. Repo Settings → Pages → Deploy from branch → `main` / root.
4. Share the resulting `https://<you>.github.io/LWH-PTO-Calendar/` URL
   with Doug and the other managers.

## Notes

- **Approved requests always show; Pending is opt-in** via the "Include
  Pending" checkbox in the toolbar — off by default so the calendar
  reflects confirmed absences, not requests still awaiting a decision.
- **Wide date-range requests** (a request spanning more than its actual
  DaysCount, e.g. someone picks a whole week but is really only out 2
  specific days) get expanded across every weekday in the range, not
  just the real day count — same simplification as the local calendar
  tool. Flagged here again in case it's ever worth a tracker change
  (e.g. a multi-select date picker) instead of a date range.
- **Company holidays** aren't excluded from the weekday expansion (the
  tracker's own `isMajorHoliday()` logic isn't replicated here) — minor
  edge case, mention if it's worth adding.
- **Print / Save PDF** uses the browser's native print dialog — choose
  "Save as PDF" as the destination for a downloadable file. No extra
  library, so it's reliable across browsers, but it means "download
  PDF" is two clicks (Print → Save as PDF) rather than one.
