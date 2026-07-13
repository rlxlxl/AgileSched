#!/usr/bin/env node
const path = require('path')
const {
  parseWeekRange,
  findSheetForDate,
  findCurrentWeek,
  extractYearFromSheetName
} = require('../extensions/agile-sched/lib/week-dates')
const { listSheets, getScheduleIndex } = require('../extensions/agile-sched/lib/schedule-index')

const excelPath =
  process.env.EXCEL_PATH ||
  path.join(__dirname, '..', 'Расписашка РиМ (1).xlsx')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  const testDate = new Date(2026, 6, 13) // 13 July 2026

  const range = parseWeekRange('С 13.07 по 19.07', 2026)
  assert(range, 'parseWeekRange failed')
  assert(range.start.getDate() === 13 && range.start.getMonth() === 6, 'start date')
  assert(range.end.getDate() === 19 && range.end.getMonth() === 6, 'end date')
  assert(dateInRange(testDate, range), '13.07 in range')

  const cross = parseWeekRange('С 29.06 по 04.07', 2026)
  assert(cross && cross.end.getMonth() === 6, 'cross-month end in July')

  const sheets = await listSheets(excelPath)
  const sheet = findSheetForDate(sheets, testDate)
  assert(sheet && sheet.includes('ИЮЛ'), `sheet for July: ${sheet}`)

  const index = await getScheduleIndex(excelPath, sheet)
  const yearHint = extractYearFromSheetName(sheet)
  const week = findCurrentWeek(index.weeks, testDate, yearHint)
  assert(week, 'current week not found')
  assert(week.dates.includes('13.07'), `expected 13.07 week, got ${week.dates}`)

  console.log('OK')
  console.log('  date:', testDate.toISOString().slice(0, 10))
  console.log('  sheet:', sheet)
  console.log('  week:', week.label)
}

function dateInRange(date, range) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return d >= range.start.getTime() && d <= range.end.getTime()
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
