const DEFAULT_RATE = 1
const DEFAULT_LUNCH_MINUTES = 60
const LUNCH_OPTIONS = [0, 30, 45, 60, 90]

function normalizeRate(rate) {
  const n = Number(rate)
  if (n === 0.5) return 0.5
  return 1
}

function normalizeLunchMinutes(value) {
  const n = Number(value)
  if (LUNCH_OPTIONS.indexOf(n) !== -1) return n
  return DEFAULT_LUNCH_MINUTES
}

function normalizeRemindHour(value) {
  const n = Number(value)
  if (Number.isInteger(n) && n >= 0 && n <= 23) return n
  return 9
}

function normalizeRemindWeekday(value) {
  const n = Number(value)
  if (Number.isInteger(n) && n >= 1 && n <= 7) return n
  return 1
}

function normalizeProfile(profile) {
  if (!profile) return null
  return {
    department: profile.department,
    employee: profile.employee,
    sheetName: profile.sheetName,
    rate: normalizeRate(profile.rate),
    lunchMinutes: normalizeLunchMinutes(profile.lunchMinutes),
    remindEnabled:
      profile.remindEnabled === undefined ? true : Boolean(profile.remindEnabled),
    remindHour: normalizeRemindHour(profile.remindHour),
    remindWeekday: normalizeRemindWeekday(profile.remindWeekday),
    lastRemindDate: profile.lastRemindDate || null
  }
}

function formatRateLine(rate) {
  const normalized = normalizeRate(rate)
  const norm = normalized === 0.5 ? 20 : 40
  const label = normalized === 0.5 ? '0,5 (полставки)' : '1 (полная)'
  return 'Ставка: ' + label + ', норма ' + norm + ' ч/нед'
}

function formatLunchLine(lunchMinutes) {
  const minutes = normalizeLunchMinutes(lunchMinutes)
  if (minutes === 0) return 'Обед: нет'
  if (minutes < 60) return 'Обед: ' + minutes + ' мин'
  const hours = minutes / 60
  return 'Обед: ' + hours + ' ч'
}

function lunchLabel(minutes) {
  if (minutes === 0) return 'Без обеда'
  if (minutes < 60) return minutes + ' мин'
  return minutes / 60 + ' ч'
}

module.exports = {
  DEFAULT_RATE,
  DEFAULT_LUNCH_MINUTES,
  LUNCH_OPTIONS,
  normalizeRate,
  normalizeLunchMinutes,
  normalizeRemindHour,
  normalizeRemindWeekday,
  normalizeProfile,
  formatRateLine,
  formatLunchLine,
  lunchLabel
}
