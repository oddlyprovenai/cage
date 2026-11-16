"""Calendar .ics (with recurring events) and Health app import (streaming, no sleep double-counting)."""
from __future__ import annotations

import datetime as dt
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lifesrc  # noqa: E402

ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20261113T090000
DTEND:20261113T100000
SUMMARY:Gimnasio
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261120
SUMMARY:Cumpleaños\\, Marta
END:VEVENT
BEGIN:VEVENT
DTSTART:20200101T090000
SUMMARY:Viejo
END:VEVENT
END:VCALENDAR"""


def test_ics_expands_and_filters():
    ev = lifesrc.parse_ics(ICS, days=30, now=dt.datetime(2026, 11, 12))
    gym = [e for e in ev if e["title"] == "Gimnasio"]
    assert [e["start"][:10] for e in gym] == ["2026-11-13", "2026-11-20", "2026-11-27"]
    assert any(e["title"] == "Cumpleaños, Marta" and e["allday"] for e in ev)
    assert not any(e["title"] == "Viejo" for e in ev)


def test_health_import(tmp_path):
    today = dt.date.today().isoformat()
    xml = f"""<?xml version="1.0"?><HealthData>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" value="4000" startDate="{today} 09:00:00 +0100" endDate="{today} 10:00:00 +0100"/>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" value="3500" startDate="{today} 18:00:00 +0100" endDate="{today} 19:00:00 +0100"/>
<Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Báscula" unit="kg" value="72.4" startDate="{today} 08:00:00 +0100" endDate="{today} 08:00:00 +0100"/>
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="{today} 00:00:00 +0100" endDate="{today} 07:00:00 +0100"/>
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="iPhone" value="HKCategoryValueSleepAnalysisAsleepUnspecified" startDate="{today} 00:30:00 +0100" endDate="{today} 06:30:00 +0100"/>
</HealthData>"""
    z = tmp_path / "export.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("apple_health_export/export.xml", xml)
    assert lifesrc.find_export(tmp_path) == z
    d = lifesrc.import_health(z)["days"][today]
    assert d["steps"] == 7500 and d["kg"] == 72.4 and d["sleep_h"] == 7.0  # sueño: la fuente con más horas, sin sumar las dos
