"""Personal life sources, local and in READ-ONLY mode.

- Calendar: private iCal address (Google Calendar → Settings → "Secret address in iCal format"; also
  iCloud/Outlook publish .ics). Stored in the secret section of the vault because it gives read access.
- Apple Reminders: read-only AppleScript, ONLY when you press the button (macOS will ask for permission for
  Cage to control "Reminders": System Settings → Privacy & Security → Automation).
- Health: the file exported by the iPhone Health app (Profile → Export All Health Data → export.zip),
  placed in Downloads. Read in streaming mode and only daily summaries are saved.
"""
from __future__ import annotations

import datetime as dt
import re
import subprocess
import zipfile
from pathlib import Path

# ---------------------------------------------------------------- calendar (.ics)
def _unfold(text: str) -> list[str]:
    out = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if line[:1] in (" ", "\t") and out:
            out[-1] += line[1:]
        else:
            out.append(line)
    return out


def _parse_dt(v: str, params: str) -> tuple[dt.datetime, bool]:
    v = v.strip()
    if "VALUE=DATE" in params or re.fullmatch(r"\d{8}", v):
        return dt.datetime.strptime(v[:8], "%Y%m%d"), True
    utc = v.endswith("Z")
    d = dt.datetime.strptime(v.rstrip("Z")[:15], "%Y%m%dT%H%M%S")
    if utc:
        d = d.replace(tzinfo=dt.timezone.utc).astimezone().replace(tzinfo=None)  # to local Mac time
    return d, False


def parse_ics(text: str, days: int = 45, now: dt.datetime | None = None) -> list[dict]:
    now = now or dt.datetime.now()
    end = now + dt.timedelta(days=days)
    events, cur = [], None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT" and cur is not None:
            events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            k, v = line.split(":", 1)
            name, _, params = k.partition(";")
            cur[name] = (v, params)
    out = []
    for e in events:
        if "DTSTART" not in e:
            continue
        try:
            start, allday = _parse_dt(*e["DTSTART"])
            fin = _parse_dt(*e["DTEND"])[0] if "DTEND" in e else start + dt.timedelta(hours=0 if allday else 1)
        except ValueError:
            continue
        title = e.get("SUMMARY", ("(untitled)", ""))[0].replace("\\,", ",").replace("\\n", " ")[:160]
        loc = e.get("LOCATION", ("", ""))[0].replace("\\,", ",")[:120]
        for s in _expand(start, e.get("RRULE", ("", ""))[0], now - dt.timedelta(days=1), end):
            out.append({"start": s.isoformat(timespec="minutes"), "end": (s + (fin - start)).isoformat(timespec="minutes"),
                        "allday": allday, "title": title, "where": loc})
    return sorted(out, key=lambda x: x["start"])[:300]


