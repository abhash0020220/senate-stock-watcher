"""Scrapes House of Representatives stock trade disclosures (Periodic
Transaction Reports) from disclosures-clerk.house.gov, which — unlike the
Senate's site — has no bot protection and returns plain HTML/PDF over
simple HTTP requests. No API key, no cost.

Usage: python3 scrape_house.py [years...]
Writes ../data/house_trades.json — combine with Senate data via merge_data.py.
"""
import datetime
import io
import json
import re
import sys
import time
from pathlib import Path

import requests

from parse_ptr import parse_ptr_pdf

BASE = 'https://disclosures-clerk.house.gov'
SEARCH_URL = f'{BASE}/FinancialDisclosure/ViewMemberSearchResult'
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; senate-stock-watcher/1.0; personal portfolio project)'}

ROW_RE = re.compile(
    r'<a href="(?P<href>public_disc/ptr-pdfs/\d{4}/\d+\.pdf)"[^>]*>(?P<name>[^<]+)</a>'
    r'.*?<td data-label="Office">(?P<office>[^<]*)</td>'
    r'.*?<td data-label="Filing Year">(?P<year>\d{4})</td>'
    r'.*?<td data-label="Filing">(?P<filing>[^<]*)</td>',
    re.S,
)


def list_filings(year):
    resp = requests.post(
        SEARCH_URL,
        headers=HEADERS,
        data={'LastName': '', 'FilingYear': str(year), 'State': '', 'District': '', 'FilingType': ''},
        timeout=30,
    )
    resp.raise_for_status()
    filings = []
    for m in ROW_RE.finditer(resp.text):
        if 'PTR' not in m.group('filing'):
            continue
        filings.append({
            'pdf_url': f"{BASE}/{m.group('href')}",
            'name': m.group('name').strip(),
            'office': m.group('office').strip(),
            'filing_year': m.group('year'),
        })
    return filings


def scrape_years(years, delay=0.3, limit=None):
    all_trades = []
    for year in years:
        filings = list_filings(year)
        print(f'{year}: {len(filings)} PTR filings found', file=sys.stderr)
        if limit:
            filings = filings[:limit]
        for i, f in enumerate(filings):
            try:
                pdf_resp = requests.get(f['pdf_url'], headers=HEADERS, timeout=30)
                pdf_resp.raise_for_status()
                trades = parse_ptr_pdf(io.BytesIO(pdf_resp.content))
                for t in trades:
                    t['ptr_link'] = f['pdf_url']
                    if not t.get('member'):
                        t['member'] = f['name']
                    if not t.get('office'):
                        t['office'] = f['office']
                all_trades.extend(trades)
            except Exception as e:
                print(f'  failed {f["pdf_url"]}: {e}', file=sys.stderr)
            if (i + 1) % 25 == 0:
                print(f'  {i + 1}/{len(filings)} filings processed, {len(all_trades)} trades so far', file=sys.stderr)
            time.sleep(delay)
    return all_trades


if __name__ == '__main__':
    import datetime
    current_year = datetime.date.today().year
    # Late-filed PTRs (members get 30-45 days to file) mean trades from the
    # tail of last year can still land in this year's search results, so
    # default to scraping both the current and prior year.
    years = [int(a) for a in sys.argv[1:]] or [current_year - 1, current_year]
    trades = scrape_years(years)
    trades = [t for t in trades if t.get('ticker')]  # drop rows we couldn't identify a ticker for

    parties_path = Path(__file__).parent.parent / 'data' / 'member_parties.json'
    parties = json.loads(parties_path.read_text()) if parties_path.exists() else {}
    for t in trades:
        info = parties.get(t.get('office'), {})
        t['chamber'] = 'House'
        t['state'] = (t.get('office') or '')[:2]
        t['party'] = info.get('party')
        bioguide = info.get('bioguide_id')
        t['member_url'] = f'https://bioguide.congress.gov/search/bio/{bioguide}' if bioguide else None

        t['days_to_file'] = None
        if t.get('filed_date') and t.get('transaction_date'):
            try:
                fmt = '%m/%d/%Y'
                t['days_to_file'] = (
                    datetime.datetime.strptime(t['filed_date'], fmt)
                    - datetime.datetime.strptime(t['transaction_date'], fmt)
                ).days
            except ValueError:
                pass

    out_path = Path(__file__).parent.parent / 'data' / 'house_trades.json'
    out_path.write_text(json.dumps(trades, indent=2))
    print(f'Wrote {len(trades)} trades to {out_path}', file=sys.stderr)
