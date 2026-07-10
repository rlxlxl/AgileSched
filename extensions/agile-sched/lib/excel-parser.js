const ExcelJS = require('exceljs')
const {
  DAYS,
  normalizeName,
  isDepartment,
  isDayName,
  isWeekMarker,
  isTimeSlot,
  sheetFilter
} = require('./constants')

function cellText(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return ''
  const value = cell.value

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim()
  }

  if (typeof value === 'object') {
    if (value.richText) {
      return value.richText.map((part) => part.text).join('').trim()
    }
    if (value.text != null) {
      return String(value.text).trim()
    }
    if (value.result != null) {
      return String(value.result).trim()
    }
    if (value.sharedFormula || value.formula) {
      return ''
    }
  }

  return String(value).trim()
}

function getMaxColumn(worksheet) {
  let maxCol = 1
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      if (colNumber > maxCol) maxCol = colNumber
    })
  })
  return maxCol
}

/**
 * Weeks are laid out horizontally on the header row:
 *   col 1: Нечетная, col 2: С 29.06..., times in cols 2..17
 *   col 20: Четная,  col 21: С 06.07..., times in cols 21..36
 * Days stay vertical (Понедельник / Вторник / ...), shared across weeks.
 */
function findWeekHeaderRow(worksheet, maxCol) {
  const limit = Math.min(worksheet.rowCount || 50, 50)
  for (let rowNum = 1; rowNum <= limit; rowNum++) {
    for (let col = 1; col <= maxCol; col++) {
      if (isWeekMarker(cellText(worksheet.getCell(rowNum, col)))) {
        return rowNum
      }
    }
  }
  return null
}

function readWeeks(worksheet, weekHeaderRow, maxCol) {
  const weeks = []

  for (let col = 1; col <= maxCol; col++) {
    const type = cellText(worksheet.getCell(weekHeaderRow, col))
    if (!isWeekMarker(type)) continue

    const dates = cellText(worksheet.getCell(weekHeaderRow, col + 1))
    weeks.push({
      id: `${type}|${dates}|c${col}`,
      type,
      dates,
      headerRow: weekHeaderRow,
      markerCol: col,
      datesCol: col + 1
    })
  }

  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i]
    week.startCol = week.datesCol
    week.endCol = weeks[i + 1] ? weeks[i + 1].markerCol - 1 : maxCol
  }

  return weeks
}

function readTimeSlotsInRange(worksheet, timeRow, startCol, endCol) {
  const slots = []
  for (let col = startCol; col <= endCol; col++) {
    const text = cellText(worksheet.getCell(timeRow, col))
    if (isTimeSlot(text)) {
      slots.push({ col, slot: text })
    }
  }
  return slots
}

function findDayRows(worksheet) {
  const dayRows = []
  for (let rowNum = 1; rowNum <= worksheet.rowCount; rowNum++) {
    const a = cellText(worksheet.getCell(rowNum, 1))
    if (isDayName(a)) {
      dayRows.push({
        day: a,
        headerRow: rowNum,
        timeRow: rowNum + 1
      })
    }
  }
  return dayRows
}

function collectDepartments(worksheet, dayRows) {
  const departments = new Map()
  if (!dayRows.length) return departments

  // Employees repeat in every day block — parse the first day block only
  const first = dayRows[0]
  const nextDayRow = dayRows[1] ? dayRows[1].headerRow : worksheet.rowCount + 1
  let currentDept = null

  for (let rowNum = first.timeRow + 1; rowNum < nextDayRow; rowNum++) {
    const a = cellText(worksheet.getCell(rowNum, 1))
    if (!a) continue

    if (isDepartment(a)) {
      currentDept = normalizeName(a)
      if (!departments.has(currentDept)) {
        departments.set(currentDept, [])
      }
      continue
    }

    if (currentDept && !isTimeSlot(a) && !a.startsWith('С ') && !isWeekMarker(a) && !isDayName(a)) {
      const employee = normalizeName(a)
      const list = departments.get(currentDept)
      if (!list.includes(employee)) {
        list.push(employee)
      }
    }
  }

  return departments
}

