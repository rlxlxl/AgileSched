const fs = require('fs')
const path = require('path')
const { Telegraf } = require('telegraf')
const {
  Service,
  Api,
  workerInited,
  logger
} = require('yougile-platform-sdk')
const { registerBot } = require('./lib/bot/scenes')
const { createYougileChatBot } = require('./lib/bot/yougile-chat')
const { createUiSession } = require('./lib/bot/yougile-ui-session')
const { assertExcelAccessible } = require('./lib/excel-writer')

let bot = null
let botStatus = {
  running: false,
  error: null,
  startedAt: null
}

const CONFIG_PATH = path.join(__dirname, 'config.json')
const DEFAULT_EXCEL_PATH =
  '/opt/yougile/user-data/drive/Расписашка РиМ.xlsx'

const DEFAULT_PUBLIC_DATA = {
  userProfiles: {}
}

const DEFAULT_PRIVATE_DATA = {
  telegramToken: '',
  excelPath: DEFAULT_EXCEL_PATH
}

function readFileConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {}
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    console.error('[agile-sched] config.json read error:', error.message)
    return {}
  }
}

async function getPrivateData() {
  const data = await Service.getPrivateData()
  const fileConfig = readFileConfig()
  // config.json wins over stale private data (Drive path / token)
  return Object.assign({}, DEFAULT_PRIVATE_DATA, data || {}, {
    telegramToken:
      fileConfig.telegramToken ||
      (data && data.telegramToken) ||
      '',
    excelPath:
      fileConfig.excelPath ||
      (data && data.excelPath) ||
      DEFAULT_EXCEL_PATH
  })
}

async function getPublicData() {
  const data = await Service.getData()
  return Object.assign({}, DEFAULT_PUBLIC_DATA, data || {})
}

async function savePrivateData(patch) {
  const current = await getPrivateData()
  await Service.setPrivateData(Object.assign({}, current, patch))
}

async function savePublicData(patch) {
  const current = await getPublicData()
  await Service.setData(Object.assign({}, current, patch))
}

async function getConfig() {
  const privateData = await getPrivateData()
  return {
    telegramToken: privateData.telegramToken,
    excelPath: privateData.excelPath
  }
}

async function getUserProfile(userId) {
  const publicData = await getPublicData()
  return publicData.userProfiles[String(userId)] || null
}

async function saveUserProfile(userId, profile) {
  const publicData = await getPublicData()
  publicData.userProfiles[String(userId)] = profile
  await savePublicData(publicData)
}

function fileExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath))
}

function describeExcelAccess(excelPath) {
  const access = assertExcelAccessible(excelPath)
  if (access.ok) {
    return { ok: true, message: 'Excel доступен: ' + excelPath }
  }
  return { ok: false, message: access.error }
}

async function stopBot() {
  if (bot) {
    try {
      bot.stop('restart')
    } catch (error) {
      console.log('[agile-sched] stop bot:', error.message)
    }
    bot = null
  }
  botStatus.running = false
}

async function startBot() {
  await stopBot()

  const config = await getConfig()
  if (!config.telegramToken || config.telegramToken === 'ТОКЕН_ОТ_BotFather') {
    botStatus = {
      running: false,
      error: 'Токен Telegram не задан (config.json)',
      startedAt: null
    }
    console.log('[agile-sched] Telegram bot skipped: no token')
    return botStatus
  }

  const excelAccess = describeExcelAccess(config.excelPath)
  if (!excelAccess.ok) {
    botStatus = {
      running: false,
      error: excelAccess.message,
      startedAt: null
    }
    console.log('[agile-sched]', botStatus.error)
    return botStatus
  }

  try {
    bot = new Telegraf(config.telegramToken)
    registerBot(bot, {
      getConfig: getConfig,
      getUserProfile: getUserProfile,
      saveUserProfile: saveUserProfile,
      fileExists: fileExists,
      assertExcelAccessible: assertExcelAccessible
    })

    bot.catch(function (error, ctx) {
      console.error('[agile-sched] bot error:', error)
      if (ctx) {
        ctx.reply('Произошла ошибка. Попробуйте снова или /cancel.').catch(
          function () {}
        )
      }
    })

    bot.launch().then(function () {
      console.log('[agile-sched] Telegram bot started')
    })

    botStatus = {
      running: true,
      error: null,
      startedAt: new Date().toISOString()
    }
  } catch (error) {
    botStatus = {
      running: false,
      error: error.message,
      startedAt: null
    }
    console.error('[agile-sched] failed to start bot:', error)
  }

  return botStatus
}

