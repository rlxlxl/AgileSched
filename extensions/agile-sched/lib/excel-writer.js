const fs = require('fs')
const path = require('path')
const { parseSheet, resolveWriteTargets } = require('./excel-parser')
const { patchWorkbookCells } = require('./xlsx-patcher')

const WRITE_RETRY_ATTEMPTS = 4
const WRITE_RETRY_DELAY_MS = 800

const LOCK_ERROR_CODES = new Set(['EBUSY', 'EACCES', 'EPERM', 'EAGAIN'])

let writeLock = Promise.resolve()

function withWriteLock(fn) {
  const run = writeLock.then(fn)
  writeLock = run.catch(() => {})
  return run
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isLockError(error) {
  if (!error) return false
  if (LOCK_ERROR_CODES.has(error.code)) return true
  const message = String(error.message || '').toLowerCase()
  return (
    message.includes('busy') ||
    message.includes('locked') ||
    message.includes('resource deadlock') ||
    message.includes('permission denied')
  )
}

/**
 * Checks that Excel path exists and is readable/writable (Drive mount).
 * Avoid openSync by default — Google Drive FUSE can hang forever on open.
 * @param {string} excelPath
 * @param {{strict?: boolean}} [opts]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function assertExcelAccessible(excelPath, opts) {
  const strict = Boolean(opts && opts.strict)

  if (!excelPath) {
    return {
      ok: false,
      error:
        'Путь к Excel не задан. Укажите excelPath в config.json (путь внутри контейнера).'
    }
  }

  if (!fs.existsSync(excelPath)) {
    return {
      ok: false,
      error:
        'Файл Excel не найден: ' +
        excelPath +
        '. Проверьте volume Google Drive → /opt/yougile/user-data/drive и config.json.'
    }
  }

  try {
    fs.accessSync(excelPath, fs.constants.R_OK | fs.constants.W_OK)
  } catch (error) {
    return {
      ok: false,
      error:
        'Нет доступа к файлу (закройте его в Excel / проверьте права Drive mount): ' +
        excelPath +
        (error && error.code ? ' [' + error.code + ']' : '')
    }
  }

  // Strict open only before write — can hang on cloud files; keep optional
  if (strict) {
    try {
      const fd = fs.openSync(excelPath, 'r+')
      fs.closeSync(fd)
    } catch (error) {
      if (isLockError(error)) {
        return {
          ok: false,
          error:
            'Файл занят (откройте в Excel?). Закройте «Расписашка» и повторите: ' +
            excelPath
        }
      }
      return {
        ok: false,
        error: 'Не удалось открыть файл для записи: ' + (error.message || error)
      }
    }
  }

  return { ok: true }
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

async function withRetry(fn) {
  let lastError
  for (let attempt = 1; attempt <= WRITE_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isLockError(error) || attempt === WRITE_RETRY_ATTEMPTS) {
        throw error
      }
      await sleep(WRITE_RETRY_DELAY_MS * attempt)
    }
  }
  throw lastError
}

async function applyScheduleRange(excelPath, sheetName, selection) {
  return withWriteLock(async () => {
    const access = assertExcelAccessible(excelPath)
    if (!access.ok) {
      const err = new Error(access.error)
      err.code = 'EXCEL_INACCESSIBLE'
      throw err
    }

    const parsed = await parseSheet(excelPath, sheetName)
    const targets = resolveWriteTargets(parsed, selection)

    return withRetry(async () => {
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
        patchInfo,
        driveSyncHint:
          'Файл на Google Drive обновлён. Синхронизация обычно 5–30 сек — откройте .xlsx по ссылке Диска (не «в Google Таблицах»).'
      }
    })
  })
}

module.exports = {
  applyScheduleRange,
  assertExcelAccessible,
  createBackup,
  withWriteLock,
  isLockError
}
