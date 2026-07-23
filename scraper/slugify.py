"""Builds the name-slug congress.gov uses in its member profile URLs, e.g.
https://www.congress.gov/member/april-mcclain-delaney/M001232 — confirmed
against the House Clerk's own data: official-name "April McClain Delaney"
+ bioguideID "M001232" produces exactly that slug (lowercased, spaces to
hyphens). Used for both House and Senate members since the pattern is
just derived from the person's full display name.
"""
import re


def name_slug(full_name):
    if not full_name:
        return ''
    s = full_name.lower()
    s = s.replace("'", '').replace('.', '').replace(',', '')
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'\s+', '-', s.strip())
    return s


def member_url(full_name, bioguide_id):
    if not bioguide_id:
        return None
    slug = name_slug(full_name) or '_'
    return f'https://www.congress.gov/member/{slug}/{bioguide_id}'
