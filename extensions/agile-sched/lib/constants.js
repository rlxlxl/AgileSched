const DAYS = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота'
]

const DAY_SHORT = {
  Понедельник: 'пн',
  Вторник: 'вт',
  Среда: 'ср',
  Четверг: 'чт',
  Пятница: 'пт',
  Суббота: 'сб'
}

const WORK_TYPES = {
  semi: {
    id: 'semi',
    label: 'Полуочно (0,5ч)',
    emoji: '🟢',
    value: 0.5,
    color: 'FF41DD88'
  },
  office: {
    id: 'office',
    label: 'Очно',
    emoji: '🟩',
    value: 1.0,
    color: 'FF00B050'
  },
  remote: {
    id: 'remote',
    label: 'Дистанционно',
    emoji: '🟧',
    // Letter marks remote; color alone is unreliable in Sheets/viewers.
    value: 'Д',
    color: 'FFFF6D01'
  }
}

const TIME_SLOTS = [
  '6:00-7:00',
  '7:00-8:00',
  '8:00-9:00',
  '9:00-10:00',
  '10:00-11:00',
  '11:00-12:00',
  '12:00-13:00',
  '13:00-14:00',
  '14:00-15:00',
  '15:00-16:00',
  '16:00-17:00',
  '17:00-18:00',
  '18:00-19:00',
  '19:00-20:00',
  '20:00-21:00',
  '21:00-22:00'
]

const WEEK_TYPES = ['Нечетная', 'Четная']

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ')
}

function isDepartment(name) {
  return normalizeName(name).startsWith('Отдел')
}

function isDayName(name) {
  return DAYS.includes(normalizeName(name))
}

function isWeekMarker(name) {
  return WEEK_TYPES.includes(normalizeName(name))
}

function isTimeSlot(value) {
  return typeof value === 'string' && /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(value.trim())
}

function sheetFilter(name) {
  return name.includes('Расписашка') && !name.includes('стендап') && name !== 'Стендапы'
}

module.exports = {
  DAYS,
  DAY_SHORT,
  WORK_TYPES,
  TIME_SLOTS,
  WEEK_TYPES,
  normalizeName,
  isDepartment,
  isDayName,
  isWeekMarker,
  isTimeSlot,
  sheetFilter
}