def _expand(start, rrule, lo, hi):
    if not rrule:
        return [start] if lo <= start <= hi else []
    r = dict(p.split("=", 1) for p in rrule.split(";") if "=" in p)
    step = {"DAILY": dt.timedelta(days=1), "WEEKLY": dt.timedelta(weeks=1)}.get(r.get("FREQ"))
    inter = int(r.get("INTERVAL", 1))
    count = int(r["COUNT"]) if "COUNT" in r else None
    until = None
    if "UNTIL" in r:
        try:
            until = _parse_dt(r["UNTIL"], "")[0]
        except ValueError:
            pass
    out, s, k = [], start, 0
    while s <= hi and (count is None or k < count) and (until is None or s <= until) and k < 2000:
        if s >= lo:
            out.append(s)
        k += 1
        if step:
            s = start + step * inter * k
        elif r.get("FREQ") == "MONTHLY":
            m = start.month - 1 + inter * k
            try:
                s = start.replace(year=start.year + m // 12, month=m % 12 + 1)
            except ValueError:
                s = start.replace(year=start.year + m // 12, month=m % 12 + 1, day=28)
        elif r.get("FREQ") == "YEARLY":
            try:
                s = start.replace(year=start.year + inter * k)
            except ValueError:
                s = start.replace(year=start.year + inter * k, day=28)
        else:
            break
    return out


def fetch_ics(url: str) -> str:
    if not re.match(r"^(https|webcal)://", url):
        raise ValueError("calendar URL must start with https:// or webcal://")
    url = "https://" + url.split("://", 1)[1]
    out = subprocess.run(["curl", "-sS", "--fail", "-L", "--max-redirs", "3", "--max-time", "25", "--max-filesize", "20000000", url],
                         capture_output=True, timeout=35)
    if out.returncode != 0 or b"BEGIN:VCALENDAR" not in out.stdout[:2000]:
        raise ValueError("could not read calendar: check that the iCal URL is the private one and is complete")
    return out.stdout.decode("utf-8", "replace")


# ---------------------------------------------------------------- Apple Reminders (read-only, on-demand)
SCRIPT = '''set out to ""
tell application "Reminders"
  repeat with r in (reminders whose completed is false)
    set d to ""
    try
      set d to (due date of r) as «class isot» as string
    end try
    set out to out & (name of r) & "\t" & d & "\t" & (name of container of r) & linefeed
  end repeat
end tell
return out'''


def reminders(timeout: int = 40) -> list[dict]:
    try:
        r = subprocess.run(["osascript", "-e", SCRIPT], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ValueError("Reminders did not respond: if macOS asked for permission, accept it and try again") from None
    if r.returncode != 0:
        if "-1743" in r.stderr or "not allowed" in r.stderr.lower() or "no está autorizado" in r.stderr.lower():
            raise ValueError("macOS does not allow Cage to read Reminders. Enable it in System Settings → Privacy & Security → "
                             "Automation → (Python or Cage) → Reminders.")
        raise ValueError("could not read Reminders")
    out = []
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if parts and parts[0].strip():
            out.append({"title": parts[0][:160], "due": (parts[1][:16] if len(parts) > 1 else "") or None, "list": parts[2][:60] if len(parts) > 2 else ""})
    return out[:300]


# ---------------------------------------------------------------- Health (iPhone export.zip)
WANT = {"HKQuantityTypeIdentifierStepCount": "steps", "HKQuantityTypeIdentifierActiveEnergyBurned": "kcal",
        "HKQuantityTypeIdentifierRestingHeartRate": "rhr", "HKQuantityTypeIdentifierBodyMass": "kg",
        "HKQuantityTypeIdentifierDistanceWalkingRunning": "km"}
SLEEP = "HKCategoryTypeIdentifierSleepAnalysis"
ASLEEP = ("HKCategoryValueSleepAnalysisAsleep", "HKCategoryValueSleepAnalysisAsleepCore", "HKCategoryValueSleepAnalysisAsleepDeep",
          "HKCategoryValueSleepAnalysisAsleepREM", "HKCategoryValueSleepAnalysisAsleepUnspecified")


def find_export(folder: Path | None = None) -> Path | None:
    folder = folder or Path.home() / "Downloads"
    c = sorted([p for p in folder.glob("*.zip") if re.search(r"export|exportar|salud|health", p.name, re.I)],
               key=lambda p: p.stat().st_mtime, reverse=True)
    return c[0] if c else None


def import_health(path: Path, days: int = 400) -> dict:
    """Daily summaries for the last `days` days. Streams the XML (can weigh hundreds of MB)."""
    import xml.etree.ElementTree as ET
    since = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    daily: dict[str, dict] = {}
    rhr: dict[str, list] = {}
    sleep: dict[tuple, float] = {}
    with zipfile.ZipFile(path) as z:
        name = next((n for n in z.namelist() if n.endswith("export.xml") and "cda" not in n.lower()), None)
        if not name:
            raise ValueError("the zip does not contain Health app export.xml")
        with z.open(name) as f:
            for _, el in ET.iterparse(f, events=("end",)):
                if el.tag != "Record":
                    if el.tag not in ("HealthData",):
                        el.clear()
                    continue
                t, start = el.get("type"), (el.get("startDate") or "")[:10]
                if start >= since:
                    key = WANT.get(t)
                    if key:
                        try:
                            v = float(el.get("value") or 0)
                        except ValueError:
                            v = 0.0
                        if key == "kg" and el.get("unit") == "lb":
                            v *= 0.45359237
                        if key == "km" and el.get("unit") == "mi":
                            v *= 1.609344
                        day = daily.setdefault(start, {})
                        if key == "rhr":
                            rhr.setdefault(start, []).append(v)
                        elif key == "kg":
                            day["kg"] = round(v, 1)
                        else:
                            day[key] = day.get(key, 0) + v
                    elif t == SLEEP and el.get("value") in ASLEEP:
                        try:
                            a = dt.datetime.strptime(el.get("startDate")[:19], "%Y-%m-%d %H:%M:%S")
                            b = dt.datetime.strptime(el.get("endDate")[:19], "%Y-%m-%d %H:%M:%S")
                        except (TypeError, ValueError):
                            a = b = None
                        if a and b:
                            night = b.date().isoformat()  # the night counts towards the day you wake up
                            k = (night, el.get("sourceName") or "")  # watch and phone record the same: summed per source
                            sleep[k] = sleep.get(k, 0) + (b - a).total_seconds() / 3600
                el.clear()
    for (night, _src), h in sleep.items():  # and the source with the most recorded hours is kept
        if h <= 16:
            daily.setdefault(night, {})["sleep_h"] = max(daily.get(night, {}).get("sleep_h", 0), h)
    for d, xs in rhr.items():
        daily.setdefault(d, {})["rhr"] = round(sum(xs) / len(xs))
    for d, v in daily.items():
        for k in ("steps", "kcal"):
            if k in v:
                v[k] = round(v[k])
        for k in ("km", "sleep_h"):
            if k in v:
                v[k] = round(v[k], 2)
    return {"file": path.name, "imported": dt.datetime.now().isoformat(timespec="minutes"), "days": dict(sorted(daily.items()))}
