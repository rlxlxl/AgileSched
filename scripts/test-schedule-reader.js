#!/usr/bin/env node
const path = require('path')
const { getEmployeeWeekSchedule } = require('../extensions/agile-sched/lib/schedule-reader')
const { listSheets, getScheduleIndex } = require('../extensions/agile-sched/lib/schedule-index')
const { extractYearFromSheetName } = require('../extensions/agile-sched/lib/week-dates')

const excelPath =
  process.env.EXCEL_PATH ||
  path.join(__dirname, '..', 'test-output.xlsx')

async function main() {
  const sheets = await listSheets(excelPath)
  const sheet = sheets.find((n) => n.includes('ИЮЛ')) || sheets[sheets.length - 1]
  const index = await getScheduleIndex(excelPath, sheet)
  const week = index.weeks[1]
  const yearHint = extractYearFromSheetName(sheet)

  const result = await getEmployeeWeekSchedule(
    excelPath,
    sheet,
    week.id,
    'Репин Сергей',
    yearHint,
    { rate: 1 }
  )

  console.log('Репин Сергей')
  console.log(result.text)
  console.log('totalHours:', result.totalHours)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
