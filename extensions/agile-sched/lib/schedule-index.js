const fs = require('fs')
const { loadWorkbook, listScheduleSheets, parseSheet } = require('./excel-parser')

async function getScheduleIndex(excelPath, sheetName) {
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Файл Excel не найден: ${excelPath}`)
  }

  const parsed = await parseSheet(excelPath, sheetName)
  return {
    sheetName: parsed.sheetName,
    weeks: parsed.weeks.map((week) => ({
      id: week.id,
      label: `${week.type} (${week.dates})`,
      type: week.type,
      dates: week.dates
    })),
    departments: Object.entries(parsed.departments).map(([name, employees]) => ({
      name,
      employees
    })),
    timeSlots: parsed.dayBlocks[0] ? parsed.dayBlocks[0].timeSlots.map((item) => item.slot) : []
  }
}

async function listSheets(excelPath) {
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Файл Excel не найден: ${excelPath}`)
  }
  const workbook = await loadWorkbook(excelPath)
  return listScheduleSheets(workbook)
}

module.exports = {
  getScheduleIndex,
  listSheets
}
