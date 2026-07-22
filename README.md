# Congress Stock Watcher

A searchable dashboard of stock trades publicly disclosed by U.S. House members, built as a fully static, zero-backend site — no API keys, no server, no cost.

## Data

Current snapshot: ~9,000 trades parsed directly out of House Periodic Transaction Report (PTR) PDFs filed at [disclosures-clerk.house.gov](https://disclosures-clerk.house.gov/FinancialDisclosure), covering 2025–2026 filings (a small number of backdated/late-filed trades go back further). Stored locally in [`data/transactions.json`](data/transactions.json) so the app has no runtime dependency on any external service.

The Senate's own disclosure site (efdsearch.senate.gov) sits behind Akamai bot protection and can't be scraped without a much heavier setup, so this tracks the House side only, where the Clerk's site has no such protection.

Not included: bond/treasury-bill/municipal-note transactions (no stock ticker to key off of) and a handful of older filings that were scanned as images rather than generated as text PDFs.

Live, auto-updating data (via a scheduled scraper) is planned as a follow-up.

## Scraper

See [`scraper/`](scraper/) — `scrape_house.py` fetches the filing list and PDFs directly from the House Clerk's site (no key, no auth), and `parse_ptr.py` extracts trade rows from each PDF by bucketing words into columns by x-position (the PDFs have no real embedded table structure, and several fields wrap across lines in ways plain regex-on-text can't reliably follow).

```
cd scraper
pip3 install -r requirements.txt
python3 scrape_house.py 2025 2026
```

## Stack

Plain HTML/CSS/JS, no build step, no framework. Open `index.html` directly or serve the folder statically (GitHub Pages, Netlify, Vercel all work with zero config).

## Run locally

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.
