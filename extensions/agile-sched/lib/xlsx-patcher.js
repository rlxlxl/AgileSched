const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
const { WORK_TYPES } = require('./constants')

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFF_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function colToNumber(col) {
  let n = 0
  for (const ch of col) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n
}

function numberToCol(num) {
  let n = num
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function cellRef(row, col) {
  return `${numberToCol(col)}${row}`
}

function parseXml(xml) {
  // Lightweight attribute/tag helpers without full DOM dependency
  return xml
}

function findStyleIdsByColor(stylesXml) {
  const fills = parseFills(stylesXml)
  const xfs = parseCellXfs(stylesXml)

  const byColor = {}
  for (let styleId = 0; styleId < xfs.length; styleId++) {
    const fillId = xfs[styleId].fillId
    const rgb = fills[fillId]?.rgb
    if (!rgb) continue
    if (!byColor[rgb]) byColor[rgb] = []
    byColor[rgb].push(styleId)
  }
  return byColor
}

function findStylesWithThemeFill(stylesXml, themeIndex) {
  const fills = parseFills(stylesXml)
  const xfs = parseCellXfs(stylesXml)
  const matchingFillIds = new Set()

  fills.forEach((meta, fillId) => {
    if (meta.theme === themeIndex) matchingFillIds.add(fillId)
  })

  const styleIds = []
  for (let styleId = 0; styleId < xfs.length; styleId++) {
    if (matchingFillIds.has(xfs[styleId].fillId)) {
      styleIds.push(styleId)
    }
  }
  return styleIds
}

function parseFills(stylesXml) {
  const fills = []
  const fillRegex = /<fill\b[^>]*>([\s\S]*?)<\/fill>|<fill\b[^>]*\/>/g
  let match
  while ((match = fillRegex.exec(stylesXml))) {
    const block = match[0]
    const rgb = (block.match(/fgColor[^>]*rgb="([^"]+)"/) || [])[1] || null
    const themeMatch = block.match(/fgColor[^>]*theme="(\d+)"/)
    fills.push({
      rgb: rgb ? rgb.toUpperCase() : null,
      theme: themeMatch ? Number(themeMatch[1]) : null
    })
  }
  return fills
}

function parseCellXfs(stylesXml) {
  const xfs = []
  const xfBlock = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (!xfBlock) return xfs

  const xfRegex = /<xf\b[^>]*\/?>/g
  let xfMatch
  while ((xfMatch = xfRegex.exec(xfBlock[1]))) {
    const tag = xfMatch[0]
    xfs.push({
      fillId: Number((tag.match(/fillId="(\d+)"/) || [])[1] || 0)
    })
  }
  return xfs
}

// Styles used in the template for data cells (legend row 9 + typical data rows)
const PREFERRED_STYLE_IDS = {
  semi: [132, 42, 44, 58, 143],
  office: [43, 16, 102, 51],
  remote: [133, 60, 49, 110]
}

const REMOTE_THEME_INDEX = 8

function pickStyleId(byColor, color, preferredIds, themeStyleIds = []) {
  const idsForColor = byColor[color] || []
  for (const id of preferredIds) {
    if (idsForColor.includes(id)) return id
  }
  if (idsForColor.length) return idsForColor[0]
  for (const id of themeStyleIds) {
    if (preferredIds.includes(id)) return id
  }
  if (themeStyleIds.length) return themeStyleIds[0]
  return null
}

function resolveWorkTypeStyle(stylesXml, workTypeId) {
  const workType = WORK_TYPES[workTypeId]
  if (!workType) throw new Error(`Неизвестный тип работы: ${workTypeId}`)

  const byColor = findStyleIdsByColor(stylesXml)
  const color = workType.color.toUpperCase()
  const preferred = PREFERRED_STYLE_IDS[workTypeId] || []
  const themeStyles =
    workTypeId === 'remote' ? findStylesWithThemeFill(stylesXml, REMOTE_THEME_INDEX) : []

  const styleId = pickStyleId(byColor, color, preferred, themeStyles)
  if (styleId == null) {
    throw new Error(
      `В Excel не найден стиль с цветом ${color} для «${workType.label}». ` +
        'Добавьте легенду Очно/Дистанц/Очно (0,5ч) на лист.'
    )
  }
  return { styleId, value: workType.value, color }
}

async function resolveSheetPath(zip, sheetName) {
  const workbookXml = await zip.file('xl/workbook.xml').async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string')

  const sheetRegex = /<sheet\b[^>]*>/g
  let sheetMatch
  let rId = null
  while ((sheetMatch = sheetRegex.exec(workbookXml))) {
    const tag = sheetMatch[0]
    const name = (tag.match(/name="([^"]+)"/) || [])[1]
    if (name === sheetName) {
      rId = (tag.match(/r:id="([^"]+)"/) || [])[1]
      break
    }
  }
  if (!rId) {
    throw new Error(`Лист «${sheetName}» не найден в workbook.xml`)
  }

  const relRegex = /<Relationship\b[^>]*>/g
  let relMatch
  while ((relMatch = relRegex.exec(relsXml))) {
    const tag = relMatch[0]
    const id = (tag.match(/\bId="([^"]+)"/) || [])[1]
    if (id === rId) {
      let target = (tag.match(/\bTarget="([^"]+)"/) || [])[1]
      if (!target) break
      if (target.startsWith('/')) target = target.slice(1)
      if (!target.startsWith('xl/')) target = path.posix.join('xl', target)
      return target.replace(/\\/g, '/')
    }
  }

  throw new Error(`Не найден путь листа для rId=${rId}`)
}

function buildCellXml(ref, styleId, value) {
  const num = Number(value)
  return `<c r="${ref}" s="${styleId}"><v>${num}</v></c>`
}

function upsertCellInRow(rowXml, ref, cellXml) {
  const col = colToNumber(ref.replace(/\d+/g, ''))
  const cellRegex = /<c\b[^>]*\br="([A-Z]+)\d+"[^>]*\/>|<c\b[^>]*\br="([A-Z]+)\d+"[^>]*>[\s\S]*?<\/c>/g
  const cells = []
  let match
  while ((match = cellRegex.exec(rowXml))) {
    const full = match[0]
    const cellRefAttr = (full.match(/\br="([A-Z]+\d+)"/) || [])[1]
    const cellCol = colToNumber(cellRefAttr.replace(/\d+/g, ''))
    cells.push({ full, col: cellCol, ref: cellRefAttr, index: match.index, length: full.length })
  }

  const existing = cells.find((c) => c.ref === ref)
  if (existing) {
    return (
      rowXml.slice(0, existing.index) +
      cellXml +
      rowXml.slice(existing.index + existing.length)
    )
  }

  const insertBefore = cells.find((c) => c.col > col)
  const openEnd = rowXml.indexOf('>') + 1
  // self-closing row unlikely; find content start after opening tag
  const openMatch = rowXml.match(/^<row\b[^>]*\/?>/)
  if (openMatch && openMatch[0].endsWith('/>')) {
    // empty self-closing row -> expand
    const openTag = openMatch[0].replace(/\/>$/, '>')
    return `${openTag}${cellXml}</row>`
  }

  if (insertBefore) {
    return (
      rowXml.slice(0, insertBefore.index) +
      cellXml +
      rowXml.slice(insertBefore.index)
    )
  }

  const closeIdx = rowXml.lastIndexOf('</row>')
  if (closeIdx === -1) {
    throw new Error(`Не удалось найти конец строки для ${ref}`)
  }
  return rowXml.slice(0, closeIdx) + cellXml + rowXml.slice(closeIdx)
}

function ensureRow(sheetXml, rowNumber, cellXml, ref) {
  const rowRegex = new RegExp(`<row\\b[^>]*\\br="${rowNumber}"[^>]*>[\\s\\S]*?<\\/row>|<row\\b[^>]*\\br="${rowNumber}"[^>]*\\/>`)
  const found = sheetXml.match(rowRegex)
  if (found) {
    const updated = upsertCellInRow(found[0], ref, cellXml)
    return sheetXml.replace(found[0], updated)
  }

  // Create a new row and insert in order inside sheetData
  const newRow = `<row r="${rowNumber}">${cellXml}</row>`
  const sheetDataMatch = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/)
  if (!sheetDataMatch) {
    throw new Error('В листе нет sheetData')
  }

  const inner = sheetDataMatch[1]
  const rowOpenRegex = /<row\b[^>]*\br="(\d+)"[^>]*\/?>/g
  let insertPos = null
  let m
  while ((m = rowOpenRegex.exec(inner))) {
    const r = Number(m[1])
    if (r > rowNumber) {
      insertPos = sheetDataMatch.index + sheetDataMatch[0].indexOf(inner) + m.index
      break
    }
  }

  if (insertPos == null) {
    const close = sheetXml.lastIndexOf('</sheetData>')
    return sheetXml.slice(0, close) + newRow + sheetXml.slice(close)
  }

  return sheetXml.slice(0, insertPos) + newRow + sheetXml.slice(insertPos)
}

