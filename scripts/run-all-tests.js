#!/usr/bin/env node
const { spawnSync } = require('child_process')
const path = require('path')

const scripts = [
  'test-hours-calculator.js',
  'test-freeform-schedule.js',
  'test-reminders.js',
  'test-week-dates.js'
]

let failed = 0
for (const name of scripts) {
  const file = path.join(__dirname, name)
  console.log('→', name)
  const result = spawnSync(process.execPath, [file], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  })
  if (result.status !== 0) {
    failed += 1
    console.error('FAIL', name)
  }
}

if (failed) {
  console.error('Failed:', failed)
  process.exit(1)
}
console.log('All tests passed.')
