"""Builds data/member_parties.json — a district-code -> party/name lookup,
sourced from the House Clerk's own member directory (free, public, no key).
Used to join party affiliation onto trades, which the PTR filings
themselves never mention.
"""
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

URL = 'https://clerk.house.gov/xml/lists/MemberData.xml'


def build():
    resp = requests.get(URL, headers={'User-Agent': 'Mozilla/5.0'}, timeout=30)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)

    lookup = {}
    for m in root.iter('member'):
        sd = m.find('statedistrict')
        info = m.find('member-info')
        if sd is None or info is None:
            continue
        party = info.find('party')
        name = info.find('official-name')
        bioguide = info.find('bioguideID')
        lookup[sd.text] = {
            'party': party.text if party is not None else None,
            'name': name.text if name is not None else None,
            'bioguide_id': bioguide.text if bioguide is not None else None,
        }

    out_path = Path(__file__).parent.parent / 'data' / 'member_parties.json'
    out_path.write_text(json.dumps(lookup, indent=2))
    print(f'Wrote {len(lookup)} members to {out_path}')


if __name__ == '__main__':
    build()
