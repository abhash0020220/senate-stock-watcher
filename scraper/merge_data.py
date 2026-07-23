"""Combines House and Senate trade files (each already carrying chamber/
state/party) into the single dataset the frontend reads.
"""
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / 'data'


def merge():
    house = json.loads((DATA_DIR / 'house_trades.json').read_text()) if (DATA_DIR / 'house_trades.json').exists() else []
    senate = json.loads((DATA_DIR / 'senate_trades.json').read_text()) if (DATA_DIR / 'senate_trades.json').exists() else []
    combined = house + senate
    (DATA_DIR / 'transactions.json').write_text(json.dumps(combined, indent=2))
    print(f'Merged {len(house)} House + {len(senate)} Senate = {len(combined)} trades into transactions.json')


if __name__ == '__main__':
    merge()
