#!/usr/bin/env node
const assert = require('assert')
const { isRussianHoliday, formatDateYmd } = require('../extensions/agile-sched/lib/holidays-ru')
const {
  shouldRunRemindTick,
  buildRemindMessage,
  getMoscowParts
} = require('../extensions/agile-sched/lib/reminders')
const { normalizeProfile } = require('../extensions/agile-sched/lib/profile')

assert.strictEqual(isRussianHoliday(new Date(2026, 0, 1)), true)
assert.strictEqual(isRussianHoliday(new Date(2026, 0, 15)), false)
assert.strictEqual(formatDateYmd(new Date(2026, 6, 21)), '2026-07-21')

const profile = normalizeProfile({
  department: 'Отдел',
  employee: 'Иванов',
  sheetName: 'Лист',
  rate: 1,
  remindEnabled: true,
  remindHour: 9,
  remindWeekday: 1
})

const mondayMorning = {
  weekday: 1,
  hour: 9,
  minute: 2,
  ymd: '2026-07-20'
}
assert.strictEqual(shouldRunRemindTick(profile, mondayMorning), true)

const alreadySent = Object.assign({}, profile, { lastRemindDate: '2026-07-20' })
assert.strictEqual(shouldRunRemindTick(alreadySent, mondayMorning), false)

const disabled = Object.assign({}, profile, { remindEnabled: false })
assert.strictEqual(shouldRunRemindTick(disabled, mondayMorning), false)

const wrongHour = {
  weekday: 1,
  hour: 10,
  minute: 0,
  ymd: '2026-07-20'
}
assert.strictEqual(shouldRunRemindTick(profile, wrongHour), false)

const lateMinute = {
  weekday: 1,
  hour: 9,
  minute: 10,
  ymd: '2026-07-20'
}
assert.strictEqual(shouldRunRemindTick(profile, lateMinute), false)

const msgEmpty = buildRemindMessage({
  reason: 'empty',
  detail: 'расписание не заполнено',
  weekLabel: '07.07 - 13.07'
})
assert(msgEmpty.includes('Нужно заполнить'))
assert(msgEmpty.includes('пусто') || msgEmpty.includes('не заполнено'))

const msgDeficit = buildRemindMessage({
  reason: 'deficit',
  detail: 'не хватает 5 ч до нормы',
  weekLabel: '07.07 - 13.07',
  totalHours: 35,
  norm: 40,
  deficit: 5
})
assert(msgDeficit.includes('35'))
assert(msgDeficit.includes('40'))

const parts = getMoscowParts(new Date('2026-07-20T06:00:00Z'))
assert(parts.ymd)
assert(typeof parts.weekday === 'number')

console.log('reminders tests: OK')