function applyPatchesToSheetXml(sheetXml, patches, styleId) {
  let xml = sheetXml
  for (const patch of patches) {
    const ref = cellRef(patch.row, patch.col)
    const cellXml = buildCellXml(ref, styleId, patch.value)
    xml = ensureRow(xml, patch.row, cellXml, ref)
  }
  return xml
}

/**
 * Patch cells inside an existing xlsx without rewriting the whole workbook.
 * Preserves drawings, charts, and other OOXML parts that ExcelJS drops.
 */
async function patchWorkbookCells(excelPath, sheetName, targets, workTypeId) {
  const buffer = fs.readFileSync(excelPath)
  const zip = await JSZip.loadAsync(buffer)

  const stylesFile = zip.file('xl/styles.xml')
  if (!stylesFile) throw new Error('В файле нет xl/styles.xml')
  const stylesXml = await stylesFile.async('string')
  const { styleId, value } = resolveWorkTypeStyle(stylesXml, workTypeId)

  const sheetPath = await resolveSheetPath(zip, sheetName)
  const sheetFile = zip.file(sheetPath)
  if (!sheetFile) throw new Error(`Не найден файл листа: ${sheetPath}`)

  const sheetXml = await sheetFile.async('string')
  const patches = targets.map((t) => ({ row: t.row, col: t.col, value }))
  const nextXml = applyPatchesToSheetXml(sheetXml, patches, styleId)
  zip.file(sheetPath, nextXml)

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
  fs.writeFileSync(excelPath, out)

  return { styleId, value, sheetPath }
}

module.exports = {
  patchWorkbookCells,
  resolveWorkTypeStyle,
  cellRef,
  numberToCol,
  colToNumber
}
