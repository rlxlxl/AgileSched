const fs = require('fs')
const path = require('path')
const { Telegraf } = require('telegraf')
const { registerBot } = require('./lib/bot/scenes')

let yougile = null
let bot = null
let botStatus = {
  running: false,
  error: null,
  startedAt: null
}

const DEFAULT_PUBLIC_DATA = {
  userProfiles: {}
}

const DEFAULT_PRIVATE_DATA = {
  telegramToken: '',
  excelPath: ''
}

function getYougile() {
  if (!yougile) {
    yougile = require('yougile')
  }
  return yougile
}

async function getPrivateData() {
  const yg = getYougile()
  const data = await yg.Service.getPrivateData()
  return { ...DEFAULT_PRIVATE_DATA, ...data }
}

async function getPublicData() {
  const yg = getYougile()
  const data = await yg.Service.getData()
  return { ...DEFAULT_PUBLIC_DATA, ...data }
}

async function savePrivateData(patch) {
  const yg = getYougile()
  const current = await getPrivateData()
  await yg.Service.setPrivateData({ ...current, ...patch })
}

async function savePublicData(patch) {
  const yg = getYougile()
  const current = await getPublicData()
  await yg.Service.setData({ ...current, ...patch })
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
  if (!config.telegramToken) {
    botStatus = {
      running: false,
      error: 'Токен Telegram-бота не задан',
      startedAt: null
    }
    return botStatus
  }

  if (!fileExists(config.excelPath)) {
    botStatus = {
      running: false,
      error: `Файл Excel не найден: ${config.excelPath}`,
      startedAt: null
    }
    return botStatus
  }

  try {
    bot = new Telegraf(config.telegramToken)
    registerBot(bot, {
      getConfig,
      getUserProfile,
      saveUserProfile,
      fileExists
    })

    bot.catch((error, ctx) => {
      console.error('[agile-sched] bot error:', error)
      if (ctx) {
        ctx.reply('Произошла ошибка. Попробуйте снова или /cancel.').catch(() => {})
      }
    })

    bot.launch().then(() => {
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

const yg = getYougile()
const Service = yg.Service

Service.getSettings = async () => {
  const privateData = await getPrivateData()
  return {
    telegramToken: privateData.telegramToken ? '***' : '',
    excelPath: privateData.excelPath,
    botStatus
  }
}

Service.saveSettings = async ({ userId, args }) => {
  const [settings] = args
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

Service.getBotStatus = async () => botStatus

Service.restartBot = async () => startBot()

process.once('SIGINT', () => stopBot())
process.once('SIGTERM', () => stopBot())

startBot().catch((error) => {
  console.error('[agile-sched] initial start failed:', error)
})

module.exports = {}
