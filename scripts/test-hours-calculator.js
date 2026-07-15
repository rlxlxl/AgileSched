#!/usr/bin/env node
const assert = require('assert')
const {
  cellWorkHours,
  getWeeklyNorm,
  checkWeeklyNorm,
  formatHoursReport,
  mergeFilledSlots
} = require('../extensions/agile-sched/lib/hours-calculator')
const { normalizeProfile, formatRateLine } = require('../extensions/agile-sched/lib/profile')

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
assert.strictEqual(getWeeklyNorm(undefined), 40)

const okCheck = checkWeeklyNorm(40, 1)
assert.strictEqual(okCheck.ok, true)
assert.strictEqual(okCheck.deficit, 0)

const lowCheck = checkWeeklyNorm(12, 1)
assert.strictEqual(lowCheck.ok, false)
assert.strictEqual(lowCheck.norm, 40)
assert.strictEqual(lowCheck.deficit, 28)

const halfCheck = checkWeeklyNorm(15, 0.5)
assert.strictEqual(halfCheck.norm, 20)
assert.strictEqual(halfCheck.deficit, 5)

const merged = mergeFilledSlots([
  { slot: '9:00-10:00' },
  { slot: '10:00-11:00' },
  { slot: '13:00-14:00' }
])
assert.deepStrictEqual(merged, [
  { start: 9, end: 11 },
  { start: 13, end: 14 }
])

const report = formatHoursReport(
  {
    weekLabel: '07.07 - 13.07',
    days: [
      { day: 'Понедельник', hours: 8, ranges: [{ start: 9, end: 18 }] },
      { day: 'Вторник', hours: 4, ranges: [{ start: 9, end: 13 }] }
    ],
    totalHours: 12
  },
  1
)
assert(report.includes('Итого: 12 ч из 40 ч'))
assert(report.includes('Не хватает 28 ч'))

const profile = normalizeProfile({
  department: 'Отдел',
  employee: 'Иванов',
  sheetName: 'Лист'
})
assert.strictEqual(profile.rate, 1)

const halfProfile = normalizeProfile({
  department: 'Отдел',
  employee: 'Петров',
  sheetName: 'Лист',
  rate: 0.5
})
assert.strictEqual(halfProfile.rate, 0.5)

assert(formatRateLine(1).includes('40'))
assert(formatRateLine(0.5).includes('20'))

console.log('hours-calculator tests: OK')
