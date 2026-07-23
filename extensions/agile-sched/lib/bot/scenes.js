const { Scenes, session, Markup } = require('telegraf')
const { DAYS, DAY_SHORT, WORK_TYPES } = require('../constants')
const { listSheets, getScheduleIndex } = require('../schedule-index')
const { applyScheduleRange } = require('../excel-writer')
const { getEmployeeWeekSchedule } = require('../schedule-reader')
const { formatNormSummary } = require('../hours-calculator')
const {
  formatRateLine,
  formatLunchLine,
  normalizeLunchMinutes,
  matchProfileInIndex
} = require('../profile')
const {
  parseFreeformSchedule,
  formatFreeformPreview
} = require('../freeform-schedule')
const {
  findSheetForDate,
  findCurrentWeek,
  extractYearFromSheetName
} = require('../week-dates')
const {
  sheetKeyboard,
  weekKeyboard,
  departmentKeyboard,
  employeeKeyboard,
  dayKeyboard,
  timeKeyboard,
  workTypeKeyboard,
  confirmKeyboard,
  mainMenuKeyboard,
  rateKeyboard,
  lunchKeyboard,
  inputModeKeyboard
} = require('./keyboards')

function buildPreview(selection) {
  const workType = WORK_TYPES[selection.workTypeId]
  return [
    'Превью изменений:',
    `Лист: ${selection.sheetName}`,
    `Неделя: ${selection.weekLabel}`,
    `Отдел: ${selection.department}`,
    `Сотрудник: ${selection.employee}`,
    `Дни: ${DAY_SHORT[selection.startDay]} — ${DAY_SHORT[selection.endDay]}`,
    `Время: ${selection.startTime} — ${selection.endTime}`,
    `Тип: ${workType.emoji} ${workType.label}`
  ].join('\n')
}

function buildFreeformPreview(selection, entries) {
  const workType = WORK_TYPES[selection.workTypeId]
  return [
    'Превью (свободный ввод):',
    `Лист: ${selection.sheetName}`,
    `Неделя: ${selection.weekLabel}`,
    `Сотрудник: ${selection.employee}`,
    formatFreeformPreview(entries),
    `Тип: ${workType.emoji} ${workType.label}`
  ].join('\n')
}

async function leaveToMenu(ctx) {
  await ctx.reply('Выберите действие:', mainMenuKeyboard())
  return ctx.scene.leave()
}

async function replyEmployeeSchedule(
  ctx,
  config,
  sheetName,
  weekId,
  employeeName,
  rate,
  lunchMinutes
) {
  const yearHint = extractYearFromSheetName(sheetName)
  const result = await getEmployeeWeekSchedule(
    config.excelPath,
    sheetName,
    weekId,
    employeeName,
    yearHint,
    { rate: rate, lunchMinutes: lunchMinutes }
  )
  await ctx.reply(`${employeeName}\n${result.text}`)
}

async function resolveEmployeeProfile(getProfileForEmployee, getRateForEmployee, employee) {
  if (getProfileForEmployee) {
    const profile = await getProfileForEmployee(employee)
    if (profile) return profile
  }
  const rate = getRateForEmployee ? await getRateForEmployee(employee) : 1
  return { rate: rate, lunchMinutes: 60 }
}

async function applyEntriesAndSummary(config, selection, entries, profile) {
  let cellsUpdated = 0
  let backupPath = null
  let driveSyncHint = null
  for (const entry of entries) {
    const result = await applyScheduleRange(config.excelPath, selection.sheetName, {
      weekId: selection.weekId,
      weekLabel: selection.weekLabel,
      department: selection.department,
      employee: selection.employee,
      startDay: entry.day,
      endDay: entry.day,
      startTime: entry.startTime,
      endTime: entry.endTime,
      workTypeId: selection.workTypeId
    })
    cellsUpdated += result.cellsUpdated
    backupPath = result.backupPath
    driveSyncHint = result.driveSyncHint
  }
  const lines = [
    'Расписание сохранено',
    `Обновлено ячеек: ${cellsUpdated}`,
    backupPath ? `Резервная копия: ${backupPath}` : null,
    driveSyncHint ||
      'Синхронизация Google Drive: 5–30 сек. Откройте .xlsx по ссылке (не Google Таблицы).'
  ].filter(Boolean)
  try {
    const yearHint = extractYearFromSheetName(selection.sheetName)
    const summary = await formatNormSummary(
      config.excelPath,
      selection.sheetName,
      selection.weekId,
      selection.employee,
      yearHint,
      profile.rate,
      profile.lunchMinutes
    )
    lines.push('', summary)
  } catch (summaryError) {
    lines.push('', 'Не удалось пересчитать часы: ' + summaryError.message)
  }
  return lines.join('\n')
}

