"""The shop's day. The app counts days in Sri Lanka time, so tests must too: CI runs in UTC, where "today" is a different date for half a day."""
from datetime import datetime
from zoneinfo import ZoneInfo


def today():
    return datetime.now(ZoneInfo('Asia/Colombo')).date()
