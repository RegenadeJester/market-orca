import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canExportReport, safeReportPath } from './report-export-permissions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const reportDir = path.join(__dirname, '..', '..', 'reports')

test('safeReportPath blocks traversal', () => {
  assert.equal(safeReportPath(reportDir, '../../etc/passwd', 'html'), null)
  assert.ok(safeReportPath(reportDir, '2026-05-27', 'html').endsWith('2026-05-27.html'))
})

test('permission matrix', () => {
  const admin = { role:'admin' }
  const user = { role:'user' }
  assert.equal(canExportReport(null, { sensitivity:'public' }).status, 401)
  assert.equal(canExportReport(user, { sensitivity:'internal' }).ok, true)
  assert.equal(canExportReport(user, { sensitivity:'private' }).ok, false)
  assert.equal(canExportReport(admin, { sensitivity:'private' }).ok, true)
})