function createViewWizard(getConfig, getProfileForEmployee, getRateForEmployee) {
  const wizard = new Scenes.WizardScene(
    'view-wizard',
    async (ctx) => {
      const config = await getConfig()
      const sheets = await listSheets(config.excelPath)
      if (!sheets.length) {
        await ctx.reply('В файле Excel не найдены листы расписания.')
        return leaveToMenu(ctx)
      }

      const today = new Date()
      ctx.wizard.state.selection = {}
      ctx.wizard.state.config = config

      const autoSheet = findSheetForDate(sheets, today)
      if (autoSheet) {
        const index = await getScheduleIndex(config.excelPath, autoSheet)
        const yearHint = extractYearFromSheetName(autoSheet)
        const currentWeek = findCurrentWeek(index.weeks, today, yearHint)

        ctx.wizard.state.selection.sheetName = autoSheet
        ctx.wizard.state.index = index

        if (currentWeek) {
          ctx.wizard.state.selection.weekId = currentWeek.id
          ctx.wizard.state.selection.weekLabel = currentWeek.label
          await ctx.reply(
            [
              `Текущая неделя: ${currentWeek.label}`,
              'Выберите отдел:'
            ].join('\n'),
            departmentKeyboard(index.departments)
          )
          return ctx.wizard.selectStep(3)
        }

        await ctx.reply(
          `Лист: ${autoSheet}\nВыберите неделю:`,
          weekKeyboard(index.weeks)
        )
        return ctx.wizard.selectStep(2)
      }

      ctx.wizard.state.sheets = sheets
      await ctx.reply('Выберите месяц (лист):', sheetKeyboard(sheets))
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const sheetName = ctx.callbackQuery.data.replace('sheet:', '')
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.sheetName = sheetName

      const index = await getScheduleIndex(
        ctx.wizard.state.config.excelPath,
        sheetName
      )
      ctx.wizard.state.index = index
      await ctx.editMessageText(
        `Лист: ${sheetName}\nВыберите неделю:`,
        weekKeyboard(index.weeks)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const weekId = ctx.callbackQuery.data.replace('week:', '')
      const week = ctx.wizard.state.index.weeks.find((item) => item.id === weekId)
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.weekId = weekId
      ctx.wizard.state.selection.weekLabel = week.label
      await ctx.editMessageText(
        `Неделя: ${week.label}\nВыберите отдел:`,
        departmentKeyboard(ctx.wizard.state.index.departments)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const deptIndex = Number(ctx.callbackQuery.data.replace('dept:', ''))
      const department = ctx.wizard.state.index.departments[deptIndex]
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.department = department.name
      ctx.wizard.state.selection.departmentEmployees = department.employees
      await ctx.editMessageText(
        `Отдел: ${department.name}\nВыберите сотрудника:`,
        employeeKeyboard(department.employees)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const empIndex = Number(ctx.callbackQuery.data.replace('emp:', ''))
      const employee = ctx.wizard.state.selection.departmentEmployees[empIndex]
      await ctx.answerCbQuery()

      const { selection, config } = ctx.wizard.state
      try {
        const profile = await resolveEmployeeProfile(
          getProfileForEmployee,
          getRateForEmployee,
          employee
        )
        await replyEmployeeSchedule(
          ctx,
          config,
          selection.sheetName,
          selection.weekId,
          employee,
          profile.rate,
          profile.lunchMinutes
        )
      } catch (error) {
        await ctx.reply(`Ошибка: ${error.message}`)
      }
      return leaveToMenu(ctx)
    }
  )

  wizard.command('cancel', async (ctx) => {
    await ctx.reply('Отменено.')
    return leaveToMenu(ctx)
  })

  return wizard
}

function createScheduleWizard(getConfig, getUserProfile, saveUserProfile, getProfileForEmployee, getRateForEmployee) {
  async function applyBoundProfile(ctx) {
    if (!getUserProfile) return null
    const profile = await getUserProfile(ctx.from.id)
    const matched = matchProfileInIndex(ctx.wizard.state.index, profile)
    if (!matched) return null
    ctx.wizard.state.selection.department = matched.department
    ctx.wizard.state.selection.departmentEmployees = matched.employees
    ctx.wizard.state.selection.employee = matched.employee
    return matched
  }

  const wizard = new Scenes.WizardScene(
    'schedule-wizard',
    async (ctx) => {
      const config = await getConfig()
      const sheets = await listSheets(config.excelPath)
      if (!sheets.length) {
        await ctx.reply('В файле Excel не найдены листы расписания.')
        return leaveToMenu(ctx)
      }

      const today = new Date()
      ctx.wizard.state.selection = {}
      ctx.wizard.state.config = config
      ctx.wizard.state.sheets = sheets

      const autoSheet = findSheetForDate(sheets, today)
      if (autoSheet) {
        const index = await getScheduleIndex(config.excelPath, autoSheet)
        const yearHint = extractYearFromSheetName(autoSheet)
        const currentWeek = findCurrentWeek(index.weeks, today, yearHint)

        ctx.wizard.state.selection.sheetName = autoSheet
        ctx.wizard.state.index = index

        if (currentWeek) {
          ctx.wizard.state.selection.weekId = currentWeek.id
          ctx.wizard.state.selection.weekLabel = currentWeek.label
          const matched = await applyBoundProfile(ctx)
          if (matched) {
            await ctx.reply(
              [
                `Лист: ${autoSheet}`,
                `Текущая неделя: ${currentWeek.label}`,
                `Профиль: ${matched.employee}`,
                'Как заполнить?'
              ].join('\n'),
              inputModeKeyboard()
            )
            return ctx.wizard.selectStep(5)
          }
          await ctx.reply(
            [
              `Лист: ${autoSheet}`,
              `Текущая неделя: ${currentWeek.label}`,
              'Выберите отдел:'
            ].join('\n'),
            departmentKeyboard(index.departments)
          )
          return ctx.wizard.selectStep(3)
        }

        await ctx.reply(
          `Лист: ${autoSheet}\nНе удалось определить текущую неделю.\nВыберите неделю:`,
          weekKeyboard(index.weeks)
        )
        return ctx.wizard.selectStep(2)
      }

      await ctx.reply('Выберите месяц (лист):', sheetKeyboard(sheets))
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const sheetName = ctx.callbackQuery.data.replace('sheet:', '')
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.sheetName = sheetName

      const index = await getScheduleIndex(
        ctx.wizard.state.config.excelPath,
        sheetName
      )
      ctx.wizard.state.index = index
      await ctx.editMessageText(
        `Лист: ${sheetName}\nВыберите неделю:`,
        weekKeyboard(index.weeks)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const weekId = ctx.callbackQuery.data.replace('week:', '')
      const week = ctx.wizard.state.index.weeks.find((item) => item.id === weekId)
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.weekId = weekId
      ctx.wizard.state.selection.weekLabel = week.label
      const matched = await applyBoundProfile(ctx)
      if (matched) {
        await ctx.editMessageText(
          `Неделя: ${week.label}\nПрофиль: ${matched.employee}\nКак заполнить?`,
          inputModeKeyboard()
        )
        return ctx.wizard.selectStep(5)
      }
      await ctx.editMessageText(
        `Неделя: ${week.label}\nВыберите отдел:`,
        departmentKeyboard(ctx.wizard.state.index.departments)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const deptIndex = Number(ctx.callbackQuery.data.replace('dept:', ''))
      const department = ctx.wizard.state.index.departments[deptIndex]
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.department = department.name
      ctx.wizard.state.selection.departmentEmployees = department.employees
      await ctx.editMessageText(
        `Отдел: ${department.name}\nВыберите сотрудника:`,
        employeeKeyboard(department.employees)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const empIndex = Number(ctx.callbackQuery.data.replace('emp:', ''))
      const employee = ctx.wizard.state.selection.departmentEmployees[empIndex]
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.employee = employee
      await ctx.editMessageText(
        `Сотрудник: ${employee}\nКак заполнить?`,
        inputModeKeyboard()
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const mode = ctx.callbackQuery.data.replace('mode:', '')
      await ctx.answerCbQuery()
      ctx.wizard.state.inputMode = mode
      if (mode === 'freeform') {
        await ctx.editMessageText(
          'Напишите расписание одним сообщением.\nПример: Пн 9:00-18:00, Вт 10:00-19:00, Ср 9-18'
        )
        return ctx.wizard.selectStep(12)
      }
      await ctx.editMessageText(
        'Выберите начало недели:',
        dayKeyboard('startday')
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const startDay = ctx.callbackQuery.data.replace('startday:', '')
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.startDay = startDay
      const startIdx = DAYS.indexOf(startDay)
      const allowedDays = DAYS.slice(startIdx)
      await ctx.editMessageText(
        `Начало: ${DAY_SHORT[startDay]}\nВыберите конец недели:`,
        dayKeyboard('endday', allowedDays)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const endDay = ctx.callbackQuery.data.replace('endday:', '')
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.endDay = endDay
      const slots = ctx.wizard.state.index.timeSlots
      await ctx.editMessageText(
        `Дни: ${DAY_SHORT[ctx.wizard.state.selection.startDay]} — ${DAY_SHORT[endDay]}\nВыберите начальное время:`,
        timeKeyboard('starttime', slots)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const startTime = ctx.callbackQuery.data.replace('starttime:', '')
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.startTime = startTime
      const slots = ctx.wizard.state.index.timeSlots
      const startIdx = slots.indexOf(startTime)
      const allowedSlots = slots.slice(startIdx)
      await ctx.editMessageText(
        `Начало времени: ${startTime}\nВыберите конечное время:`,
        timeKeyboard('endtime', allowedSlots)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const endTime = ctx.callbackQuery.data.replace('endtime:', '')
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.endTime = endTime
      await ctx.editMessageText(
        `Время: ${ctx.wizard.state.selection.startTime} — ${endTime}\nВыберите вид работы:`,
        workTypeKeyboard()
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const workTypeId = ctx.callbackQuery.data.replace('work:', '')
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.workTypeId = workTypeId
      const preview = buildPreview(ctx.wizard.state.selection)
      await ctx.editMessageText(preview, confirmKeyboard())
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const action = ctx.callbackQuery.data.replace('confirm:', '')
      await ctx.answerCbQuery()

      if (action === 'cancel') {
        await ctx.editMessageText('Заполнение отменено.')
        return leaveToMenu(ctx)
      }

      const selection = ctx.wizard.state.selection
      const config = ctx.wizard.state.config

      try {
        const profile = await resolveEmployeeProfile(
          getProfileForEmployee,
          getRateForEmployee,
          selection.employee
        )
        const entries = ctx.wizard.state.freeformEntries || [
          {
            day: selection.startDay,
            startTime: selection.startTime,
            endTime: selection.endTime
          }
        ]
        // For step mode single range covering startDay-endDay:
        if (!ctx.wizard.state.freeformEntries) {
          const result = await applyScheduleRange(
            config.excelPath,
            selection.sheetName,
            selection
          )
          const lines = [
            'Расписание сохранено',
            `Обновлено ячеек: ${result.cellsUpdated}`,
            `Резервная копия: ${result.backupPath}`,
            result.driveSyncHint ||
              'Синхронизация Google Drive: 5–30 сек. Откройте .xlsx по ссылке (не Google Таблицы).'
          ]
          try {
            const yearHint = extractYearFromSheetName(selection.sheetName)
            const summary = await formatNormSummary(
              config.excelPath,
              selection.sheetName,
              selection.weekId,
              selection.employee,
              yearHint,
              profile.rate,
              profile.lunchMinutes
            )
            lines.push('', summary)
          } catch (summaryError) {
            lines.push('', 'Не удалось пересчитать часы: ' + summaryError.message)
          }
          await ctx.editMessageText(lines.join('\n'))
        } else {
          const text = await applyEntriesAndSummary(
            config,
            selection,
            entries,
            profile
          )
          await ctx.editMessageText(text)
        }
      } catch (error) {
        await ctx.editMessageText(`Ошибка сохранения: ${error.message}`)
      }

      return leaveToMenu(ctx)
    },
    // step 12: freeform text
    async (ctx) => {
      if (!ctx.message || !ctx.message.text) {
        await ctx.reply(
          'Напишите расписание текстом.\nПример: Пн 9:00-18:00, Вт 10:00-19:00'
        )
        return
      }
      const slots = (ctx.wizard.state.index && ctx.wizard.state.index.timeSlots) || []
      const parsed = parseFreeformSchedule(ctx.message.text, slots)
      if (!parsed.ok) {
        await ctx.reply(parsed.error)
        return
      }
      ctx.wizard.state.freeformEntries = parsed.entries
      await ctx.reply(
        'Разобрано:\n' +
          formatFreeformPreview(parsed.entries) +
          '\n\nВыберите вид работы:',
        workTypeKeyboard()
      )
      return ctx.wizard.next()
    },
    // step 13: freeform work type
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const workTypeId = ctx.callbackQuery.data.replace('work:', '')
      await ctx.answerCbQuery()
      ctx.wizard.state.selection.workTypeId = workTypeId
      const preview = buildFreeformPreview(
        ctx.wizard.state.selection,
        ctx.wizard.state.freeformEntries
      )
      await ctx.editMessageText(preview, confirmKeyboard())
      return ctx.wizard.next()
    },
    // step 14: freeform confirm
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const action = ctx.callbackQuery.data.replace('confirm:', '')
      await ctx.answerCbQuery()
      if (action === 'cancel') {
        await ctx.editMessageText('Заполнение отменено.')
        return leaveToMenu(ctx)
      }
      const selection = ctx.wizard.state.selection
      const config = ctx.wizard.state.config
      try {
        const profile = await resolveEmployeeProfile(
          getProfileForEmployee,
          getRateForEmployee,
          selection.employee
        )
        const text = await applyEntriesAndSummary(
          config,
          selection,
          ctx.wizard.state.freeformEntries,
          profile
        )
        await ctx.editMessageText(text)
      } catch (error) {
        await ctx.editMessageText(`Ошибка сохранения: ${error.message}`)
      }
      return leaveToMenu(ctx)
    }
  )

  wizard.command('cancel', async (ctx) => {
    await ctx.reply('Заполнение отменено.')
    return leaveToMenu(ctx)
  })

  return wizard
}

function createProfileWizard(getConfig, getUserProfile, saveUserProfile) {
  const wizard = new Scenes.WizardScene(
    'profile-wizard',
    async (ctx) => {
      const config = await getConfig()
      const sheets = await listSheets(config.excelPath)
      const defaultSheet = sheets[sheets.length - 1]
      const index = await getScheduleIndex(config.excelPath, defaultSheet)
      ctx.wizard.state.config = config
      ctx.wizard.state.index = index
      ctx.wizard.state.defaultSheet = defaultSheet
      await ctx.reply(
        'Выберите отдел для привязки профиля:',
        departmentKeyboard(index.departments)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const deptIndex = Number(ctx.callbackQuery.data.replace('dept:', ''))
      const department = ctx.wizard.state.index.departments[deptIndex]
      await ctx.answerCbQuery()
      ctx.wizard.state.department = department
      await ctx.editMessageText(
        `Отдел: ${department.name}\nВыберите себя в списке:`,
        employeeKeyboard(department.employees)
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const empIndex = Number(ctx.callbackQuery.data.replace('emp:', ''))
      const employee = ctx.wizard.state.department.employees[empIndex]
      await ctx.answerCbQuery()
      ctx.wizard.state.employee = employee
      await ctx.editMessageText(
        `Сотрудник: ${employee}\nВыберите ставку:`,
        rateKeyboard()
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const rateRaw = ctx.callbackQuery.data.replace('rate:', '')
      const rate = Number(rateRaw) === 0.5 ? 0.5 : 1
      await ctx.answerCbQuery()
      ctx.wizard.state.rate = rate
      await ctx.editMessageText(
        `${formatRateLine(rate)}\nВыберите обед (вычитается из часов дня):`,
        lunchKeyboard()
      )
      return ctx.wizard.next()
    },
    async (ctx) => {
      if (!ctx.callbackQuery) return
      const lunchRaw = ctx.callbackQuery.data.replace('lunch:', '')
      const lunchMinutes = normalizeLunchMinutes(Number(lunchRaw))
      await ctx.answerCbQuery()
      await saveUserProfile(ctx.from.id, {
        department: ctx.wizard.state.department.name,
        employee: ctx.wizard.state.employee,
        sheetName: ctx.wizard.state.defaultSheet,
        rate: ctx.wizard.state.rate,
        lunchMinutes: lunchMinutes
      })
      await ctx.editMessageText(
        [
          'Профиль привязан:',
          ctx.wizard.state.employee,
          ctx.wizard.state.department.name,
          formatRateLine(ctx.wizard.state.rate),
          formatLunchLine(lunchMinutes)
        ].join('\n')
      )
      return leaveToMenu(ctx)
    }
  )

  return wizard
}

function registerBot(bot, deps) {
  const scheduleWizard = createScheduleWizard(
    deps.getConfig,
    deps.getUserProfile,
    deps.saveUserProfile,
    deps.getProfileForEmployee,
    deps.getRateForEmployee
  )
  const profileWizard = createProfileWizard(
    deps.getConfig,
    deps.getUserProfile,
    deps.saveUserProfile
  )
  const viewWizard = createViewWizard(
    deps.getConfig,
    deps.getProfileForEmployee,
    deps.getRateForEmployee
  )

  const stage = new Scenes.Stage([scheduleWizard, profileWizard, viewWizard])
  bot.use(session())
  bot.use(stage.middleware())

  bot.start(async (ctx) => {
    await ctx.reply(
      'Бот расписания РиМ.\nВыберите действие:',
      mainMenuKeyboard()
    )
  })

  bot.command('schedule', async (ctx) => ctx.scene.enter('schedule-wizard'))
  bot.command('my', async (ctx) => ctx.scene.enter('profile-wizard'))
  bot.command('show', async (ctx) => ctx.scene.enter('view-wizard'))

  bot.command('myschedule', async (ctx) => {
    const config = await deps.getConfig()
    const profile = await deps.getUserProfile(ctx.from.id)
    if (!profile) {
      await ctx.reply('Сначала привяжите профиль: /my')
      return
    }
    try {
      const sheets = await listSheets(config.excelPath)
      const today = new Date()
      const sheet = findSheetForDate(sheets, today) || profile.sheetName
      const index = await getScheduleIndex(config.excelPath, sheet)
      const yearHint = extractYearFromSheetName(sheet)
      const week = findCurrentWeek(index.weeks, today, yearHint)
      if (!week) {
        await ctx.reply('Текущая неделя не найдена на листе. Проверьте Excel.')
        return
      }
      await replyEmployeeSchedule(
        ctx,
        config,
        sheet,
        week.id,
        profile.employee,
        profile.rate,
        profile.lunchMinutes
      )
      await ctx.reply('Выберите действие:', mainMenuKeyboard())
    } catch (error) {
      await ctx.reply(`Ошибка: ${error.message}`)
    }
  })

  bot.command('remind', async (ctx) => {
    const profile = await deps.getUserProfile(ctx.from.id)
    if (!profile) {
      await ctx.reply('Сначала привяжите профиль: /my')
      return
    }
    const args = (ctx.message.text || '').trim().split(/\s+/).slice(1)
    const cmd = (args[0] || '').toLowerCase()
    if (!cmd || cmd === 'status') {
      await ctx.reply(
        [
          profile.remindEnabled ? 'Напоминания: вкл' : 'Напоминания: выкл',
          'День: ' + profile.remindWeekday + ' (1=пн … 7=вс)',
          'Час: ' + profile.remindHour + ' (Europe/Moscow)',
          'Команды: /remind on|off, /remind hour 9, /remind day 1'
        ].join('\n')
      )
      return
    }
    if (cmd === 'on' || cmd === 'off') {
      await deps.saveUserProfile(
        ctx.from.id,
        Object.assign({}, profile, { remindEnabled: cmd === 'on' })
      )
      await ctx.reply(
        cmd === 'on' ? 'Напоминания включены' : 'Напоминания выключены'
      )
      return
    }
    if (cmd === 'hour') {
      const hour = Number(args[1])
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        await ctx.reply('Укажите час 0–23. Пример: /remind hour 9')
        return
      }
      await deps.saveUserProfile(
        ctx.from.id,
        Object.assign({}, profile, { remindHour: hour })
      )
      await ctx.reply('Час напоминания: ' + hour + ':00 (МСК)')
      return
    }
    if (cmd === 'day') {
      const day = Number(args[1])
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        await ctx.reply('Укажите день 1–7 (1=пн). Пример: /remind day 1')
        return
      }
      await deps.saveUserProfile(
        ctx.from.id,
        Object.assign({}, profile, { remindWeekday: day })
      )
      await ctx.reply('День напоминания: ' + day)
      return
    }
    await ctx.reply(
      'Команды: /remind on|off|status, /remind hour 9, /remind day 1'
    )
  })

  bot.action('menu:schedule', async (ctx) => {
    await ctx.answerCbQuery()
    return ctx.scene.enter('schedule-wizard')
  })

  bot.action('menu:myschedule', async (ctx) => {
    await ctx.answerCbQuery()
    const config = await deps.getConfig()
    const profile = await deps.getUserProfile(ctx.from.id)
    if (!profile) {
      await ctx.reply('Сначала привяжите профиль: /my')
      return
    }
    try {
      const sheets = await listSheets(config.excelPath)
      const today = new Date()
      const sheet = findSheetForDate(sheets, today) || profile.sheetName
      const index = await getScheduleIndex(config.excelPath, sheet)
      const yearHint = extractYearFromSheetName(sheet)
      const week = findCurrentWeek(index.weeks, today, yearHint)
      if (!week) {
        await ctx.reply('Текущая неделя не найдена на листе. Проверьте Excel.')
        return
      }
      await replyEmployeeSchedule(
        ctx,
        config,
        sheet,
        week.id,
        profile.employee,
        profile.rate,
        profile.lunchMinutes
      )
      await ctx.reply('Выберите действие:', mainMenuKeyboard())
    } catch (error) {
      await ctx.reply(`Ошибка: ${error.message}`)
    }
  })

  bot.action('menu:profile', async (ctx) => {
    await ctx.answerCbQuery()
    return ctx.scene.enter('profile-wizard')
  })

  bot.command('status', async (ctx) => {
    const config = await deps.getConfig()
    const profile = await deps.getUserProfile(ctx.from.id)
    const access =
      typeof deps.assertExcelAccessible === 'function'
        ? deps.assertExcelAccessible(config.excelPath)
        : {
            ok: deps.fileExists(config.excelPath),
            error: 'Файл не найден'
          }
    const lines = [
      `Excel: ${config.excelPath || 'не задан'}`,
      `Доступ: ${access.ok ? 'да (чтение/запись)' : 'нет — ' + access.error}`
    ]
    if (profile) {
      lines.push(`Профиль: ${profile.employee} (${profile.department})`)
      lines.push(formatRateLine(profile.rate))
      lines.push(formatLunchLine(profile.lunchMinutes))
      lines.push(
        profile.remindEnabled
          ? `Напоминания: день ${profile.remindWeekday} в ${profile.remindHour}:00 МСК`
          : 'Напоминания: выкл'
      )
    }
    if (config.excelPath && deps.fileExists(config.excelPath)) {
      try {
        const sheets = await listSheets(config.excelPath)
        const today = new Date()
        const sheet = findSheetForDate(sheets, today)
        if (sheet) {
          const index = await getScheduleIndex(config.excelPath, sheet)
          const yearHint = extractYearFromSheetName(sheet)
          const week = findCurrentWeek(index.weeks, today, yearHint)
          lines.push(`Лист сегодня: ${sheet}`)
          lines.push(week ? `Текущая неделя: ${week.label}` : 'Текущая неделя: не найдена')
        }
      } catch {
        // ignore index errors in status
      }
    }
    await ctx.reply(lines.join('\n'))
    await ctx.reply('Выберите действие:', mainMenuKeyboard())
  })
}

module.exports = {
  registerBot,
  createScheduleWizard,
  createProfileWizard,
  createViewWizard,
  replyEmployeeSchedule
}
