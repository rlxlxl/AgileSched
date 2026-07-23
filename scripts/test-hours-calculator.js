#!/usr/bin/env node
const assert = require('assert')
const {
  cellWorkHours,
  getWeeklyNorm,
  checkWeeklyNorm,
  formatHoursReport,
  mergeFilledSlots,
  applyLunchToDay,
  applyLunchToWeek
} = require('../extensions/agile-sched/lib/hours-calculator')
const {
  normalizeProfile,
  formatRateLine,
  formatLunchLine
} = require('../extensions/agile-sched/lib/profile')

function cell(value) {
  return { value: value }
}

assert.strictEqual(cellWorkHours(cell('')), 0)
assert.strictEqual(cellWorkHours(cell(0.5)), 0.5)
assert.strictEqual(cellWorkHours(cell(1)), 1)
assert.strictEqual(cellWorkHours(cell('д')), 1)
assert.strictEqual(cellWorkHours(cell('Д')), 1)

assert.strictEqual(getWeeklyNorm(1), 40)
assert.strictEqual(getWeeklyNorm(0.5), 20)

const lunchDay = applyLunchToDay(8, 60)
assert.strictEqual(lunchDay.grossHours, 8)
assert.strictEqual(lunchDay.netHours, 7)
assert.strictEqual(lunchDay.lunchDeducted, 1)

const noWork = applyLunchToDay(0, 60)
assert.strictEqual(noWork.netHours, 0)

const weekNet = applyLunchToWeek(
  {
    weekLabel: '07.07 - 13.07',
    days: [
      { day: 'Понедельник', hours: 9, ranges: [{ start: 9, end: 18 }] },
      { day: 'Вторник', hours: 9, ranges: [{ start: 9, end: 18 }] },
      { day: 'Среда', hours: 9, ranges: [{ start: 9, end: 18 }] },
      { day: 'Четверг', hours: 9, ranges: [{ start: 9, end: 18 }] },
      { day: 'Пятница', hours: 9, ranges: [{ start: 9, end: 18 }] }
    ],
    totalHours: 45
  },
  60
)
assert.strictEqual(weekNet.totalHours, 40)
assert.strictEqual(weekNet.totalGross, 45)

const report = formatHoursReport(
  {
    weekLabel: '07.07 - 13.07',
    days: [
      { day: 'Понедельник', hours: 8, ranges: [{ start: 9, end: 18 }] },
      { day: 'Вторник', hours: 4, ranges: [{ start: 9, end: 13 }] }
    ],
    totalHours: 12
  },
  1,
  60
)
assert(report.includes('нетто') || report.includes('Итого:'))
assert(report.includes('Итого: 10 ч из 40 ч') || report.includes('Итого: 11 ч из 40 ч') === false)
// 8-1 + 4-1 = 10
assert(report.includes('Итого: 10 ч из 40 ч'))
assert(report.includes('Не хватает 30 ч'))

const profile = normalizeProfile({
  department: 'Отдел',
  employee: 'Иванов',
  sheetName: 'Лист'
})
assert.strictEqual(profile.rate, 1)
assert.strictEqual(profile.lunchMinutes, 60)
assert.strictEqual(profile.remindEnabled, true)
assert.strictEqual(profile.remindHour, 9)
assert.strictEqual(profile.remindWeekday, 1)

assert(formatLunchLine(60).includes('1 ч'))
assert(formatLunchLine(0).includes('нет'))
assert(formatRateLine(1).includes('40'))

const merged = mergeFilledSlots([
  { slot: '9:00-10:00' },
  { slot: '10:00-11:00' },
  { slot: '13:00-14:00' }
])
assert.deepStrictEqual(merged, [
  { start: 9, end: 11 },
  { start: 13, end: 14 }
])

const okCheck = checkWeeklyNorm(40, 1)
assert.strictEqual(okCheck.ok, true)

console.log('hours-calculator tests: OK')
