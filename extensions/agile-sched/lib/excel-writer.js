const fs = require('fs')
const path = require('path')
const { parseSheet, resolveWriteTargets } = require('./excel-parser')
const { patchWorkbookCells } = require('./xlsx-patcher')

let writeLock = Promise.resolve()

function withWriteLock(fn) {
  const run = writeLock.then(fn)
  writeLock = run.catch(() => {})
  return run
}

function ensureBackupDir(excelPath) {
  const backupDir = path.join(path.dirname(excelPath), 'backups')
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }
  return backupDir
}

function createBackup(excelPath) {
  const backupDir = ensureBackupDir(excelPath)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(
    backupDir,
    `${path.basename(excelPath, path.extname(excelPath))}-${stamp}.xlsx`
  )
  fs.copyFileSync(excelPath, backupPath)
  return backupPath
}

async function applyScheduleRange(excelPath, sheetName, selection) {
  return withWriteLock(async () => {
    // exceljs is used only for reading structure — never for writeFile
    const parsed = await parseSheet(excelPath, sheetName)
    const targets = resolveWriteTargets(parsed, selection)
    const backupPath = createBackup(excelPath)

    const patchInfo = await patchWorkbookCells(
      excelPath,
      sheetName,
      targets,
      selection.workTypeId
    )

    return {
      backupPath,
      cellsUpdated: targets.length,
      targets,
      patchInfo
    }
  })
}

module.exports = {
  applyScheduleRange,
  createBackup,
  withWriteLock
}
