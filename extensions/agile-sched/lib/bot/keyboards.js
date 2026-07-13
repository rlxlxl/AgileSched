const { Markup } = require('telegraf')
const { DAYS, DAY_SHORT, WORK_TYPES, TIME_SLOTS } = require('../constants')

function chunkButtons(items, perRow = 2) {
  const rows = []
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow))
  }
  return rows
}

function listKeyboard(items, prefix) {
  const buttons = items.map((item) =>
    Markup.button.callback(item.label, `${prefix}:${item.id}`)
  )
  return Markup.inlineKeyboard(chunkButtons(buttons, 1))
}

function sheetKeyboard(sheets) {
  return listKeyboard(
    sheets.map((name) => ({ id: name, label: name })),
    'sheet'
  )
}

function weekKeyboard(weeks) {
  return listKeyboard(
    weeks.map((week) => ({ id: week.id, label: week.label })),
    'week'
  )
}

function departmentKeyboard(departments) {
  return listKeyboard(
    departments.map((dept, index) => ({
      id: String(index),
      label: dept.name
    })),
    'dept'
  )
}

function employeeKeyboard(employees) {
  return listKeyboard(
    employees.map((name, index) => ({
      id: String(index),
      label: name
    })),
    'emp'
  )
}

function dayKeyboard(prefix, days = DAYS) {
  const buttons = days.map((day) =>
    Markup.button.callback(DAY_SHORT[day] || day, `${prefix}:${day}`)
  )
  return Markup.inlineKeyboard(chunkButtons(buttons, 3))
}

function timeKeyboard(prefix, slots = TIME_SLOTS) {
  const buttons = slots.map((slot) =>
    Markup.button.callback(slot, `${prefix}:${slot}`)
  )
  return Markup.inlineKeyboard(chunkButtons(buttons, 2))
}

function workTypeKeyboard() {
  const buttons = Object.values(WORK_TYPES).map((type) =>
    Markup.button.callback(`${type.emoji} ${type.label}`, `work:${type.id}`)
  )
  return Markup.inlineKeyboard(chunkButtons(buttons, 1))
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Сохранить', 'confirm:save')],
    [Markup.button.callback('❌ Отмена', 'confirm:cancel')]
  ])
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📅 Заполнить расписание', 'menu:schedule')],
    [Markup.button.callback('📋 Показать расписание', 'menu:view')],
    [Markup.button.callback('👤 Привязать профиль (/my)', 'menu:profile')]
  ])
}

module.exports = {
  sheetKeyboard,
  weekKeyboard,
  departmentKeyboard,
  employeeKeyboard,
  dayKeyboard,
  timeKeyboard,
  workTypeKeyboard,
  confirmKeyboard,
  mainMenuKeyboard
}
