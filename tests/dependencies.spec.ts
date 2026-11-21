import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

type LockPackage = { version?: string; dev?: boolean }

const patched = {
  // GHSA-82fw-gwwq-j7x9 and GHSA-qxg6-89mg-rqv8 are fixed in @vitest/mocker 4.1.12.
  mocker: '4.1.12',
  // GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr cover tinypool below 2.1.2.
  tinypool: '2.1.2',
} as const

function versionAtLeast(version: string, floor: string): boolean {
  const left = version.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  const right = floor.split('.').map((part) => Number.parseInt(part, 10))
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta > 0
  }
  return true
}

function locked(packages: Record<string, LockPackage>, name: string): Array<[string, LockPackage]> {
  return Object.entries(packages).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
}

describe('dependency advisories', () => {
  it('keeps vitest 4 and the patched mocker on the dev path', () => {
    const root = new URL('..', import.meta.url)
    const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies: Record<string, string>
    }
    const production = pkg.dependencies ?? {}
    for (const name of ['vitest', '@vitest/mocker', 'tinypool']) {
      expect(production).not.toHaveProperty(name)
    }
    expect(pkg.devDependencies.vitest).toBe('^4.1.12')

    const lock = JSON.parse(fs.readFileSync(new URL('package-lock.json', root), 'utf8')) as {
      packages: Record<string, LockPackage>
    }
    const vitest = locked(lock.packages, 'vitest')
    const mocker = locked(lock.packages, '@vitest/mocker')
    expect(vitest.length).toBeGreaterThan(0)
    expect(mocker.length).toBeGreaterThan(0)

    for (const [, meta] of vitest) {
      expect(meta.dev).toBe(true)
      expect(versionAtLeast(meta.version ?? '0.0.0', patched.mocker)).toBe(true)
      expect(versionAtLeast(meta.version ?? '0.0.0', '5.0.0')).toBe(false)
    }
    for (const [, meta] of mocker) {
      expect(meta.dev).toBe(true)
      expect(versionAtLeast(meta.version ?? '0.0.0', patched.mocker)).toBe(true)
    }
    for (const [, meta] of locked(lock.packages, 'tinypool')) {
      expect(versionAtLeast(meta.version ?? '0.0.0', patched.tinypool)).toBe(true)
    }
  })
})
