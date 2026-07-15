const { DAYS, DAY_SHORT } = require('./constants')
const {
  parseSheet,
  findDayBlock,
  findEmployeeRow
} = require('./excel-parser')
const {
  calculateWeekHours,
  formatHoursReport,
  isScheduledCell,
  mergeFilledSlots,
  formatWeekDatesLine
} = require('./hours-calculator')

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

async function getEmployeeWeekSchedule(
  excelPath,
  sheetName,
  weekId,
  employeeName,
  yearHint,
  options
) {
  const opts = options || {}
  const weekResult = await calculateWeekHours(
    excelPath,
    sheetName,
    weekId,
    employeeName,
    yearHint
  )
  const text = formatHoursReport(weekResult, opts.rate)

  return {
    text: text,
    employee: employeeName,
    weekLabel: weekResult.weekLabel,
    totalHours: weekResult.totalHours,
    days: weekResult.days
  }
}

module.exports = {
  getEmployeeWeekSchedule,
  formatWeekDatesLine,
  mergeFilledSlots,
  isScheduledCell
}
