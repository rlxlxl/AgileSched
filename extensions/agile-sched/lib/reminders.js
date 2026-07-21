const { isRussianHoliday, formatDateYmd } = require('./holidays-ru')
const { normalizeProfile } = require('./profile')
const {
  calculateWeekHours,
  applyLunchToWeek,
  checkWeeklyNorm
} = require('./hours-calculator')
const { listSheets, getScheduleIndex } = require('./schedule-index')
const {
  findSheetForDate,
  findCurrentWeek,
  extractYearFromSheetName
} = require('./week-dates')

const TIMEZONE = 'Europe/Moscow'

function getMoscowParts(date) {
  const d = date || new Date()
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  const parts = {}
  fmt.formatToParts(d).forEach(function (p) {
    if (p.type !== 'literal') parts[p.type] = p.value
  })
  const weekdayMap = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday] || 1,
    ymd: parts.year + '-' + parts.month + '-' + parts.day
  }
}

function shouldRunRemindTick(profile, nowParts) {
  const p = normalizeProfile(profile)
  if (!p || !p.remindEnabled) return false
  if (nowParts.weekday !== p.remindWeekday) return false
  if (nowParts.hour !== p.remindHour) return false
  // within the first 5-minute window of the hour
  if (nowParts.minute >= 5) return false
  if (p.lastRemindDate === nowParts.ymd) return false
  return true
}

async function evaluateScheduleStatus(excelPath, profile) {
  const sheets = await listSheets(excelPath)
  const today = new Date()
  const sheet = findSheetForDate(sheets, today) || profile.sheetName
  if (!sheet) {
    return { needsRemind: true, reason: 'empty', detail: 'лист не найден' }
  }
  const index = await getScheduleIndex(excelPath, sheet)
  const yearHint = extractYearFromSheetName(sheet)
  const week = findCurrentWeek(index.weeks, today, yearHint)
  if (!week) {
    return { needsRemind: true, reason: 'empty', detail: 'неделя не найдена' }
  }

  const weekResult = await calculateWeekHours(
    excelPath,
    sheet,
    week.id,
    profile.employee,
    yearHint
  )
  const withLunch = applyLunchToWeek(weekResult, profile.lunchMinutes)
  if (!withLunch.days.length || withLunch.totalHours === 0) {
    return {
      needsRemind: true,
      reason: 'empty',
      detail: 'расписание не заполнено',
      weekLabel: withLunch.weekLabel
    }
  }

  const check = checkWeeklyNorm(withLunch.totalHours, profile.rate)
  if (!check.ok) {
    return {
      needsRemind: true,
      reason: 'deficit',
      detail: 'не хватает ' + check.deficit + ' ч до нормы',
      weekLabel: withLunch.weekLabel,
      totalHours: check.totalHours,
      norm: check.norm,
      deficit: check.deficit
    }
  }

  return {
    needsRemind: false,
    reason: 'ok',
    weekLabel: withLunch.weekLabel,
    totalHours: check.totalHours,
    norm: check.norm
  }
}

function buildRemindMessage(status) {
  const lines = ['Нужно заполнить расписание на текущую неделю.']
  if (status.weekLabel) {
    lines.push('Неделя: ' + status.weekLabel)
  }
  if (status.reason === 'empty') {
    lines.push('Статус: ' + (status.detail || 'пусто'))
  } else if (status.reason === 'deficit') {
    lines.push(
      'Сейчас: ' +
        status.totalHours +
        ' ч из ' +
        status.norm +
        ' ч (' +
        status.detail +
        ')'
    )
  }
  lines.push('Команды: /schedule или /myschedule')
  return lines.join('\n')
}

/**
 * Create reminder scheduler.
 * deps: { getConfig, listUserProfiles, saveUserProfile, sendTelegram(userId, text) }
 */
function createReminderScheduler(deps) {
  let timer = null
  let running = false

  async function tick(now) {
    if (running) return { skipped: true, reason: 'busy' }
    running = true
    try {
      const nowParts = getMoscowParts(now)
      const holidayDate = new Date(
        Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, 12)
      )
      if (isRussianHoliday(holidayDate)) {
        return { skipped: true, reason: 'holiday', ymd: nowParts.ymd }
      }

      const config = await deps.getConfig()
      if (!config.excelPath) {
        return { skipped: true, reason: 'no-excel' }
      }

      const users = await deps.listUserProfiles()
      const sent = []
      for (const item of users) {
        const profile = item.profile
        if (!shouldRunRemindTick(profile, nowParts)) continue

        let status
        try {
          status = await evaluateScheduleStatus(config.excelPath, profile)
        } catch (error) {
          status = {
            needsRemind: true,
            reason: 'empty',
            detail: 'ошибка чтения: ' + error.message
          }
        }
        if (!status.needsRemind) {
          await deps.saveUserProfile(
            item.userId,
            Object.assign({}, profile, { lastRemindDate: nowParts.ymd })
          )
          continue
        }

        const text = buildRemindMessage(status)
        await deps.sendTelegram(item.userId, text)
        await deps.saveUserProfile(
          item.userId,
          Object.assign({}, profile, { lastRemindDate: nowParts.ymd })
        )
        sent.push(item.userId)
      }

      return { skipped: false, ymd: nowParts.ymd, sent: sent }
    } finally {
      running = false
    }
  }

  function start(intervalMs) {
    if (timer) return
    const ms = intervalMs || 5 * 60 * 1000
    timer = setInterval(function () {
      tick(new Date()).catch(function (error) {
        console.error('[agile-sched] reminder tick failed:', error)
      })
    }, ms)
    if (timer.unref) timer.unref()
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    tick: tick,
    start: start,
    stop: stop,
    getMoscowParts: getMoscowParts,
    shouldRunRemindTick: shouldRunRemindTick,
    evaluateScheduleStatus: evaluateScheduleStatus,
    buildRemindMessage: buildRemindMessage,
    TIMEZONE: TIMEZONE
  }
}

module.exports = {
  createReminderScheduler,
  getMoscowParts,
  shouldRunRemindTick,
  evaluateScheduleStatus,
  buildRemindMessage,
  formatDateYmd: formatDateYmd,
  TIMEZONE: TIMEZONE
}
