const MONTH_NAMES = [
  'ЯНВАРЬ',
  'ФЕВРАЛЬ',
  'МАРТ',
  'АПРЕЛЬ',
  'МАЙ',
  'ИЮНЬ',
  'ИЮЛЬ',
  'АВГУСТ',
  'СЕНТЯБРЬ',
  'ОКТЯБРЬ',
  'НОЯБРЬ',
  'ДЕКАБРЬ'
]

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function parseDayMonth(text, year) {
  const match = String(text).trim().match(/^(\d{1,2})\.(\d{1,2})$/)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2]) - 1
  return new Date(year, month, day)
}

/**
 * Parse "С 13.07 по 19.07" into { start, end } Date objects (start of day).
 * yearHint comes from sheet name (e.g. 2026).
 */
function parseWeekRange(datesText, yearHint) {
  const match = String(datesText).trim().match(
    /С\s*(\d{1,2}\.\d{1,2})\s*по\s*(\d{1,2}\.\d{1,2})/i
  )
  if (!match) return null

  const year = Number(yearHint) || new Date().getFullYear()
  let start = parseDayMonth(match[1], year)
  let end = parseDayMonth(match[2], year)
  if (!start || !end) return null

  if (end < start) {
    end = new Date(end.getFullYear() + 1, end.getMonth(), end.getDate())
  }

  return { start: startOfDay(start), end: startOfDay(end) }
}

function extractYearFromSheetName(sheetName) {
  const match = String(sheetName).match(/\b(20\d{2})\b/)
  return match ? Number(match[1]) : new Date().getFullYear()
}

function sheetMatchesDate(sheetName, date) {
  const year = date.getFullYear()
  const monthName = MONTH_NAMES[date.getMonth()]
  const upper = String(sheetName).toUpperCase()
  return upper.includes(String(year)) && upper.includes(monthName)
}

/**
 * Find schedule sheet for a given date (year + month from sheet name).
 */
function findSheetForDate(sheets, date) {
  const d = startOfDay(date)
  const matched = sheets.filter((name) => sheetMatchesDate(name, d))
  if (!matched.length) return null
  // Prefer exact month match; if several, take last (often the active template)
  return matched[matched.length - 1]
}

function dateInRange(date, range) {
  const d = startOfDay(date).getTime()
  return d >= range.start.getTime() && d <= range.end.getTime()
}

/**
 * Find week entry whose date range contains `date`.
 * weeks: [{ id, label, type, dates }, ...]
 */
function findCurrentWeek(weeks, date, yearHint) {
  const d = startOfDay(date)
  for (const week of weeks) {
    const range = parseWeekRange(week.dates, yearHint)
    if (range && dateInRange(d, range)) {
      return week
    }
  }
  return null
}

module.exports = {
  MONTH_NAMES,
  parseWeekRange,
  findSheetForDate,
  findCurrentWeek,
  extractYearFromSheetName,
  sheetMatchesDate
}
