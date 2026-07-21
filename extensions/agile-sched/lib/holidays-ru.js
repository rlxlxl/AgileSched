/** Russian public holidays (static list for reminder skip). */
const HOLIDAYS = {
  2025: [
    '2025-01-01',
    '2025-01-02',
    '2025-01-03',
    '2025-01-06',
    '2025-01-07',
    '2025-01-08',
    '2025-02-23',
    '2025-02-24',
    '2025-03-08',
    '2025-05-01',
    '2025-05-02',
    '2025-05-09',
    '2025-06-12',
    '2025-06-13',
    '2025-11-03',
    '2025-11-04'
  ],
  2026: [
    '2026-01-01',
    '2026-01-02',
    '2026-01-05',
    '2026-01-06',
    '2026-01-07',
    '2026-01-08',
    '2026-01-09',
    '2026-02-23',
    '2026-03-09',
    '2026-05-01',
    '2026-05-11',
    '2026-06-12',
    '2026-11-04'
  ],
  2027: [
    '2027-01-01',
    '2027-01-04',
    '2027-01-05',
    '2027-01-06',
    '2027-01-07',
    '2027-01-08',
    '2027-02-23',
    '2027-03-08',
    '2027-05-03',
    '2027-05-10',
    '2027-06-14',
    '2027-11-04'
  ]
}

function formatDateYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

function isRussianHoliday(date) {
  const ymd = formatDateYmd(date)
  const year = String(date.getFullYear())
  const list = HOLIDAYS[year] || []
  return list.indexOf(ymd) !== -1
}

module.exports = {
  HOLIDAYS,
  formatDateYmd,
  isRussianHoliday
}
