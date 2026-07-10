#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const extensionRoot = path.join(projectRoot, 'extensions/agile-sched')
const sourceExcel = path.join(projectRoot, 'Расписашка РиМ (1).xlsx')
const testExcel = path.join(projectRoot, 'test-output.xlsx')

const { listSheets, getScheduleIndex } = require(path.join(extensionRoot, 'lib/schedule-index'))
const { applyScheduleRange } = require(path.join(extensionRoot, 'lib/excel-writer'))

async function main() {
  if (!fs.existsSync(sourceExcel)) {
    console.error('Source Excel not found:', sourceExcel)
    process.exit(1)
  }

  fs.copyFileSync(sourceExcel, testExcel)
  console.log('Copied test file:', testExcel)

  const sheets = await listSheets(testExcel)
  console.log('\nSheets:', sheets.slice(-5))

  const sheetName = sheets.find((name) => name.includes('2026') && name.includes('ИЮЛ')) || sheets[sheets.length - 1]
  console.log('\nUsing sheet:', sheetName)

  const index = await getScheduleIndex(testExcel, sheetName)
  console.log('\nWeeks:')
  index.weeks.forEach((week) => console.log(' -', week.label))

  console.log('\nDepartments:')
  index.departments.forEach((dept) => {
    console.log(` - ${dept.name}: ${dept.employees.length} employees`)
  })

  if (index.weeks.length < 2) {
    throw new Error(`Expected multiple weeks, got ${index.weeks.length}`)
  }

  const department = index.departments.find((item) => item.name.includes('схемотехников'))
  const employee = department.employees.find((name) => name.includes('Репин')) || department.employees[0]

  // Write into the 2nd week (Четная) to verify horizontal week columns
  const week = index.weeks[1]
  const selection = {
    weekId: week.id,
    weekLabel: week.label,
    department: department.name,
    employee,
    startDay: 'Понедельник',
    endDay: 'Четверг',
    startTime: '9:00-10:00',
    endTime: '12:00-13:00',
    workTypeId: 'office'
  }

  console.log('\nApplying test selection (2nd week):')
  console.log(selection)

  const result = await applyScheduleRange(testExcel, sheetName, selection)
  console.log('\nWrite result:')
  console.log(' - cells updated:', result.cellsUpdated)
  console.log(' - backup:', result.backupPath)
  console.log(' - sample targets:', result.targets.slice(0, 5))

  const minCol = Math.min(...result.targets.map((t) => t.col))
  if (minCol < 20) {
    throw new Error(`Expected 2nd week columns (>=20), got min col ${minCol}`)
  }

  console.log('\nParser/writer test completed successfully.')
}

main().catch((error) => {
  console.error('Test failed:', error)
  process.exit(1)
})
