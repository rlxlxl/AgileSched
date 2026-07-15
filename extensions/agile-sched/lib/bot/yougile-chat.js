const { DAYS, DAY_SHORT, WORK_TYPES, TIME_SLOTS } = require('../constants')
const { listSheets, getScheduleIndex } = require('../schedule-index')
const { applyScheduleRange, assertExcelAccessible } = require('../excel-writer')
const { getEmployeeWeekSchedule } = require('../schedule-reader')
const {
  findSheetForDate,
  findCurrentWeek,
  extractYearFromSheetName
} = require('../week-dates')

const BOT_LABEL = 'Расписание РиМ'
const sessions = new Map()

function formatList(items) {
  return items
    .map(function (item, index) {
      return String(index + 1) + '. ' + item
    })
    .join('\n')
}

function parseChoice(text, max) {
  const n = Number(String(text || '').trim())
  if (!Number.isInteger(n) || n < 1 || n > max) return null
  return n - 1
}

function sessionKey(chatId, userId) {
  return String(chatId) + ':' + String(userId || 'anon')
}

function buildPreview(selection) {
  const workType = WORK_TYPES[selection.workTypeId]
  return [
    'Превью изменений:',
    'Лист: ' + selection.sheetName,
    'Неделя: ' + selection.weekLabel,
    'Отдел: ' + selection.department,
    'Сотрудник: ' + selection.employee,
    'Дни: ' + DAY_SHORT[selection.startDay] + ' — ' + DAY_SHORT[selection.endDay],
    'Время: ' + selection.startTime + ' — ' + selection.endTime,
    'Тип: ' + workType.emoji + ' ' + workType.label,
    '',
    'Ответьте: 1 — сохранить, 2 — отмена'
  ].join('\n')
}

function mainMenuText() {
  return [
    'Бот расписания РиМ (как в Telegram).',
    '',
    '1 — Заполнить расписание  (/schedule)',
    '2 — Показать расписание   (/show)',
    '3 — Привязать профиль     (/my)',
    '4 — Моё расписание        (/myschedule)',
    '5 — Статус                (/status)',
    '',
    'Напишите номер или команду. /cancel — отмена'
  ].join('\n')
}

function extractMessage(payload) {
  if (!payload) return { chatId: null, text: '' }

  const chatId =
    payload.chatId ||
    payload.id ||
    (payload.properties && payload.properties.chatId) ||
    null

  let raw =
    payload.text ||
    payload.message ||
    (payload.properties && payload.properties.text) ||
    ''

  if (!raw && payload.textHtml) {
    raw = String(payload.textHtml)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  }

  const text = String(raw).replace(/\s+/g, ' ').trim()
  return { chatId, text }
}

function isBotMessage(payload) {
  if (!payload) return true
  if (payload.label === BOT_LABEL) return true
  if (payload.fromSystem || payload.system) return true
  return false
}

function isStartCommand(lower) {
  return lower === '/start' || lower === 'start'
}

function isCommand(lower, cmd) {
  return lower === cmd || lower === cmd.replace('/', '')
}

