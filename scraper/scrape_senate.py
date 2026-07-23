"""Scrapes Senate Periodic Transaction Reports from efdsearch.senate.gov.

Despite earlier appearances, this site has no real bot protection — it just
requires a session that (a) fetches the landing page, (b) POSTs agreement
to the "prohibition on use" notice to get a real session cookie, and (c)
carries a CSRF token on the actual search POST. Once that handshake is
done, /search/report/data/ is a plain paginated JSON API, and each PTR is
a clean HTML table (far easier to parse than the House's PDFs — no column-
position bucketing needed).

Usage: python3 scrape_senate.py [years...]
Writes ../data/senate_trades.json
"""
import datetime
import io
import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from build_senate_lookup import norm
from slugify import member_url as build_member_url

# efdsearch's own search results are the *only* place these two problems
# show up — checked directly against the raw JSON response:
#   1. Some last names carry a trailing ", Jr."/", II" suffix or a stray
#      comma (e.g. "Moran,  ", "King, Jr.") that the Senate's official
#      roster XML doesn't have, so a plain last-name match misses them.
#   2. Sen. Markwayne Mullin (R-OK) is absent from senate.gov's own
#      contact-info XML entirely — confirmed by searching that feed for
#      both "Mullin" and "Markwayne" and finding neither. Not a join bug;
#      the source government feed itself has a gap for him. His party/state
#      are public record, so it's patched in manually here rather than left
#      silently blank.
SUFFIX_RE = re.compile(r',?\s*(jr\.?|sr\.?|i{2,3}|iv)\s*$', re.I)
MANUAL_SENATOR_OVERRIDES = {
    # bioguide_id verified directly against congress.gov's own member URL
    # (congress.gov/member/markwayne-mullin/M001190), not guessed.
    'mullin': [{'party': 'R', 'state': 'OK', 'name': 'Markwayne Mullin', 'first_name': 'Markwayne', 'bioguide_id': 'M001190'}],
}


def clean_last_name(last_name):
    return SUFFIX_RE.sub('', norm(last_name).rstrip(',').strip())


def days_between(transaction_date, filed_date):
    try:
        fmt = '%m/%d/%Y'
        return (datetime.datetime.strptime(filed_date, fmt) - datetime.datetime.strptime(transaction_date, fmt)).days
    except (ValueError, TypeError):
        return None


def lookup_senator(lookup, first_name, last_name):
    key = clean_last_name(last_name)
    candidates = lookup.get(key) or MANUAL_SENATOR_OVERRIDES.get(key, [])
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        # Collision (e.g. two Sen. Scotts) — disambiguate by first initial,
        # since PTR filings use legal first names that otherwise rarely
        # match the roster's commonly-known name at all.
        initial = norm(first_name)[:1]
        for c in candidates:
            if norm(c['first_name'])[:1] == initial:
                return c
    return {}

ROOT = 'https://efdsearch.senate.gov'
LANDING_PAGE_URL = f'{ROOT}/search/home/'
REPORTS_URL = f'{ROOT}/search/report/data/'
BATCH_SIZE = 100
DELAY = 0.4

TYPE_MAP = {
    'Purchase': 'Purchase',
    'Sale (Full)': 'Sale (Full)',
    'Sale (Partial)': 'Sale (Partial)',
    'Exchange': 'Exchange',
}


def make_session():
    client = requests.Session()
    client.headers.update({'User-Agent': 'Mozilla/5.0 (compatible; senate-stock-watcher/1.0; personal portfolio project)'})
    resp = client.get(LANDING_PAGE_URL, timeout=30)
    soup = BeautifulSoup(resp.text, 'lxml')
    form_csrf = soup.find(attrs={'name': 'csrfmiddlewaretoken'})['value']
    client.post(LANDING_PAGE_URL, data={'csrfmiddlewaretoken': form_csrf, 'prohibition_agreement': '1'},
                headers={'Referer': LANDING_PAGE_URL}, timeout=30)
    return client


def list_filings(client, year):
    csrftoken = client.cookies.get('csrftoken') or client.cookies.get('csrf')
    filings = []
    start = 0
    while True:
        payload = {
            'start': start, 'length': BATCH_SIZE, 'report_types': '[11]', 'filer_types': '[]',
            'submitted_start_date': f'01/01/{year} 00:00:00', 'submitted_end_date': f'12/31/{year} 23:59:59',
            'candidate_state': '', 'senator_state': '', 'office_id': '', 'first_name': '',
            'last_name': '', 'csrfmiddlewaretoken': csrftoken,
        }
        resp = client.post(REPORTS_URL, data=payload, headers={'Referer': f'{ROOT}/search/'}, timeout=30)
        resp.raise_for_status()
        rows = resp.json().get('data', [])
        if not rows:
            break
        for row in rows:
            first_name, last_name, _office, link_html, filing_date = row
            m = re.search(r'href="([^"]+)"', link_html)
            if not m:
                continue
            href = m.group(1)
            filings.append({
                'first_name': first_name, 'last_name': last_name,
                'url': f'{ROOT}{href}', 'filing_date': filing_date,
                'is_paper': '/search/view/paper/' in href,
            })
        start += BATCH_SIZE
        time.sleep(DELAY)
    return filings


