"""Builds a lastname -> [{party, state, name, first_name}] lookup for
sitting senators, sourced from the Senate's own public contact-info XML
(free, public, no key). Keyed by last name only, not full name — PTR
filings from efdsearch.senate.gov use each senator's *legal* first name
(e.g. "Rafael E Cruz", "A. Mitchell McConnell, Jr.", "Thomas H Tuberville"),
which very often doesn't match the commonly-known name this roster uses
("Ted Cruz", "Mitch McConnell", "Tommy Tuberville") — so first-name
matching drops ~40% of joins. Last name is far more stable; the one
collision among current senators (two Sen. Scotts) gets disambiguated by
first initial at join time in scrape_senate.py.
"""
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

URL = 'https://www.senate.gov/general/contact_information/senators_cfm.xml'


def norm(s):
    return re.sub(r'\s+', ' ', (s or '')).strip().lower()


def build():
    resp = requests.get(URL, headers={'User-Agent': 'Mozilla/5.0'}, timeout=30)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)

    lookup = {}
    for m in root.iter('member'):
        last = m.find('last_name')
        first = m.find('first_name')
        party = m.find('party')
        state = m.find('state')
        bioguide = m.find('bioguide_id')
        if last is None or first is None:
            continue
        key = norm(last.text)
        lookup.setdefault(key, []).append({
            'party': party.text if party is not None else None,
            'state': state.text if state is not None else None,
            'name': f'{first.text} {last.text}'.strip(),
            'first_name': first.text or '',
            'bioguide_id': bioguide.text if bioguide is not None else None,
        })

    out_path = Path(__file__).parent.parent / 'data' / 'senate_lookup.json'
    out_path.write_text(json.dumps(lookup, indent=2))
    print(f'Wrote {len(lookup)} senators to {out_path}')


if __name__ == '__main__':
    build()