async function createYougileChatBot(deps) {
  const {
    Api,
    getConfig,
    getUserProfile,
    saveUserProfile,
    assertExcelAccessible: assertAccess,
    logger
  } = deps

  async function reply(chatId, text) {
    await Api.post('/chats/' + chatId + '/messages', {
      text: text,
      textHtml:
        '<p>' +
        String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/\n/g, '<br/>') +
        '</p>',
      label: BOT_LABEL
    })
  }

  async function askList(chatId, title, labels) {
    await reply(
      chatId,
      title + '\n\n' + formatList(labels) + '\n\nНапишите номер пункта'
    )
  }

  async function showStatus(chatId, userId) {
    const config = await getConfig()
    const profile = await getUserProfile(userId)
    const access = assertAccess
      ? assertAccess(config.excelPath)
      : { ok: false, error: 'нет проверки' }
    const lines = [
      'Excel: ' + (config.excelPath || 'не задан'),
      'Доступ: ' + (access.ok ? 'да' : access.error)
    ]
    if (profile) {
      lines.push('Профиль: ' + profile.employee + ' (' + profile.department + ')')
    }
    await reply(chatId, lines.join('\n'))
  }

  async function showMySchedule(chatId, userId) {
    const config = await getConfig()
    const profile = await getUserProfile(userId)
    if (!profile) {
      await reply(chatId, 'Сначала привяжите профиль: /my')
      return
    }
    const sheets = await listSheets(config.excelPath)
    const today = new Date()
    const sheet = findSheetForDate(sheets, today) || profile.sheetName
    const index = await getScheduleIndex(config.excelPath, sheet)
    const yearHint = extractYearFromSheetName(sheet)
    const week = findCurrentWeek(index.weeks, today, yearHint)
    if (!week) {
      await reply(chatId, 'Текущая неделя не найдена. Используйте /show')
      return
    }
    const result = await getEmployeeWeekSchedule(
      config.excelPath,
      sheet,
      week.id,
      profile.employee,
      yearHint
    )
    await reply(chatId, profile.employee + '\n' + result.text)
  }

  async function handleMessage(payload, _prev, fromUserId) {
    if (isBotMessage(payload)) return

    const { chatId, text } = extractMessage(payload)
    if (!chatId || !text) return

    const lower = text.toLowerCase()
    const key = sessionKey(chatId, fromUserId)
    let session = sessions.get(key)

    console.log('[agile-sched] chat:', chatId, 'user:', fromUserId, 'text:', text)

    if (lower === '/cancel' || lower === 'отмена' || lower === 'cancel') {
      if (!session) return
      sessions.delete(key)
      await reply(chatId, 'Отменено.')
      return
    }

    if (isStartCommand(lower)) {
      session = { step: 'menu', selection: {} }
      sessions.set(key, session)
      await reply(chatId, mainMenuText())
      return
    }

    // Без /start в этом чате — не отвечаем на произвольные сообщения и команды
    if (!session) {
      return
    }

    if (isCommand(lower, '/status')) {
      await showStatus(chatId, fromUserId)
      return
    }

    if (isCommand(lower, '/myschedule')) {
      try {
        await showMySchedule(chatId, fromUserId)
      } catch (error) {
        await reply(chatId, 'Ошибка: ' + error.message)
      }
      return
    }

    if (isCommand(lower, '/schedule')) {
      const config = await getConfig()
      try {
        await startSchedule(chatId, session, config)
      } catch (error) {
        sessions.delete(key)
        await reply(chatId, 'Ошибка: ' + error.message)
      }
      return
    }

    if (isCommand(lower, '/show')) {
      const config = await getConfig()
      try {
        await startView(chatId, session, config)
      } catch (error) {
        sessions.delete(key)
        await reply(chatId, 'Ошибка: ' + error.message)
      }
      return
    }

    if (isCommand(lower, '/my')) {
      const config = await getConfig()
      try {
        await startProfile(chatId, session, config)
      } catch (error) {
        sessions.delete(key)
        await reply(chatId, 'Ошибка: ' + error.message)
      }
      return
    }

    try {
      await runStep(chatId, fromUserId, session, text, key)
    } catch (error) {
      sessions.delete(key)
      if (logger && logger.error) {
        logger.error('[agile-sched] yougile chat error', error)
      }
      await reply(chatId, 'Ошибка: ' + (error.message || String(error)))
    }
  }

  async function runStep(chatId, userId, session, text, key) {
    const config = await getConfig()
    const lower = text.toLowerCase()

    if (session.step === 'menu') {
      let choice = parseChoice(text, 5)
      if (choice === null && isCommand(lower, '/schedule')) choice = 0
      if (choice === null && isCommand(lower, '/show')) choice = 1
      if (choice === null && isCommand(lower, '/my')) choice = 2
      if (choice === null && isCommand(lower, '/myschedule')) choice = 3
      if (choice === null && isCommand(lower, '/status')) choice = 4

      if (choice === null) {
        await reply(chatId, mainMenuText())
        return
      }
      if (choice === 0) return startSchedule(chatId, session, config)
      if (choice === 1) return startView(chatId, session, config)
      if (choice === 2) return startProfile(chatId, session, config)
      if (choice === 3) {
        await showMySchedule(chatId, userId)
        sessions.delete(key)
        return
      }
      if (choice === 4) {
        await showStatus(chatId, userId)
        sessions.delete(key)
        return
      }
    }

    if (session.step === 'sheet') {
      const idx = parseChoice(text, session.options.length)
      if (idx === null) {
        await askList(chatId, 'Выберите месяц (лист):', session.options)
        return
      }
      session.selection.sheetName = session.options[idx]
      const index = await getScheduleIndex(
        config.excelPath,
        session.selection.sheetName
      )
      session.index = index
      session.options = index.weeks.map(function (w) {
        return w.label
      })
      session.weekIds = index.weeks.map(function (w) {
        return w.id
      })
      session.step = 'week'
      await askList(chatId, 'Выберите неделю:', session.options)
      return
    }

    if (session.step === 'week') {
      const idx = parseChoice(text, session.options.length)
      if (idx === null) {
        await askList(chatId, 'Выберите неделю:', session.options)
        return
      }
      session.selection.weekId = session.weekIds[idx]
      session.selection.weekLabel = session.options[idx]
      return askDepartment(chatId, session)
    }

    if (session.step === 'department') {
      const idx = parseChoice(text, session.options.length)
      if (idx === null) {
        await askList(chatId, 'Выберите отдел:', session.options)
        return
      }
      const department = session.index.departments[idx]
      session.selection.department = department.name
      session.selection.departmentEmployees = department.employees
      session.options = department.employees.slice()
      session.step = session.flow === 'profile' ? 'profile-emp' : 'employee'
      await askList(
        chatId,
        session.flow === 'profile'
          ? 'Выберите себя в списке:'
          : 'Выберите сотрудника:',
        session.options
      )
      return
    }

    if (session.step === 'employee') {
      const idx = parseChoice(text, session.options.length)
      if (idx === null) {
        await askList(chatId, 'Выберите сотрудника:', session.options)
        return
      }
      session.selection.employee = session.options[idx]
      if (session.flow === 'view') {
        const result = await getEmployeeWeekSchedule(
          config.excelPath,
          session.selection.sheetName,
          session.selection.weekId,
          session.selection.employee,
          extractYearFromSheetName(session.selection.sheetName)
        )
        await reply(chatId, session.selection.employee + '\n' + result.text)
        sessions.delete(key)
        return
      }
      session.options = DAYS.slice()
      session.step = 'startDay'
      await askList(
        chatId,
        'Выберите начало недели:',
        session.options.map(function (d) {
          return DAY_SHORT[d] + ' (' + d + ')'
        })
      )
      return
    }

    if (session.step === 'profile-emp') {
      const idx = parseChoice(text, session.options.length)
      if (idx === null) {
        await askList(chatId, 'Выберите себя в списке:', session.options)
        return
      }
      const employee = session.options[idx]
      await saveUserProfile(userId, {
        department: session.selection.department,
        employee: employee,
        sheetName: session.selection.sheetName
      })
      await reply(
        chatId,
        'Профиль привязан:\n' + employee + '\n' + session.selection.department
      )
      sessions.delete(key)
      return
    }

    if (session.step === 'startDay') {
      const idx = parseChoice(text, DAYS.length)
      if (idx === null) {
        await askList(
          chatId,
          'Выберите начало недели:',
          DAYS.map(function (d) {
            return DAY_SHORT[d] + ' (' + d + ')'
          })
        )
        return
      }
      session.selection.startDay = DAYS[idx]
      session.allowedDays = DAYS.slice(idx)
      session.step = 'endDay'
      await askList(
        chatId,
        'Выберите конец недели:',
        session.allowedDays.map(function (d) {
          return DAY_SHORT[d] + ' (' + d + ')'
        })
      )
      return
    }

    if (session.step === 'endDay') {
      const idx = parseChoice(text, session.allowedDays.length)
      if (idx === null) {
        await askList(
          chatId,
          'Выберите конец недели:',
          session.allowedDays.map(function (d) {
            return DAY_SHORT[d] + ' (' + d + ')'
          })
        )
        return
      }
      session.selection.endDay = session.allowedDays[idx]
      const slots = (session.index && session.index.timeSlots) || TIME_SLOTS
      session.slots = slots.slice()
      session.step = 'startTime'
      await askList(chatId, 'Выберите начальное время:', session.slots)
      return
    }

    if (session.step === 'startTime') {
      const idx = parseChoice(text, session.slots.length)
      if (idx === null) {
        await askList(chatId, 'Выберите начальное время:', session.slots)
        return
      }
      session.selection.startTime = session.slots[idx]
      session.allowedSlots = session.slots.slice(idx)
      session.step = 'endTime'
      await askList(chatId, 'Выберите конечное время:', session.allowedSlots)
      return
    }

    if (session.step === 'endTime') {
      const idx = parseChoice(text, session.allowedSlots.length)
      if (idx === null) {
        await askList(chatId, 'Выберите конечное время:', session.allowedSlots)
        return
      }
      session.selection.endTime = session.allowedSlots[idx]
      const types = Object.values(WORK_TYPES)
      session.workTypes = types
      session.step = 'workType'
      await askList(
        chatId,
        'Выберите вид работы:',
        types.map(function (t) {
          return t.emoji + ' ' + t.label
        })
      )
      return
    }

    if (session.step === 'workType') {
      const idx = parseChoice(text, session.workTypes.length)
      if (idx === null) {
        await askList(
          chatId,
          'Выберите вид работы:',
          session.workTypes.map(function (t) {
            return t.emoji + ' ' + t.label
          })
        )
        return
      }
      session.selection.workTypeId = session.workTypes[idx].id
      session.step = 'confirm'
      await reply(chatId, buildPreview(session.selection))
      return
    }

    if (session.step === 'confirm') {
      const idx = parseChoice(text, 2)
      if (idx === null) {
        await reply(chatId, buildPreview(session.selection))
        return
      }
      if (idx === 1) {
        sessions.delete(key)
        await reply(chatId, 'Заполнение отменено.')
        return
      }
      const result = await applyScheduleRange(
        config.excelPath,
        session.selection.sheetName,
        session.selection
      )
      sessions.delete(key)
      await reply(
        chatId,
        [
          'Расписание сохранено',
          'Обновлено ячеек: ' + result.cellsUpdated,
          'Резервная копия: ' + result.backupPath,
          result.driveSyncHint ||
            'Синхронизация Google Drive: 5–30 сек.'
        ].join('\n')
      )
    }
  }

  async function startSchedule(chatId, session, config) {
    const access = assertAccess(config.excelPath)
    if (!access.ok) {
      await reply(chatId, access.error)
      session.step = 'menu'
      return
    }
    session.flow = 'schedule'
    session.selection = {}
    const sheets = await listSheets(config.excelPath)
    if (!sheets.length) {
      await reply(chatId, 'В файле Excel не найдены листы расписания.')
      return
    }
    const today = new Date()
    const autoSheet = findSheetForDate(sheets, today)
    if (autoSheet) {
      const index = await getScheduleIndex(config.excelPath, autoSheet)
      const yearHint = extractYearFromSheetName(autoSheet)
      const currentWeek = findCurrentWeek(index.weeks, today, yearHint)
      session.selection.sheetName = autoSheet
      session.index = index
      if (currentWeek) {
        session.selection.weekId = currentWeek.id
        session.selection.weekLabel = currentWeek.label
        return askDepartment(chatId, session)
      }
      session.options = index.weeks.map(function (w) {
        return w.label
      })
      session.weekIds = index.weeks.map(function (w) {
        return w.id
      })
      session.step = 'week'
      await askList(
        chatId,
        'Лист: ' + autoSheet + '\nВыберите неделю:',
        session.options
      )
      return
    }
    session.options = sheets
    session.step = 'sheet'
    await askList(chatId, 'Выберите месяц (лист):', session.options)
  }

  async function startView(chatId, session, config) {
    session.flow = 'view'
    session.selection = {}
    const sheets = await listSheets(config.excelPath)
    const today = new Date()
    const autoSheet = findSheetForDate(sheets, today)
    if (autoSheet) {
      const index = await getScheduleIndex(config.excelPath, autoSheet)
      const yearHint = extractYearFromSheetName(autoSheet)
      const currentWeek = findCurrentWeek(index.weeks, today, yearHint)
      session.selection.sheetName = autoSheet
      session.index = index
      if (currentWeek) {
        session.selection.weekId = currentWeek.id
        session.selection.weekLabel = currentWeek.label
        return askDepartment(chatId, session)
      }
      session.options = index.weeks.map(function (w) {
        return w.label
      })
      session.weekIds = index.weeks.map(function (w) {
        return w.id
      })
      session.step = 'week'
      await askList(chatId, 'Выберите неделю:', session.options)
      return
    }
    session.options = sheets
    session.step = 'sheet'
    await askList(chatId, 'Выберите месяц (лист):', session.options)
  }

  async function startProfile(chatId, session, config) {
    session.flow = 'profile'
    session.selection = {}
    const sheets = await listSheets(config.excelPath)
    const defaultSheet = sheets[sheets.length - 1]
    const index = await getScheduleIndex(config.excelPath, defaultSheet)
    session.selection.sheetName = defaultSheet
    session.index = index
    return askDepartment(chatId, session)
  }

  async function askDepartment(chatId, session) {
    session.options = session.index.departments.map(function (d) {
      return d.name
    })
    session.step = 'department'
    await askList(chatId, 'Выберите отдел:', session.options)
  }

  return { handleMessage: handleMessage }
}

module.exports = { createYougileChatBot, BOT_LABEL }