def parse_ptr_page(client, url):
    resp = client.get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'lxml')
    table = soup.find('table')
    if table is None:
        return []
    trades = []
    for tr in table.find('tbody').find_all('tr'):
        cells = tr.find_all('td')
        if len(cells) < 9:
            continue
        _idx, tx_date, owner, ticker_cell, asset_cell, asset_type, txn_type, amount, comment = cells[:9]
        # Exchange transactions can list two tickers in this cell (old
        # ticker <br/> new ticker); take just the first (the "from" side)
        # rather than get_text(), which would run them together with no
        # separator (e.g. "ETRN" + "EQT" -> "ETRNEQT").
        ticker_link = ticker_cell.find('a')
        ticker = ticker_link.get_text(strip=True) if ticker_link else ticker_cell.get_text(strip=True)
        asset_desc = asset_cell.contents[0].strip() if asset_cell.contents else asset_cell.get_text(strip=True)
        if not ticker or ticker == '--':
            continue
        trades.append({
            'ticker': ticker,
            'asset_description': re.sub(r'\s+', ' ', asset_desc),
            'asset_type': asset_type.get_text(strip=True),
            'type': TYPE_MAP.get(txn_type.get_text(strip=True), txn_type.get_text(strip=True)),
            'transaction_date': tx_date.get_text(strip=True),
            'owner': owner.get_text(strip=True),
            'amount': amount.get_text(strip=True),
        })
    return trades


def scrape_years(years):
    client = make_session()
    lookup = json.loads((Path(__file__).parent.parent / 'data' / 'senate_lookup.json').read_text())

    all_trades = []
    for year in years:
        filings = list_filings(client, year)
        ptr_filings = [f for f in filings if not f['is_paper']]
        print(f'{year}: {len(filings)} filings ({len(ptr_filings)} parseable, {len(filings) - len(ptr_filings)} scanned/paper)', file=sys.stderr)

        for i, f in enumerate(ptr_filings):
            info = lookup_senator(lookup, f['first_name'], f['last_name'])
            bioguide = info.get('bioguide_id')
            try:
                trades = parse_ptr_page(client, f['url'])
                for t in trades:
                    t['member'] = info.get('name') or f"{f['first_name']} {f['last_name']}".strip()
                    t['office'] = info.get('state', '')
                    t['state'] = info.get('state', '')
                    t['party'] = info.get('party')
                    t['chamber'] = 'Senate'
                    t['ptr_link'] = f['url']
                    t['member_url'] = build_member_url(t['member'], bioguide)
                    t['filed_date'] = f['filing_date']
                    t['days_to_file'] = days_between(t['transaction_date'], f['filing_date'])
                all_trades.extend(trades)
            except Exception as e:
                print(f'  failed {f["url"]}: {e}', file=sys.stderr)
            if (i + 1) % 25 == 0:
                print(f'  {i + 1}/{len(ptr_filings)} filings processed, {len(all_trades)} trades so far', file=sys.stderr)
            time.sleep(DELAY)
    return all_trades


if __name__ == '__main__':
    import datetime
    current_year = datetime.date.today().year
    years = [int(a) for a in sys.argv[1:]] or [current_year - 1, current_year]
    trades = scrape_years(years)

    # Senators can file an amendment that re-states an earlier PTR; the
    # search results list both as separate filings, so an unchanged line
    # gets scraped twice. Collapse exact duplicates (every field matching,
    # not just member+ticker+date) down to one row.
    seen = set()
    deduped = []
    for t in trades:
        key = tuple(t.get(k) for k in ('member', 'ticker', 'transaction_date', 'type', 'amount', 'owner'))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(t)
    print(f'Deduped {len(trades) - len(deduped)} exact-repeat rows (amendment filings restating unchanged lines)', file=sys.stderr)

    out_path = Path(__file__).parent.parent / 'data' / 'senate_trades.json'
    out_path.write_text(json.dumps(deduped, indent=2))
    print(f'Wrote {len(deduped)} trades to {out_path}', file=sys.stderr)