function scanSheetStructure(worksheet) {
  const maxCol = getMaxColumn(worksheet)
  const weekHeaderRow = findWeekHeaderRow(worksheet, maxCol)
  if (!weekHeaderRow) {
    return { weeks: [], dayBlocks: [], departments: new Map() }
  }

  const weeks = readWeeks(worksheet, weekHeaderRow, maxCol)
  const dayRows = findDayRows(worksheet)
  const dayBlocks = []

  for (const week of weeks) {
    for (const dayRow of dayRows) {
      const timeSlots = readTimeSlotsInRange(
        worksheet,
        dayRow.timeRow,
        week.startCol,
        week.endCol
      )
      dayBlocks.push({
        id: `${week.id}|${dayRow.day}`,
        weekId: week.id,
        day: dayRow.day,
        headerRow: dayRow.headerRow,
        timeRow: dayRow.timeRow,
        startCol: week.startCol,
        endCol: week.endCol,
        timeSlots
      })
    }
  }

  const departments = collectDepartments(worksheet, dayRows)
  return { weeks, dayBlocks, departments }
}

function findEmployeeRow(worksheet, dayBlock, employeeName) {
  const target = normalizeName(employeeName)
  const startRow = dayBlock.timeRow + 1
  let rowNum = startRow

  while (rowNum <= worksheet.rowCount) {
    const a = cellText(worksheet.getCell(rowNum, 1))
    if (!a) {
      rowNum++
      continue
    }
    if (isDayName(a) || isWeekMarker(a)) break
    if (normalizeName(a) === target) {
      return rowNum
    }
    rowNum++
  }

  return null
}

function findDayBlock(dayBlocks, weekId, dayName) {
  return dayBlocks.find((block) => block.weekId === weekId && block.day === dayName) || null
}

function getSlotsInRange(timeSlots, startSlot, endSlot) {
  const startIdx = timeSlots.findIndex((item) => item.slot === startSlot)
  const endIdx = timeSlots.findIndex((item) => item.slot === endSlot)
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`Некорректный диапазон времени: ${startSlot} — ${endSlot}`)
  }
  return timeSlots.slice(startIdx, endIdx + 1)
}

function getDaysInRange(startDay, endDay) {
  const startIdx = DAYS.indexOf(startDay)
  const endIdx = DAYS.indexOf(endDay)
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`Некорректный диапазон дней: ${startDay} — ${endDay}`)
  }
  return DAYS.slice(startIdx, endIdx + 1)
}

async function loadWorkbook(excelPath) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(excelPath)
  return workbook
}

function listScheduleSheets(workbook) {
  return workbook.worksheets
    .filter((ws) => sheetFilter(ws.name))
    .map((ws) => ws.name)
}

async function parseSheet(excelPath, sheetName) {
  const workbook = await loadWorkbook(excelPath)
  const worksheet = workbook.getWorksheet(sheetName)
  if (!worksheet) {
    throw new Error(`Лист «${sheetName}» не найден`)
  }

  const structure = scanSheetStructure(worksheet)
  return {
    workbook,
    worksheet,
    sheetName,
    weeks: structure.weeks,
    dayBlocks: structure.dayBlocks,
    departments: Object.fromEntries(structure.departments)
  }
}

function resolveWriteTargets(parsed, selection) {
  const {
    weekId,
    employee,
    startDay,
    endDay,
    startTime,
    endTime
  } = selection

  const days = getDaysInRange(startDay, endDay)
  const targets = []

  for (const day of days) {
    const dayBlock = findDayBlock(parsed.dayBlocks, weekId, day)
    if (!dayBlock) {
      throw new Error(`День «${day}» не найден в выбранной неделе`)
    }

    const employeeRow = findEmployeeRow(parsed.worksheet, dayBlock, employee)
    if (!employeeRow) {
      throw new Error(`Сотрудник «${employee}» не найден в блоке дня «${day}»`)
    }

    const slots = getSlotsInRange(dayBlock.timeSlots, startTime, endTime)
    for (const slotInfo of slots) {
      targets.push({
        row: employeeRow,
        col: slotInfo.col,
        slot: slotInfo.slot,
        day,
        weekId
      })
    }
  }

  return targets
}

module.exports = {
  loadWorkbook,
  listScheduleSheets,
  parseSheet,
  scanSheetStructure,
  findEmployeeRow,
  findDayBlock,
  getSlotsInRange,
  getDaysInRange,
  resolveWriteTargets,
  cellText
}
