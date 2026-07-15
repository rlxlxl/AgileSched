const { DAYS, DAY_SHORT, WORK_TYPES, TIME_SLOTS } = require('../constants')
const { listSheets, getScheduleIndex } = require('../schedule-index')
const { applyScheduleRange, assertExcelAccessible } = require('../excel-writer')
const { getEmployeeWeekSchedule } = require('../schedule-reader')
const {
  findSheetForDate,
  findCurrentWeek,
  extractYearFromSheetName
} = require('../week-dates')

const sessions = new Map()

function choicesFromLabels(labels, prefix) {
  return labels.map(function (label, index) {
    return { id: prefix + ':' + index, label: String(label) }
  })
}

function buildPreview(selection) {
  const workType = WORK_TYPES[selection.workTypeId]
  return [
    'Превью:',
    'Лист: ' + selection.sheetName,
    'Неделя: ' + selection.weekLabel,
    'Отдел: ' + selection.department,
    'Сотрудник: ' + selection.employee,
    'Дни: ' +
      DAY_SHORT[selection.startDay] +
      ' — ' +
      DAY_SHORT[selection.endDay],
    'Время: ' + selection.startTime + ' — ' + selection.endTime,
    'Тип: ' + workType.emoji + ' ' + workType.label
  ].join('\n')
}

function idleState(panelExtra) {
  return Object.assign(
    {
      mode: 'idle',
      title: 'Расписание РиМ',
      message: 'Выберите действие',
      choices: [
        { id: 'menu:fill', label: 'Заполнить' },
        { id: 'menu:view', label: 'Показать' },
        { id: 'menu:profile', label: 'Профиль' },
        { id: 'menu:settings', label: 'Настройки' },
        { id: 'menu:status', label: 'Статус' },
        { id: 'menu:restart', label: 'Перезапуск бота' }
      ],
      actions: []
    },
    panelExtra || {}
  )
}

function wizardState(session, message, choices) {
  return {
    mode: 'wizard',
    title: 'Расписание РиМ',
    message: message,
    choices: choices || [],
    actions: [{ id: 'action:cancel', label: 'Отмена' }],
    step: session.step,
    flow: session.flow
  }
}

function doneState(message) {
  return {
    mode: 'done',
    title: 'Расписание РиМ',
    message: message,
    choices: [{ id: 'menu:home', label: 'В меню' }],
    actions: []
  }
}

function settingsState(settings) {
  return {
    mode: 'settings',
    title: 'Настройки расписания',
    message:
      'Excel: ' +
      ((settings && settings.excelPath) || 'не задан') +
      '\n' +
      ((settings && settings.excelMessage) || '') +
      '\nТокен: ' +
      ((settings && settings.telegramToken) || 'не задан'),
    choices: [
      { id: 'settings:edit', label: 'Изменить путь / токен' },
      { id: 'menu:home', label: 'В меню' }
    ],
    actions: [],
    settings: settings || null
  }
}

function parseChoiceId(choiceId) {
  const parts = String(choiceId || '').split(':')
  return { prefix: parts[0], rest: parts.slice(1).join(':'), index: Number(parts[1]) }
}

