#!/usr/bin/env node
const assert = require('assert')
const {
  parseFreeformSchedule,
  formatFreeformPreview,
  mapRangeToSlots,
  parseClock
} = require('../extensions/agile-sched/lib/freeform-schedule')
const { TIME_SLOTS } = require('../extensions/agile-sched/lib/constants')

const ok = parseFreeformSchedule('Пн 9:00-18:00, Вт 10:00-19:00, Ср 9-18', TIME_SLOTS)
assert.strictEqual(ok.ok, true)
assert.strictEqual(ok.entries.length, 3)
assert.strictEqual(ok.entries[0].day, 'Понедельник')
assert.strictEqual(ok.entries[0].startTime, '9:00-10:00')
assert.strictEqual(ok.entries[0].endTime, '17:00-18:00')
assert.strictEqual(ok.entries[1].day, 'Вторник')
assert.strictEqual(ok.entries[1].startTime, '10:00-11:00')
assert.strictEqual(ok.entries[1].endTime, '18:00-19:00')

const preview = formatFreeformPreview(ok.entries)
assert(preview.includes('пн'))
assert(preview.includes('слоты'))

const bad = parseFreeformSchedule('hello world', TIME_SLOTS)
assert.strictEqual(bad.ok, false)
assert(bad.error.includes('Не разобрал') || bad.error.includes('Пример'))

const empty = parseFreeformSchedule('', TIME_SLOTS)
assert.strictEqual(empty.ok, false)

const dup = parseFreeformSchedule('Пн 9-18, пн 10-19', TIME_SLOTS)
assert.strictEqual(dup.ok, false)

const clock = parseClock('9:00')
assert.deepStrictEqual(clock, { hour: 9, minute: 0 })

const mapped = mapRangeToSlots(
  { hour: 9, minute: 0 },
  { hour: 18, minute: 0 },
  TIME_SLOTS
)
assert.strictEqual(mapped.ok, true)
assert.strictEqual(mapped.startTime, '9:00-10:00')
assert.strictEqual(mapped.endTime, '17:00-18:00')

console.log('freeform-schedule tests: OK')
