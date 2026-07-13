const { DAYS, DAY_SHORT } = require('./constants')
const {
  parseSheet,
  findDayBlock,
  findEmployeeRow,
  cellText
} = require('./excel-parser')
const { parseWeekRange } = require('./week-dates')

function formatWeekDatesLine(datesText, yearHint) {
  const range = parseWeekRange(datesText, yearHint)
  if (!range) {
    const m = String(datesText).match(/(\d{1,2}\.\d{1,2}).*?(\d{1,2}\.\d{1,2})/)
    if (m) return `${m[1]} - ${m[2]}`
    return datesText
  }
  const fmt = (d) =>
    `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  return `${fmt(range.start)} - ${fmt(range.end)}`
}

function slotHours(slot) {
  const m = String(slot).match(/^(\d{1,2}):\d{2}-(\d{1,2}):\d{2}$/)
  if (!m) return null
  return { start: Number(m[1]), end: Number(m[2]) }
}

function isScheduledCell(cell) {
  const text = cellText(cell)
  if (!text) return false
  const n = Number(text)
  if (n === 0.5 || n === 1) return true
  if (text === 'д') return true
  return false
}

function mergeFilledSlots(filledSlots) {
  if (!filledSlots.length) return []

  const ranges = []
  let current = slotHours(filledSlots[0].slot)
  if (!current) return []

  for (let i = 1; i < filledSlots.length; i++) {
    const next = slotHours(filledSlots[i].slot)
    if (!next) continue
    if (next.start === current.end) {
      current.end = next.end
    } else {
      ranges.push({ ...current })
      current = next
    }
  }
  ranges.push({ ...current })
  return ranges
}

function formatHourRange(range) {
  return `${range.start} - ${range.end}`
}

function readDaySchedule(worksheet, dayBlock, employeeName) {
  const row = findEmployeeRow(worksheet, dayBlock, employeeName)
  if (!row) return []

  const filled = []
  for (const slotInfo of dayBlock.timeSlots) {
    const cell = worksheet.getCell(row, slotInfo.col)
    if (isScheduledCell(cell)) {
      filled.push(slotInfo)
    }
  }
  return mergeFilledSlots(filled)
}

async function getEmployeeWeekSchedule(excelPath, sheetName, weekId, employeeName, yearHint) {
  const parsed = await parseSheet(excelPath, sheetName)
  const week = parsed.weeks.find((w) => w.id === weekId)
  if (!week) {
    throw new Error('Неделя не найдена')
  }

  const lines = []
  const weekLine = formatWeekDatesLine(week.dates, yearHint)
  lines.push(`неделя ${weekLine}`)

  for (const day of DAYS) {
    const dayBlock = findDayBlock(parsed.dayBlocks, weekId, day)
    if (!dayBlock) continue

    const ranges = readDaySchedule(parsed.worksheet, dayBlock, employeeName)
    if (!ranges.length) continue

    const short = DAY_SHORT[day] || day
    const times = ranges.map(formatHourRange).join(', ')
    lines.push(`${short} ${times}`)
  }

  if (lines.length === 1) {
    lines.push('(расписание не заполнено)')
  }

  return {
    text: lines.join('\n'),
    employee: employeeName,
    weekLabel: weekLine
  }
}

module.exports = {
  getEmployeeWeekSchedule,
  formatWeekDatesLine,
  mergeFilledSlots,
  isScheduledCell
}