function createUiSession(deps) {
  const {
    getConfig,
    getUserProfile,
    saveUserProfile,
    getBotStatus,
    restartBot,
    getSettingsSnapshot,
    saveSettingsValues
  } = deps

  function getSession(userId) {
    const key = String(userId || 'ui')
    return sessions.get(key)
  }

  function setSession(userId, session) {
    sessions.set(String(userId || 'ui'), session)
  }

  function clearSession(userId) {
    sessions.delete(String(userId || 'ui'))
  }

  async function getPanelState(userId) {
    const session = getSession(userId)
    if (session && session.pendingUi) {
      return session.pendingUi
    }
    const status = await getBotStatus()
    const access = assertExcelAccessible(status.excelPath)
    const statusLine = status.running
      ? 'Бот Telegram: запущен'
      : 'Бот Telegram: остановлен' + (status.error ? ' — ' + status.error : '')
    return idleState({
      message:
        statusLine +
        '\n' +
        (access.ok ? 'Excel: OK' : 'Excel: ' + access.error),
      excelOk: access.ok,
      botRunning: Boolean(status.running)
    })
  }

  async function askDepartment(session) {
    const labels = session.index.departments.map(function (d) {
      return d.name
    })
    session.step = 'department'
    session.optionMeta = session.index.departments
    return wizardState(session, 'Выберите отдел:', choicesFromLabels(labels, 'dept'))
  }

  async function startFill(userId) {
    const config = await getConfig()
    const access = assertExcelAccessible(config.excelPath)
    if (!access.ok) {
      return doneState(access.error)
    }

    const sheets = await listSheets(config.excelPath)
    if (!sheets.length) {
      return doneState('В Excel нет листов расписания.')
    }

    const session = {
      flow: 'fill',
      step: 'sheet',
      selection: {},
      config: config,
      optionMeta: sheets
    }
    setSession(userId, session)

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
        const ui = await askDepartment(session)
        session.pendingUi = ui
        return ui
      }
      session.step = 'week'
      session.optionMeta = index.weeks
      const ui = wizardState(
        session,
        'Лист: ' + autoSheet + '\nВыберите неделю:',
        index.weeks.map(function (w, i) {
          return { id: 'week:' + i, label: w.label }
        })
      )
      session.pendingUi = ui
      return ui
    }

    const ui = wizardState(
      session,
      'Выберите месяц (лист):',
      choicesFromLabels(sheets, 'sheet')
    )
    session.pendingUi = ui
    return ui
  }

  async function startView(userId) {
    const config = await getConfig()
    const access = assertExcelAccessible(config.excelPath)
    if (!access.ok) {
      return doneState(access.error)
    }

    const sheets = await listSheets(config.excelPath)
    const session = {
      flow: 'view',
      step: 'sheet',
      selection: {},
      config: config,
      optionMeta: sheets
    }
    setSession(userId, session)

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
        const ui = await askDepartment(session)
        session.pendingUi = ui
        return ui
      }
      session.step = 'week'
      session.optionMeta = index.weeks
      const ui = wizardState(
        session,
        'Выберите неделю:',
        index.weeks.map(function (w, i) {
          return { id: 'week:' + i, label: w.label }
        })
      )
      session.pendingUi = ui
      return ui
    }

    const ui = wizardState(
      session,
      'Выберите месяц (лист):',
      choicesFromLabels(sheets, 'sheet')
    )
    session.pendingUi = ui
    return ui
  }

  async function startProfile(userId) {
    const config = await getConfig()
    const access = assertExcelAccessible(config.excelPath)
    if (!access.ok) {
      return doneState(access.error)
    }
    const sheets = await listSheets(config.excelPath)
    const defaultSheet = sheets[sheets.length - 1]
    const index = await getScheduleIndex(config.excelPath, defaultSheet)
    const session = {
      flow: 'profile',
      step: 'department',
      selection: { sheetName: defaultSheet },
      config: config,
      index: index,
      optionMeta: index.departments
    }
    setSession(userId, session)
    const ui = await askDepartment(session)
    session.pendingUi = ui
    return ui
  }

  async function handlePick(userId, choiceId) {
    if (!choiceId) {
      return getPanelState(userId)
    }

    if (choiceId === 'action:cancel' || choiceId === 'menu:home') {
      clearSession(userId)
      return getPanelState(userId)
    }

    if (choiceId === 'menu:fill') {
      return startFill(userId)
    }
    if (choiceId === 'menu:view') {
      return startView(userId)
    }
    if (choiceId === 'menu:profile') {
      return startProfile(userId)
    }
    if (choiceId === 'menu:settings') {
      const settings = await getSettingsSnapshot()
      clearSession(userId)
      return settingsState(settings)
    }
    if (choiceId === 'menu:status') {
      const status = await getBotStatus()
      clearSession(userId)
      return doneState(
        [
          status.running ? 'Бот: запущен' : 'Бот: остановлен',
          status.error ? 'Ошибка: ' + status.error : null,
          'Excel: ' + (status.excelPath || 'не задан'),
          status.excelOk ? 'Доступ: да' : 'Доступ: ' + status.excelMessage
        ]
          .filter(Boolean)
          .join('\n')
      )
    }
    if (choiceId === 'menu:restart') {
      const status = await restartBot()
      clearSession(userId)
      return doneState(
        status.running
          ? 'Бот перезапущен'
          : 'Не удалось запустить: ' + (status.error || 'неизвестно')
      )
    }
    if (choiceId === 'settings:edit') {
      return {
        mode: 'settings-edit',
        title: 'Настройки',
        message: 'Введите путь и токен в диалогах',
        choices: [],
        actions: [{ id: 'menu:home', label: 'Отмена' }],
        needsPrompt: true
      }
    }

    const session = getSession(userId)
    if (!session) {
      return getPanelState(userId)
    }

    const parsed = parseChoiceId(choiceId)
    let ui

    if (session.step === 'sheet' && parsed.prefix === 'sheet') {
      const sheetName = session.optionMeta[parsed.index]
      session.selection.sheetName = sheetName
      const index = await getScheduleIndex(session.config.excelPath, sheetName)
      session.index = index
      session.step = 'week'
      session.optionMeta = index.weeks
      ui = wizardState(
        session,
        'Лист: ' + sheetName + '\nВыберите неделю:',
        index.weeks.map(function (w, i) {
          return { id: 'week:' + i, label: w.label }
        })
      )
    } else if (session.step === 'week' && parsed.prefix === 'week') {
      const week = session.optionMeta[parsed.index]
      session.selection.weekId = week.id
      session.selection.weekLabel = week.label
      ui = await askDepartment(session)
    } else if (session.step === 'department' && parsed.prefix === 'dept') {
      const department = session.optionMeta[parsed.index]
      session.selection.department = department.name
      session.selection.departmentEmployees = department.employees
      session.optionMeta = department.employees
      session.step = session.flow === 'profile' ? 'profile-emp' : 'employee'
      ui = wizardState(
        session,
        session.flow === 'profile'
          ? 'Выберите себя в списке:'
          : 'Выберите сотрудника:',
        choicesFromLabels(department.employees, 'emp')
      )
    } else if (session.step === 'employee' && parsed.prefix === 'emp') {
      const employee = session.optionMeta[parsed.index]
      session.selection.employee = employee
      if (session.flow === 'view') {
        const result = await getEmployeeWeekSchedule(
          session.config.excelPath,
          session.selection.sheetName,
          session.selection.weekId,
          employee,
          extractYearFromSheetName(session.selection.sheetName)
        )
        clearSession(userId)
        return doneState(employee + '\n' + result.text)
      }
      session.step = 'startDay'
      session.optionMeta = DAYS
      ui = wizardState(
        session,
        'Сотрудник: ' + employee + '\nНачало недели:',
        DAYS.map(function (d, i) {
          return { id: 'day:' + i, label: DAY_SHORT[d] + ' (' + d + ')' }
        })
      )
    } else if (session.step === 'profile-emp' && parsed.prefix === 'emp') {
      const employee = session.optionMeta[parsed.index]
      await saveUserProfile(userId, {
        department: session.selection.department,
        employee: employee,
        sheetName: session.selection.sheetName
      })
      clearSession(userId)
      return doneState(
        'Профиль: ' + employee + '\n' + session.selection.department
      )
    } else if (session.step === 'startDay' && parsed.prefix === 'day') {
      session.selection.startDay = DAYS[parsed.index]
      session.allowedDays = DAYS.slice(parsed.index)
      session.step = 'endDay'
      session.optionMeta = session.allowedDays
      ui = wizardState(
        session,
        'Конец недели:',
        session.allowedDays.map(function (d, i) {
          return { id: 'eday:' + i, label: DAY_SHORT[d] + ' (' + d + ')' }
        })
      )
    } else if (session.step === 'endDay' && parsed.prefix === 'eday') {
      session.selection.endDay = session.allowedDays[parsed.index]
      const slots =
        (session.index && session.index.timeSlots) || TIME_SLOTS
      session.slots = slots.slice()
      session.step = 'startTime'
      session.optionMeta = session.slots
      ui = wizardState(
        session,
        'Начальное время:',
        session.slots.map(function (s, i) {
          return { id: 'stime:' + i, label: s }
        })
      )
    } else if (session.step === 'startTime' && parsed.prefix === 'stime') {
      session.selection.startTime = session.slots[parsed.index]
      session.allowedSlots = session.slots.slice(parsed.index)
      session.step = 'endTime'
      session.optionMeta = session.allowedSlots
      ui = wizardState(
        session,
        'Конечное время:',
        session.allowedSlots.map(function (s, i) {
          return { id: 'etime:' + i, label: s }
        })
      )
    } else if (session.step === 'endTime' && parsed.prefix === 'etime') {
      session.selection.endTime = session.allowedSlots[parsed.index]
      const types = Object.values(WORK_TYPES)
      session.workTypes = types
      session.step = 'workType'
      ui = wizardState(
        session,
        'Вид работы:',
        types.map(function (t, i) {
          return { id: 'work:' + i, label: t.emoji + ' ' + t.label }
        })
      )
    } else if (session.step === 'workType' && parsed.prefix === 'work') {
      session.selection.workTypeId = session.workTypes[parsed.index].id
      session.step = 'confirm'
      ui = wizardState(session, buildPreview(session.selection), [
        { id: 'confirm:save', label: 'Сохранить' },
        { id: 'confirm:cancel', label: 'Отмена' }
      ])
    } else if (session.step === 'confirm' && parsed.prefix === 'confirm') {
      if (parsed.rest === 'cancel') {
        clearSession(userId)
        return doneState('Заполнение отменено.')
      }
      const result = await applyScheduleRange(
        session.config.excelPath,
        session.selection.sheetName,
        session.selection
      )
      clearSession(userId)
      return doneState(
        [
          'Сохранено. Ячеек: ' + result.cellsUpdated,
          result.driveSyncHint ||
            'Синхронизация Google Drive: 5–30 сек.'
        ].join('\n')
      )
    } else {
      ui = session.pendingUi || (await getPanelState(userId))
    }

    if (ui) {
      session.pendingUi = ui
    }
    return ui
  }

  async function scheduleStart(userId, mode) {
    if (mode === 'fill') return startFill(userId)
    if (mode === 'view') return startView(userId)
    if (mode === 'profile') return startProfile(userId)
    if (mode === 'settings') {
      return settingsState(await getSettingsSnapshot())
    }
    clearSession(userId)
    return getPanelState(userId)
  }

  async function scheduleCancel(userId) {
    clearSession(userId)
    return getPanelState(userId)
  }

  async function applySettingsFromUi(userId, values) {
    await saveSettingsValues(values || {})
    clearSession(userId)
    return doneState('Настройки сохранены. Бот перезапущен при необходимости.')
  }

  return {
    getPanelState: getPanelState,
    scheduleStart: scheduleStart,
    schedulePick: handlePick,
    scheduleCancel: scheduleCancel,
    applySettingsFromUi: applySettingsFromUi
  }
}

module.exports = { createUiSession }
