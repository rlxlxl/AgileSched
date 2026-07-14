#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const extensionRoot = path.join(projectRoot, 'extensions/agile-sched')
const sourceExcel = path.join(projectRoot, 'Расписашка РиМ (1).xlsx')
const testExcel = path.join(projectRoot, 'test-output.xlsx')

const ExcelJS = require(path.join(extensionRoot, 'node_modules/exceljs'))
const { listSheets, getScheduleIndex } = require(path.join(extensionRoot, 'lib/schedule-index'))
const { applyScheduleRange } = require(path.join(extensionRoot, 'lib/excel-writer'))
const { numberToCol } = require(path.join(extensionRoot, 'lib/xlsx-patcher'))

const GREEN_STYLE_IDS = new Set([16, 43])

function cellFillColor(cell) {
  const fill = cell.fill
  if (!fill || fill.type !== 'pattern' || fill.pattern === 'none') return null
  const fg = fill.fgColor
  if (!fg) return null
  if (fg.argb) return { rgb: String(fg.argb).toUpperCase(), theme: null }
  if (fg.theme != null) return { rgb: null, theme: fg.theme }
  return null
}

function isOrangeFill(fill) {
  if (!fill) return false
  return fill.rgb === 'FFFF6D01' || fill.theme === 8
}

async function verifyRemoteColor(excelPath, sheetName, targets, styleId) {
  if (GREEN_STYLE_IDS.has(styleId)) {
    throw new Error(`Remote write used green style ${styleId}`)
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(excelPath)
  const ws = wb.getWorksheet(sheetName)
  const sample = targets[0]
  const ref = `${numberToCol(sample.col)}${sample.row}`
  const cell = ws.getCell(ref)
  const fill = cellFillColor(cell)

  if (!isOrangeFill(fill)) {
    throw new Error(
      `Remote cell ${ref} has wrong fill: ${JSON.stringify(fill)} (expected FFFF6D01 or theme:8)`
    )
  }

  console.log(` - remote style ${styleId}, cell ${ref} fill:`, fill)
}

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

  const week = index.weeks[1]
  const officeSelection = {
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

  console.log('\nApplying office test (2nd week):')
  console.log(officeSelection)

  const officeResult = await applyScheduleRange(testExcel, sheetName, officeSelection)
  console.log('\nOffice write result:')
  console.log(' - cells updated:', officeResult.cellsUpdated)
  console.log(' - style id:', officeResult.patchInfo.styleId)

  const minCol = Math.min(...officeResult.targets.map((t) => t.col))
  if (minCol < 20) {
    throw new Error(`Expected 2nd week columns (>=20), got min col ${minCol}`)
  }

  const remoteWeek = index.weeks.find((w) => w.label.includes('13.07')) || index.weeks[2] || week
  const remoteSelection = {
    weekId: remoteWeek.id,
    weekLabel: remoteWeek.label,
    department: department.name,
    employee,
    startDay: 'Понедельник',
    endDay: 'Понедельник',
    startTime: '14:00-15:00',
    endTime: '16:00-17:00',
    workTypeId: 'remote'
  }

  console.log('\nApplying remote test:')
  console.log(remoteSelection)

  const remoteResult = await applyScheduleRange(testExcel, sheetName, remoteSelection)
  console.log('\nRemote write result:')
  console.log(' - cells updated:', remoteResult.cellsUpdated)
  console.log(' - style id:', remoteResult.patchInfo.styleId)

  await verifyRemoteColor(
    testExcel,
    sheetName,
    remoteResult.targets,
    remoteResult.patchInfo.styleId
  )

  console.log('\nParser/writer test completed successfully.')
}

main().catch((error) => {
  console.error('Test failed:', error)
  process.exit(1)
})
