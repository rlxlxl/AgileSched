const { DAYS, DAY_SHORT } = require('./constants')
const {
  parseSheet,
  findDayBlock,
  findEmployeeRow,
  cellText
} = require('./excel-parser')
const { normalizeRate, normalizeLunchMinutes } = require('./profile')
const { parseWeekRange } = require('./week-dates')

function slotHours(slot) {
  const m = String(slot).match(/^(\d{1,2}):\d{2}-(\d{1,2}):\d{2}$/)
  if (!m) return null
  return { start: Number(m[1]), end: Number(m[2]) }
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
      ranges.push({ start: current.start, end: current.end })
      current = next
    }
  }
  ranges.push({ start: current.start, end: current.end })
  return ranges
}

function cellWorkHours(cell) {
  const text = cellText(cell)
  if (!text) return 0
  const lower = text.toLowerCase()
  if (lower === 'д') return 1
  const n = Number(text)
  if (n === 0.5) return 0.5
  if (n === 1) return 1
  return 0
}

function isScheduledCell(cell) {
  return cellWorkHours(cell) > 0
}

function formatHourRange(range) {
  return range.start + ' - ' + range.end
}

function lunchHoursFromMinutes(lunchMinutes) {
  return normalizeLunchMinutes(lunchMinutes) / 60
}

function applyLunchToDay(grossHours, lunchMinutes) {
  if (!grossHours || grossHours <= 0) {
    return { grossHours: 0, netHours: 0, lunchDeducted: 0 }
  }
  const lunch = lunchHoursFromMinutes(lunchMinutes)
  const deducted = Math.min(grossHours, lunch)
  return {
    grossHours: grossHours,
    netHours: Math.max(0, grossHours - deducted),
    lunchDeducted: deducted
  }
}

function applyLunchToWeek(weekResult, lunchMinutes) {
  const days = (weekResult.days || []).map(function (dayEntry) {
    const lunch = applyLunchToDay(dayEntry.hours, lunchMinutes)
    return Object.assign({}, dayEntry, {
      grossHours: lunch.grossHours,
      netHours: lunch.netHours,
      lunchDeducted: lunch.lunchDeducted,
      hours: lunch.netHours
    })
  })
  const totalGross = days.reduce(function (sum, d) {
    return sum + (d.grossHours || 0)
  }, 0)
  const totalHours = days.reduce(function (sum, d) {
    return sum + (d.netHours || 0)
  }, 0)
  return Object.assign({}, weekResult, {
    days: days,
    totalGross: totalGross,
    totalHours: totalHours,
    lunchMinutes: normalizeLunchMinutes(lunchMinutes)
  })
}

function calculateDayHours(worksheet, dayBlock, employeeName) {
  const row = findEmployeeRow(worksheet, dayBlock, employeeName)
  if (!row) {
    return { hours: 0, ranges: [] }
  }

  const filled = []
  let hours = 0
  for (const slotInfo of dayBlock.timeSlots) {
    const cell = worksheet.getCell(row, slotInfo.col)
    const slotH = cellWorkHours(cell)
    if (slotH > 0) {
      hours += slotH
      filled.push(slotInfo)
    }
  }

  return {
    hours: hours,
    ranges: mergeFilledSlots(filled)
  }
}

function formatWeekDatesLine(datesText, yearHint) {
  const range = parseWeekRange(datesText, yearHint)
  if (!range) {
    const m = String(datesText).match(/(\d{1,2}\.\d{1,2}).*?(\d{1,2}\.\d{1,2})/)
    if (m) return m[1] + ' - ' + m[2]
    return datesText
  }
  const fmt = function (d) {
    return (
      String(d.getDate()).padStart(2, '0') +
      '.' +
      String(d.getMonth() + 1).padStart(2, '0')
    )
  }
  return fmt(range.start) + ' - ' + fmt(range.end)
}