async function main() {
  // YouGile chat — вспомогательный канал; основной UI — Telegram
  const yougileChat = await createYougileChatBot({
    Api: Api,
    getConfig: getConfig,
    getUserProfile: getUserProfile,
    saveUserProfile: saveUserProfile,
    assertExcelAccessible: assertExcelAccessible,
    logger: logger
  })

  await Api.setupEventCallback({
    event: 'chat_message',
    handler: function (payload, prevData, fromUserId) {
      yougileChat.handleMessage(payload, prevData, fromUserId).catch(function (
        error
      ) {
        console.error('[agile-sched] chat handler failed:', error)
      })
    }
  })

  const taskHandler = function (task, prevTaskData) {
    yougileChat.onTaskChanged(task, prevTaskData).catch(function (error) {
      console.error('[agile-sched] task handler failed:', error)
    })
  }

  await Api.setupEventCallback({
    event: 'task-created',
    handler: taskHandler
  })

  await Api.setupEventCallback({
    event: 'task-updated',
    handler: taskHandler
  })

  Service.getSettings = async function () {
    const privateData = await getPrivateData()
    const excelAccess = describeExcelAccess(privateData.excelPath)
    return {
      telegramToken: privateData.telegramToken ? '***' : '',
      excelPath: privateData.excelPath,
      excelOk: excelAccess.ok,
      excelMessage: excelAccess.message,
      botStatus: botStatus
    }
  }

  Service.saveSettings = async function (payload) {
    const args = payload.args || []
    const settings = args[0] || {}
    const patch = {}
    if (settings.telegramToken && settings.telegramToken !== '***') {
      patch.telegramToken = settings.telegramToken
    }
    if (settings.excelPath) {
      patch.excelPath = settings.excelPath
    }
    await savePrivateData(patch)
    const status = await startBot()
    return { ok: true, botStatus: status }
  }

  Service.getBotStatus = async function () {
    const config = await getConfig()
    const excelAccess = describeExcelAccess(config.excelPath)
    return Object.assign({}, botStatus, {
      excelPath: config.excelPath,
      excelOk: excelAccess.ok,
      excelMessage: excelAccess.message
    })
  }

  Service.restartBot = async function () {
    return startBot()
  }

  function payloadArg(payload, index) {
    if (!payload) return undefined
    if (payload.args && payload.args.length) {
      return payload.args[index || 0]
    }
    return index ? undefined : payload
  }

  function payloadUserId(payload) {
    return (
      (payload && payload.userId) ||
      (payload && payload.fromUserId) ||
      'ui'
    )
  }

  const uiSession = createUiSession({
    getConfig: getConfig,
    getUserProfile: getUserProfile,
    saveUserProfile: saveUserProfile,
    getBotStatus: async function () {
      return Service.getBotStatus({})
    },
    restartBot: startBot,
    getSettingsSnapshot: async function () {
      return Service.getSettings({})
    },
    saveSettingsValues: async function (settings) {
      await Service.saveSettings({ args: [settings] })
    }
  })

  Service.getPanelState = async function (payload) {
    return uiSession.getPanelState(payloadUserId(payload))
  }

  Service.scheduleStart = async function (payload) {
    const mode = payloadArg(payload, 0)
    const modeStr =
      typeof mode === 'string' ? mode : (mode && mode.mode) || 'idle'
    return uiSession.scheduleStart(payloadUserId(payload), modeStr)
  }

  Service.schedulePick = async function (payload) {
    const raw = payloadArg(payload, 0)
    const choiceId =
      typeof raw === 'string' ? raw : (raw && raw.choiceId) || ''
    console.log('[agile-sched] schedulePick', choiceId)
    try {
      const result = await uiSession.schedulePick(
        payloadUserId(payload),
        choiceId
      )
      console.log(
        '[agile-sched] schedulePick done',
        result && result.mode,
        result && result.choices && result.choices.length
      )
      return result
    } catch (error) {
      console.error('[agile-sched] schedulePick error', error)
      throw error
    }
  }

  Service.scheduleCancel = async function (payload) {
    return uiSession.scheduleCancel(payloadUserId(payload))
  }

  Service.applyUiSettings = async function (payload) {
    const values = payloadArg(payload, 0) || {}
    return uiSession.applySettingsFromUi(payloadUserId(payload), values)
  }

  workerInited()

  const fileConfig = readFileConfig()
  console.log(
    '[agile-sched] ready. Чат задачи (как Telegram): /start. Excel:',
    fileConfig.excelPath || DEFAULT_EXCEL_PATH
  )

  startBot().catch(function (error) {
    console.error('[agile-sched] initial start failed:', error)
  })
}

process.once('SIGINT', function () {
  stopBot()
})
process.once('SIGTERM', function () {
  stopBot()
})

main().catch(function (error) {
  console.error('[agile-sched] main failed:', error)
})

module.exports = {}
