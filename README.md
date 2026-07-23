# Congress Stock Watcher

A searchable dashboard of stock trades publicly disclosed by U.S. House members and Senators, built as a fully static, zero-backend site — no API keys, no server, no cost.

## Data

Current snapshot: trades parsed directly from Periodic Transaction Report (PTR) filings, covering 2025–2026 (a small number of backdated/late-filed trades go back further):

- **House**: PDF filings from [disclosures-clerk.house.gov](https://disclosures-clerk.house.gov/FinancialDisclosure), parsed by bucketing PDF words into columns by x-position (the PDFs have no real embedded table structure).
- **Senate**: HTML filings from [efdsearch.senate.gov](https://efdsearch.senate.gov/search/) — despite appearances, this site has no real bot protection, it just needs a session that agrees to the site's usage terms and carries a CSRF token; once that's done each PTR is a clean HTML table, easier to parse than the House's PDFs.

Party affiliation is joined in from each chamber's own public member directory (House Clerk's `MemberData.xml`, Senate's `senators_cfm.xml`) — PTR filings themselves never mention party. House joins by district code; Senate joins by last name only, since PTR filings use each senator's *legal* first name (e.g. "Rafael E Cruz", "A. Mitchell McConnell, Jr."), which frequently doesn't match the commonly-known name ("Ted Cruz", "Mitch McConnell") that the roster uses.

Stored locally in [`data/transactions.json`](data/transactions.json) so the app has no runtime dependency on any external service.

Not included: bond/treasury-bill/municipal-note transactions (no stock ticker to key off of), a handful of older House filings that were scanned as images rather than generated as text PDFs, and Senate "paper" filings (same reason).

Live, auto-updating data (via a scheduled GitHub Actions scraper) is planned as a follow-up for the House side; see [`.github/workflows/scrape.yml`](.github/workflows/scrape.yml).

## Scraper

See [`scraper/`](scraper/):

- `scrape_house.py` / `parse_ptr.py` — House PDF scraping and column-position-based parsing.
- `scrape_senate.py` — Senate HTML scraping (session handshake + table parsing). Also dedupes exact-repeat rows that come from senators filing an amendment that re-states an unchanged line from the original PTR.
- `build_party_lookup.py` / `build_senate_lookup.py` — party/state lookups from each chamber's public member directory.
- `merge_data.py` — combines `house_trades.json` + `senate_trades.json` into the final `data/transactions.json`.

```
cd scraper
pip3 install -r requirements.txt
python3 build_party_lookup.py
python3 build_senate_lookup.py
python3 scrape_house.py 2025 2026
python3 scrape_senate.py 2025 2026
python3 merge_data.py
```

## Stack

Plain HTML/CSS/JS, no build step, no framework, [Chart.js](https://www.chartjs.org/) via CDN for the analytics tab. Open `index.html` directly or serve the folder statically (GitHub Pages, Netlify, Vercel all work with zero config).

## Run locally

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.