async function calculateWeekHours(excelPath, sheetName, weekId, employeeName, yearHint) {
  const parsed = await parseSheet(excelPath, sheetName)
  const week = parsed.weeks.find(function (w) {
    return w.id === weekId
  })
  if (!week) {
    throw new Error('Неделя не найдена')
  }

  const days = []
  let totalHours = 0

  for (const day of DAYS) {
    const dayBlock = findDayBlock(parsed.dayBlocks, weekId, day)
    if (!dayBlock) continue

    const dayResult = calculateDayHours(parsed.worksheet, dayBlock, employeeName)
    if (!dayResult.hours && !dayResult.ranges.length) continue

    totalHours += dayResult.hours
    days.push({
      day: day,
      hours: dayResult.hours,
      ranges: dayResult.ranges
    })
  }

  return {
    weekLabel: formatWeekDatesLine(week.dates, yearHint),
    days: days,
    totalHours: totalHours,
    employee: employeeName
  }
}

function getWeeklyNorm(rate) {
  return normalizeRate(rate) === 0.5 ? 20 : 40
}

function checkWeeklyNorm(totalHours, rate) {
  const norm = getWeeklyNorm(rate)
  const total = Number(totalHours) || 0
  const deficit = norm - total
  return {
    ok: total >= norm,
    norm: norm,
    totalHours: total,
    deficit: deficit > 0 ? deficit : 0
  }
}

function formatDayLine(dayEntry) {
  const short = DAY_SHORT[dayEntry.day] || dayEntry.day
  const times = dayEntry.ranges.map(formatHourRange).join(', ')
  const net =
    dayEntry.netHours != null ? dayEntry.netHours : dayEntry.hours
  const gross =
    dayEntry.grossHours != null ? dayEntry.grossHours : dayEntry.hours
  if (
    dayEntry.lunchDeducted != null &&
    dayEntry.lunchDeducted > 0 &&
    gross !== net
  ) {
    return short + ' ' + times + ' (' + net + ' ч нетто)'
  }
  return short + ' ' + times + ' (' + net + ' ч)'
}

function formatHoursReport(weekResult, rate, lunchMinutes) {
  const withLunch =
    lunchMinutes == null
      ? weekResult
      : applyLunchToWeek(weekResult, lunchMinutes)

  const lines = []
  if (withLunch.weekLabel) {
    lines.push('неделя ' + withLunch.weekLabel)
  }

  if (!withLunch.days.length) {
    lines.push('(расписание не заполнено)')
  } else {
    for (const dayEntry of withLunch.days) {
      lines.push(formatDayLine(dayEntry))
    }
  }

  const total = withLunch.totalHours || 0
  if (rate != null) {
    const check = checkWeeklyNorm(total, rate)
    lines.push('Итого: ' + total + ' ч из ' + check.norm + ' ч')
    if (lunchMinutes != null && Number(lunchMinutes) > 0) {
      lines.push('(с учётом обеда ' + normalizeLunchMinutes(lunchMinutes) + ' мин/день)')
    }
    if (!check.ok && check.deficit > 0) {
      lines.push('⚠ Не хватает ' + check.deficit + ' ч до нормы')
    }
  } else {
    lines.push('Итого: ' + total + ' ч')
  }

  return lines.join('\n')
}

function formatNormSummary(
  excelPath,
  sheetName,
  weekId,
  employeeName,
  yearHint,
  rate,
  lunchMinutes
) {
  return calculateWeekHours(excelPath, sheetName, weekId, employeeName, yearHint).then(
    function (weekResult) {
      return formatHoursReport(weekResult, rate, lunchMinutes)
    }
  )
}

module.exports = {
  cellWorkHours,
  isScheduledCell,
  calculateDayHours,
  calculateWeekHours,
  getWeeklyNorm,
  checkWeeklyNorm,
  formatHoursReport,
  formatNormSummary,
  formatDayLine,
  mergeFilledSlots,
  formatWeekDatesLine,
  applyLunchToDay,
  applyLunchToWeek,
  lunchHoursFromMinutes
}
