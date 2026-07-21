const { DAYS, DAY_SHORT, WORK_TYPES, TIME_SLOTS } = require('../constants')
const { listSheets, getScheduleIndex } = require('../schedule-index')
const { applyScheduleRange, assertExcelAccessible } = require('../excel-writer')
const { getEmployeeWeekSchedule } = require('../schedule-reader')
const {
  findSheetForDate,
  findCurrentWeek,
  extractYearFromSheetName
} = require('../week-dates')
const { formatNormSummary } = require('../hours-calculator')
const { formatRateLine, formatLunchLine, normalizeLunchMinutes } = require('../profile')
const {
  parseFreeformSchedule,
  formatFreeformPreview
} = require('../freeform-schedule')
const {
  getTaskAssigned,
  isSubtask,
  assignedChanged,
  formatLinkedProfileMessage,
  fetchTask,
  resolveSubtaskAssigneeProfile
} = require('./task-context')

const BOT_LABEL = 'Расписание РиМ'
const sessions = new Map()
const chatLinkedProfiles = new Map()

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
    getRateForEmployee,
    getProfileForEmployee,
    assertExcelAccessible: assertAccess,
    logger
  } = deps

  async function resolveEmployeeProfile(employee) {
    if (getProfileForEmployee) {
      const profile = await getProfileForEmployee(employee)
      if (profile) return profile
    }
    const rate = getRateForEmployee ? await getRateForEmployee(employee) : 1
    return { rate: rate, lunchMinutes: 60 }
  }

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

  async function getLinkedProfile(chatId) {
    const cached = chatLinkedProfiles.get(String(chatId))
    if (cached) return cached

    const linked = await resolveSubtaskAssigneeProfile(
      { Api: Api, getUserProfile: getUserProfile },
      chatId
    )
    if (linked) {
      chatLinkedProfiles.set(String(chatId), linked)
    }
    return linked
  }

  function applyLinkedProfileToSession(session, linked) {
    if (!linked) {
      session.linkedProfile = null
      session.linkedAssigneeUserId = null
      return
    }
    session.linkedProfile = linked.profile
    session.linkedAssigneeUserId = linked.assigneeUserId
  }

  async function maybeApplyLinkedEmployee(chatId, session) {
    let profile = session.linkedProfile
    if (!profile) {
      const linked = await getLinkedProfile(chatId)
      profile = linked && linked.profile
    }
    if (!profile || !session.index) return false

    const department = session.index.departments.find(function (d) {
      return d.name === profile.department
    })
    if (!department) return false
    if (department.employees.indexOf(profile.employee) === -1) {
      return false
    }

    session.selection.department = department.name
    session.selection.employee = profile.employee
    session.options = DAYS.slice()
    session.step = 'startDay'
    await askList(
      chatId,
      'Ответственный: ' +
        profile.employee +
        '\nВыберите начало недели:',
      session.options.map(function (d) {
        return DAY_SHORT[d] + ' (' + d + ')'
      })
    )
    return true
  }

  async function showStatus(chatId, userId) {
    const config = await getConfig()
    const linked = await getLinkedProfile(chatId)
    const profile = linked ? linked.profile : await getUserProfile(userId)
    const access = assertAccess
      ? assertAccess(config.excelPath)
      : { ok: false, error: 'нет проверки' }
    const lines = [
      'Excel: ' + (config.excelPath || 'не задан'),
      'Доступ: ' + (access.ok ? 'да' : access.error)
    ]
    if (linked) {
      lines.push(
        'Ответственный (подзадача): ' +
          profile.employee +
          ' (' +
          profile.department +
          ')'
      )
      if (profile.rate != null) {
        lines.push(formatRateLine(profile.rate))
      }
      if (profile.lunchMinutes != null) {
        lines.push(formatLunchLine(profile.lunchMinutes))
      }
    } else if (profile) {
      lines.push('Профиль: ' + profile.employee + ' (' + profile.department + ')')
      lines.push(formatRateLine(profile.rate))
      lines.push(formatLunchLine(profile.lunchMinutes))
    }
    await reply(chatId, lines.join('\n'))
  }

  async function showMySchedule(chatId, userId) {
    const config = await getConfig()
    const linked = await getLinkedProfile(chatId)
    let profile = linked ? linked.profile : null

    if (!profile) {
      const task = await fetchTask(Api, chatId)
      if (isSubtask(task) && getTaskAssigned(task).length) {
        await reply(
          chatId,
          'У ответственного нет привязанного профиля. Попросите его выполнить /my в чате задачи.'
        )
        return
      }
      profile = await getUserProfile(userId)
    }

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
      yearHint,
      { rate: profile.rate, lunchMinutes: profile.lunchMinutes }
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
      const linked = await getLinkedProfile(chatId)
      applyLinkedProfileToSession(session, linked)
      sessions.set(key, session)
      const menu = [mainMenuText()]
      if (linked) {
        menu.unshift(formatLinkedProfileMessage(linked.profile))
      }
      await reply(chatId, menu.join('\n\n'))
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
        const empProfile = await resolveEmployeeProfile(session.selection.employee)
        const result = await getEmployeeWeekSchedule(
          config.excelPath,
          session.selection.sheetName,
          session.selection.weekId,
          session.selection.employee,
          extractYearFromSheetName(session.selection.sheetName),
          { rate: empProfile.rate, lunchMinutes: empProfile.lunchMinutes }
        )
        await reply(chatId, session.selection.employee + '\n' + result.text)
        sessions.delete(key)
        return
      }
      session.options = ['Пошагово', 'Одним сообщением']
      session.step = 'input-mode'
      await askList(chatId, 'Как заполнить?', session.options)
      return
    }

    if (session.step === 'input-mode') {
      const idx = parseChoice(text, 2)
      if (idx === null) {
        await askList(chatId, 'Как заполнить?', session.options)
        return
      }
      if (idx === 1) {
        session.step = 'freeform-text'
        await reply(
          chatId,
          'Напишите расписание одним сообщением.\nПример: Пн 9:00-18:00, Вт 10:00-19:00, Ср 9-18'
        )
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

    if (session.step === 'freeform-text') {
      const slots =
        (session.index && session.index.timeSlots) ||
        require('../constants').TIME_SLOTS
      const parsed = parseFreeformSchedule(text, slots)
      if (!parsed.ok) {
        await reply(chatId, parsed.error)
        return
      }
      session.freeformEntries = parsed.entries
      const types = Object.values(WORK_TYPES)
      session.workTypes = types
      session.step = 'freeform-work'
      await askList(
        chatId,
        'Разобрано:\n' +
          formatFreeformPreview(parsed.entries) +
          '\n\nВыберите вид работы:',
        types.map(function (t) {
          return t.emoji + ' ' + t.label
        })
      )
      return
    }

    if (session.step === 'freeform-work') {
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
      session.step = 'freeform-confirm'
      await reply(
        chatId,
        [
          'Превью (свободный ввод):',
          'Сотрудник: ' + session.selection.employee,
          formatFreeformPreview(session.freeformEntries),
          'Тип: ' +
            WORK_TYPES[session.selection.workTypeId].emoji +
            ' ' +
            WORK_TYPES[session.selection.workTypeId].label,
          '',
          'Ответьте: 1 — сохранить, 2 — отмена'
        ].join('\n')
      )
      return
    }

    if (session.step === 'freeform-confirm') {
      const idx = parseChoice(text, 2)
      if (idx === null) {
        await reply(chatId, 'Ответьте: 1 — сохранить, 2 — отмена')
        return
      }
      if (idx === 1) {
        sessions.delete(key)
        await reply(chatId, 'Заполнение отменено.')
        return
      }
      let cellsUpdated = 0
      let backupPath = null
      let driveSyncHint = null
      for (const entry of session.freeformEntries) {
        const result = await applyScheduleRange(
          config.excelPath,
          session.selection.sheetName,
          {
            weekId: session.selection.weekId,
            employee: session.selection.employee,
            startDay: entry.day,
            endDay: entry.day,
            startTime: entry.startTime,
            endTime: entry.endTime,
            workTypeId: session.selection.workTypeId
          }
        )
        cellsUpdated += result.cellsUpdated
        backupPath = result.backupPath
        driveSyncHint = result.driveSyncHint
      }
      sessions.delete(key)
      const lines = [
        'Расписание сохранено',
        'Обновлено ячеек: ' + cellsUpdated,
        'Резервная копия: ' + backupPath,
        driveSyncHint || 'Синхронизация Google Drive: 5–30 сек.'
      ]
      try {
        const empProfile = await resolveEmployeeProfile(session.selection.employee)
        const yearHint = extractYearFromSheetName(session.selection.sheetName)
        const summary = await formatNormSummary(
          config.excelPath,
          session.selection.sheetName,
          session.selection.weekId,
          session.selection.employee,
          yearHint,
          empProfile.rate,
          empProfile.lunchMinutes
        )
        lines.push('', summary)
      } catch (summaryError) {
        lines.push('', 'Не удалось пересчитать часы: ' + summaryError.message)
      }
      await reply(chatId, lines.join('\n'))
      return
    }

    if (session.step === 'profile-emp') {
      const idx = parseChoice(text, session.options.length)
      if (idx === null) {
        await askList(chatId, 'Выберите себя в списке:', session.options)
        return
      }
      session.selection.employee = session.options[idx]
      session.options = ['1 — полная ставка (40 ч/нед)', '0,5 — полставки (20 ч/нед)']
      session.step = 'profile-rate'
      await askList(chatId, 'Выберите ставку:', session.options)
      return
    }

    if (session.step === 'profile-rate') {
      const idx = parseChoice(text, 2)
      if (idx === null) {
        await askList(chatId, 'Выберите ставку:', session.options)
        return
      }
      session.selection.rate = idx === 1 ? 0.5 : 1
      session.options = [
        'Без обеда',
        '30 мин',
        '45 мин',
        '1 ч',
        '1,5 ч'
      ]
      session.lunchValues = [0, 30, 45, 60, 90]
      session.step = 'profile-lunch'
      await askList(
        chatId,
        formatRateLine(session.selection.rate) +
          '\nВыберите обед (вычитается из часов дня):',
        session.options
      )
      return
    }

    if (session.step === 'profile-lunch') {
      const idx = parseChoice(text, session.options.length)
      if (idx === null) {
        await askList(chatId, 'Выберите обед:', session.options)
        return
      }
      const lunchMinutes = normalizeLunchMinutes(session.lunchValues[idx])
      await saveUserProfile(userId, {
        department: session.selection.department,
        employee: session.selection.employee,
        sheetName: session.selection.sheetName,
        rate: session.selection.rate,
        lunchMinutes: lunchMinutes
      })
      await reply(
        chatId,
        [
          'Профиль привязан:',
          session.selection.employee,
          session.selection.department,
          formatRateLine(session.selection.rate),
          formatLunchLine(lunchMinutes)
        ].join('\n')
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
      const lines = [
        'Расписание сохранено',
        'Обновлено ячеек: ' + result.cellsUpdated,
        'Резервная копия: ' + result.backupPath,
        result.driveSyncHint ||
          'Синхронизация Google Drive: 5–30 сек.'
      ]
      try {
        const empProfile = await resolveEmployeeProfile(session.selection.employee)
        const yearHint = extractYearFromSheetName(session.selection.sheetName)
        const summary = await formatNormSummary(
          config.excelPath,
          session.selection.sheetName,
          session.selection.weekId,
          session.selection.employee,
          yearHint,
          empProfile.rate,
          empProfile.lunchMinutes
        )
        lines.push('', summary)
      } catch (summaryError) {
        lines.push('', 'Не удалось пересчитать часы: ' + summaryError.message)
      }
      await reply(chatId, lines.join('\n'))
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
    if (session.flow === 'schedule') {
      if (await maybeApplyLinkedEmployee(chatId, session)) {
        return
      }
    }
    session.options = session.index.departments.map(function (d) {
      return d.name
    })
    session.step = 'department'
    await askList(chatId, 'Выберите отдел:', session.options)
  }

  async function onTaskChanged(task, prevTaskData) {
    if (!task || !task.id || !isSubtask(task)) return

    const assigned = getTaskAssigned(task)
    if (!assigned.length) {
      chatLinkedProfiles.delete(String(task.id))
      return
    }

    const linked = await resolveSubtaskAssigneeProfile(
      { Api: Api, getUserProfile: getUserProfile },
      task.id
    )

    if (!linked) {
      chatLinkedProfiles.delete(String(task.id))
      if (assignedChanged(task, prevTaskData)) {
        await reply(
          task.id,
          'Ответственный назначен, но профиль расписания не привязан (/my).'
        )
      }
      return
    }

    const prevLinked = chatLinkedProfiles.get(String(task.id))
    chatLinkedProfiles.set(String(task.id), linked)

    const chatPrefix = String(task.id) + ':'
    sessions.forEach(function (session, key) {
      if (String(key).indexOf(chatPrefix) === 0) {
        applyLinkedProfileToSession(session, linked)
      }
    })

    const shouldNotify =
      !prevLinked ||
      prevLinked.assigneeUserId !== linked.assigneeUserId ||
      assignedChanged(task, prevTaskData)

    if (shouldNotify) {
      await reply(task.id, formatLinkedProfileMessage(linked.profile))
    }
  }

  return { handleMessage: handleMessage, onTaskChanged: onTaskChanged }
}

module.exports = { createYougileChatBot, BOT_LABEL }
