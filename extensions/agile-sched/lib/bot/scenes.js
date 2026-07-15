const { Scenes, session, Markup } = require('telegraf')
const { DAYS, DAY_SHORT, WORK_TYPES } = require('../constants')
const { listSheets, getScheduleIndex } = require('../schedule-index')
const { applyScheduleRange } = require('../excel-writer')
const { getEmployeeWeekSchedule } = require('../schedule-reader')
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
  mainMenuKeyboard
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

async function replyEmployeeSchedule(ctx, config, sheetName, weekId, employeeName) {
  const yearHint = extractYearFromSheetName(sheetName)
  const result = await getEmployeeWeekSchedule(
    config.excelPath,
    sheetName,
    weekId,
    employeeName,
    yearHint
  )
  await ctx.reply(`${employeeName}\n${result.text}`)
}

function createViewWizard(getConfig) {
  const wizard = new Scenes.WizardScene(
    'view-wizard',
    async (ctx) => {
      const config = await getConfig()
      const sheets = await listSheets(config.excelPath)
      if (!sheets.length) {
        await ctx.reply('В файле Excel не найдены листы расписания.')
        return ctx.scene.leave()
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
        await replyEmployeeSchedule(
          ctx,
          config,
          selection.sheetName,
          selection.weekId,
          employee
        )
      } catch (error) {
        await ctx.reply(`Ошибка: ${error.message}`)
      }
      return ctx.scene.leave()
    }
  )

  wizard.command('cancel', async (ctx) => {
    await ctx.reply('Отменено.')
    return ctx.scene.leave()
  })

  return wizard
}

function createScheduleWizard(getConfig, getUserProfile, saveUserProfile) {
  const wizard = new Scenes.WizardScene(
    'schedule-wizard',
    async (ctx) => {
      const config = await getConfig()
      const sheets = await listSheets(config.excelPath)
      if (!sheets.length) {
        await ctx.reply('В файле Excel не найдены листы расписания.')
        return ctx.scene.leave()
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
        `Сотрудник: ${employee}\nВыберите начало недели:`,
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
        return ctx.scene.leave()
      }

      const selection = ctx.wizard.state.selection
      const config = ctx.wizard.state.config

      try {
        const result = await applyScheduleRange(
          config.excelPath,
          selection.sheetName,
          selection
        )
        await ctx.editMessageText(
          [
            'Расписание сохранено',
            `Обновлено ячеек: ${result.cellsUpdated}`,
            `Резервная копия: ${result.backupPath}`,
            result.driveSyncHint ||
              'Синхронизация Google Drive: 5–30 сек. Откройте .xlsx по ссылке (не Google Таблицы).'
          ].join('\n')
        )
      } catch (error) {
        await ctx.editMessageText(`Ошибка сохранения: ${error.message}`)
      }

      return ctx.scene.leave()
    }
  )

  wizard.command('cancel', async (ctx) => {
    await ctx.reply('Заполнение отменено.')
    return ctx.scene.leave()
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
      await saveUserProfile(ctx.from.id, {
        department: ctx.wizard.state.department.name,
        employee,
        sheetName: ctx.wizard.state.defaultSheet
      })
      await ctx.editMessageText(
        `Профиль привязан:\n${employee}\n${ctx.wizard.state.department.name}`
      )
      return ctx.scene.leave()
    }
  )

  return wizard
}

function registerBot(bot, deps) {
  const scheduleWizard = createScheduleWizard(
    deps.getConfig,
    deps.getUserProfile,
    deps.saveUserProfile
  )
  const profileWizard = createProfileWizard(
    deps.getConfig,
    deps.getUserProfile,
    deps.saveUserProfile
  )
  const viewWizard = createViewWizard(deps.getConfig)

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
        await ctx.reply('Текущая неделя не найдена. Используйте /show')
        return
      }
      await replyEmployeeSchedule(
        ctx,
        config,
        sheet,
        week.id,
        profile.employee
      )
    } catch (error) {
      await ctx.reply(`Ошибка: ${error.message}`)
    }
  })

  bot.action('menu:schedule', async (ctx) => {
    await ctx.answerCbQuery()
    return ctx.scene.enter('schedule-wizard')
  })

  bot.action('menu:view', async (ctx) => {
    await ctx.answerCbQuery()
    return ctx.scene.enter('view-wizard')
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
  })
}

module.exports = {
  registerBot,
  createScheduleWizard,
  createProfileWizard,
  createViewWizard,
  replyEmployeeSchedule
}
