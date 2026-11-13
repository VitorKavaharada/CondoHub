"""Datas das preventivas recorrentes e prazos das preventivas por evento."""

import calendar
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.enums import PreventiveFrequency, PreventiveWindow
from app.manutencao.models import PreventiveMaintenance

DEFAULT_RUN_TIME = time(8, 0)
MONTH_STEP = {
    PreventiveFrequency.monthly: 1,
    PreventiveFrequency.quarterly: 3,
    PreventiveFrequency.semiannual: 6,
    PreventiveFrequency.annual: 12,
}


def add_months(day: date, months: int) -> date:
    """Mesmo dia do mês, limitado ao último dia (31/01 + 1 mês = 28/02)."""
    total = day.month - 1 + months
    year, month = day.year + total // 12, total % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def _occurrence_date(rule: PreventiveMaintenance, k: int) -> date:
    if rule.frequency == PreventiveFrequency.weekly:
        return rule.first_run_date + timedelta(weeks=k)
    return add_months(rule.first_run_date, k * MONTH_STEP[rule.frequency])


def _at(rule: PreventiveMaintenance, day: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, rule.run_time or DEFAULT_RUN_TIME, tz)


def _first_k_near(rule: PreventiveMaintenance, day: date) -> int:
    """Índice de uma ocorrência um pouco antes de `day`, para não iterar desde a primeira data."""
    if day <= rule.first_run_date:
        return 0
    if rule.frequency == PreventiveFrequency.weekly:
        return max(0, (day - rule.first_run_date).days // 7 - 1)
    months = (day.year - rule.first_run_date.year) * 12 + day.month - rule.first_run_date.month
    return max(0, months // MONTH_STEP[rule.frequency] - 1)


def occurrences_between(rule: PreventiveMaintenance, tz: ZoneInfo, start: datetime, end: datetime) -> list[datetime]:
    """Ocorrências em [start, end)."""
    result = []
    k = _first_k_near(rule, start.astimezone(tz).date())
    while (when := _at(rule, _occurrence_date(rule, k), tz)) < end:
        if when >= start:
            result.append(when)
        k += 1
    return result


def next_occurrence(rule: PreventiveMaintenance, tz: ZoneInfo, after: datetime, inclusive: bool = True) -> datetime:
    k = _first_k_near(rule, after.astimezone(tz).date())
    while True:
        when = _at(rule, _occurrence_date(rule, k), tz)
        if when > after or (inclusive and when == after):
            return when
        k += 1


def event_due_at(window: PreventiveWindow, event_at: datetime, tz: ZoneInfo) -> datetime:
    if window == PreventiveWindow.within_2h:
        return event_at + timedelta(hours=2)
    if window == PreventiveWindow.within_4h:
        return event_at + timedelta(hours=4)
    return datetime.combine(event_at.astimezone(tz).date() + timedelta(days=1), time(10, 0), tz)
