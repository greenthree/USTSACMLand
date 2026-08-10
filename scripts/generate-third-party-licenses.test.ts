import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  checkRuntimeLicenseReport,
  collectRuntimeLicenseEntries,
  requiredRuntimeLicensePackages,
  renderRuntimeLicenseReport,
  runtimePackageLocationsFromViteOutput,
  writeRuntimeLicenseReport,
} from './generate-third-party-licenses.mjs'

type PackageFixture = {
  name: string
  version?: string
  license?: string
  material?: string | null
  dev?: boolean
}

describe('third-party runtime license report', () => {
  let rootDirectory: string

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), 'usts-runtime-licenses-'))
  })

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true })
  })

  async function writeFixture(packages: PackageFixture[]) {
    const lockPackages: Record<string, object> = {
      '': {
        name: 'fixture',
        version: '1.0.0',
        dependencies: Object.fromEntries(
          packages
            .filter((entry) => !entry.dev)
            .map((entry) => [entry.name, entry.version ?? '1.0.0']),
        ),
      },
    }

    for (const entry of packages) {
      const version = entry.version ?? '1.0.0'
      const location = `node_modules/${entry.name}`
      lockPackages[location] = { version, ...(entry.dev ? { dev: true } : {}) }
      const directory = join(rootDirectory, location)
      await mkdir(directory, { recursive: true })
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
          name: entry.name,
          version,
          ...(entry.license ? { license: entry.license } : {}),
        }),
      )
      if (entry.material !== null && entry.material !== undefined) {
        await writeFile(join(directory, 'LICENSE'), entry.material)
      }
    }

    await writeFile(
      join(rootDirectory, 'package-lock.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: lockPackages,
      }),
    )
    await writeFile(join(rootDirectory, 'LICENSE'), 'Root project license\r\n')
    await writeFile(
      join(rootDirectory, 'THIRD_PARTY_NOTICES.md'),
      '# Fixture third-party notices\r\n',
    )
  }

  function viteOutputFor(packageNames: string[]) {
    return {
      output: [
        {
          type: 'chunk',
          modules: Object.fromEntries(
            packageNames.map((name) => [
              join(rootDirectory, 'node_modules', name, 'dist', 'index.js'),
              {},
            ]),
          ),
        },
      ],
    }
  }

  it('generates deterministic content from installed production packages and excludes dev packages', async () => {
    await writeFixture([
      { name: 'react', license: 'MIT', material: 'React fixture license\r\n' },
      { name: 'dev-only', license: 'MIT', material: 'Dev fixture license', dev: true },
    ])

    const entries = await collectRuntimeLicenseEntries({ rootDirectory })
    const first = renderRuntimeLicenseReport(entries)
    const second = renderRuntimeLicenseReport(await collectRuntimeLicenseEntries({ rootDirectory }))

    expect(first).toBe(second)
    expect(first).toContain('Package: react@1.0.0')
    expect(first).toContain('React fixture license\n----- END LICENSE -----')
    expect(first).not.toContain('dev-only')
    expect(first).not.toContain(rootDirectory)
  })

  it('rejects a package.json license declaration without distributable license text', async () => {
    await writeFixture([{ name: 'react', license: 'MIT', material: null }])

    await expect(collectRuntimeLicenseEntries({ rootDirectory })).rejects.toThrow(
      /no package-level license material/,
    )
  })

  it('does not infer a copyright owner for use-composed-ref 1.4.0', async () => {
    const material = await readFile(
      join(
        process.cwd(),
        'scripts/third-party-license-materials/use-composed-ref-1.4.0-LICENSE.txt',
      ),
      'utf8',
    )

    expect(material).toContain(
      'The exact npm tarball and source tag do not provide a copyright notice or a\n' +
        'separate license file. No copyright attribution is inferred here.',
    )
    expect(material).not.toContain('Copyright (c) Andarist')
  })

  it('fails closed when an installed production package has no license evidence', async () => {
    await writeFixture([{ name: 'react', material: null }])

    await expect(collectRuntimeLicenseEntries({ rootDirectory })).rejects.toThrow(
      /no package-level license material/,
    )
  })

  it('fails closed when a shipped license file is empty', async () => {
    await writeFixture([{ name: 'react', license: 'MIT', material: '' }])

    await expect(collectRuntimeLicenseEntries({ rootDirectory })).rejects.toThrow(
      /License material is empty/,
    )
  })

  it('fails closed when package.json points to license material that was not shipped', async () => {
    await writeFixture([{ name: 'react', license: 'SEE LICENSE IN LICENSE-MIT', material: null }])

    await expect(collectRuntimeLicenseEntries({ rootDirectory })).rejects.toThrow(
      /no package-level license material/,
    )
  })

  it('maps Vite chunk modules to the most specific production package location', async () => {
    await writeFixture([
      { name: 'parent', license: 'MIT', material: 'Parent license' },
      { name: 'parent/node_modules/nested', license: 'MIT', material: 'Nested license' },
    ])
    const lockfile = JSON.parse(await readFile(join(rootDirectory, 'package-lock.json'), 'utf8'))
    const nestedModule = join(
      rootDirectory,
      'node_modules/parent/node_modules/nested/dist/index.js',
    )

    const locations = runtimePackageLocationsFromViteOutput({
      rootDirectory,
      lockfile,
      outputs: { output: [{ type: 'chunk', modules: { [nestedModule]: {} } }] },
    })

    expect([...locations]).toEqual(['node_modules/parent/node_modules/nested'])
  })

  it('includes a devDependency when Vite actually bundles it', async () => {
    await writeFixture([
      { name: 'react', license: 'MIT', material: 'React license' },
      { name: 'dev-only', license: 'MIT', material: 'Dev license', dev: true },
    ])
    const lockfile = JSON.parse(await readFile(join(rootDirectory, 'package-lock.json'), 'utf8'))
    const locations = runtimePackageLocationsFromViteOutput({
      rootDirectory,
      lockfile,
      outputs: viteOutputFor(['react', 'dev-only']),
    })
    const entries = await collectRuntimeLicenseEntries({
      rootDirectory,
      includedPackageLocations: locations,
    })

    expect([...locations].sort()).toEqual(['node_modules/dev-only', 'node_modules/react'])
    expect(entries.map((entry) => entry.name).sort()).toEqual(['dev-only', 'react'])
  })

  it('fails closed when any bundled node_modules path is absent from package-lock.json', async () => {
    await writeFixture([{ name: 'react', license: 'MIT', material: 'React license' }])
    const lockfile = JSON.parse(await readFile(join(rootDirectory, 'package-lock.json'), 'utf8'))
    const outputs = viteOutputFor(['react', 'not-locked'])

    expect(() =>
      runtimePackageLocationsFromViteOutput({ rootDirectory, lockfile, outputs }),
    ).toThrow(/did not map to package-lock.json.*not-locked/)
  })

  it('fails closed when an installed version differs from package-lock.json', async () => {
    await writeFixture([{ name: 'react', version: '1.0.0', license: 'MIT', material: 'License' }])
    await writeFile(
      join(rootDirectory, 'node_modules/react/package.json'),
      JSON.stringify({ name: 'react', version: '2.0.0', license: 'MIT' }),
    )

    await expect(collectRuntimeLicenseEntries({ rootDirectory })).rejects.toThrow(
      /does not match package-lock.json/,
    )
  })

  it('writes and then verifies a non-empty report with required package coverage', async () => {
    await writeFixture([{ name: 'react', license: 'MIT', material: 'License text' }])
    const outputDirectory = join(rootDirectory, 'dist')
    const viteBuild = vi.fn(async () => viteOutputFor(['react']))

    await writeRuntimeLicenseReport({
      rootDirectory,
      outputDirectory,
      requiredPackages: ['react'],
    })
    const result = await checkRuntimeLicenseReport({
      rootDirectory,
      outputDirectory,
      requiredPackages: ['react'],
      viteBuild,
    })

    expect(viteBuild).toHaveBeenCalledWith({
      root: rootDirectory,
      build: { write: false },
    })
    expect(result.report).toContain('Package: react@1.0.0')
    expect(await readFile(join(outputDirectory, 'THIRD_PARTY_LICENSES.txt'), 'utf8')).not.toBe('')
    expect(await readFile(join(outputDirectory, 'LICENSE.txt'), 'utf8')).toBe(
      'Root project license\r\n',
    )
    expect(await readFile(join(outputDirectory, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toBe(
      '# Fixture third-party notices\r\n',
    )
  })

  it('rejects distributed project license or notice files that are missing or changed', async () => {
    await writeFixture([{ name: 'react', license: 'MIT', material: 'License text' }])
    const outputDirectory = join(rootDirectory, 'dist')
    await writeRuntimeLicenseReport({
      rootDirectory,
      outputDirectory,
      requiredPackages: ['react'],
    })

    await writeFile(join(outputDirectory, 'LICENSE.txt'), 'changed')
    await expect(
      checkRuntimeLicenseReport({
        rootDirectory,
        outputDirectory,
        requiredPackages: ['react'],
        viteBuild: async () => viteOutputFor(['react']),
      }),
    ).rejects.toThrow(/does not match LICENSE byte-for-byte/)

    await writeFile(join(outputDirectory, 'LICENSE.txt'), 'Root project license\r\n')
    await rm(join(outputDirectory, 'THIRD_PARTY_NOTICES.md'))
    await expect(
      checkRuntimeLicenseReport({
        rootDirectory,
        outputDirectory,
        requiredPackages: ['react'],
        viteBuild: async () => viteOutputFor(['react']),
      }),
    ).rejects.toThrow(/THIRD_PARTY_NOTICES.md is missing/)
  })

  it('rejects a self-consistent report that omits a bundled package', async () => {
    await writeFixture([
      { name: 'react', license: 'MIT', material: 'React license' },
      { name: 'bundled-extra', license: 'MIT', material: 'Extra license' },
    ])
    const outputDirectory = join(rootDirectory, 'dist')
    await writeRuntimeLicenseReport({
      rootDirectory,
      outputDirectory,
      requiredPackages: ['react'],
    })
    const truncatedEntries = await collectRuntimeLicenseEntries({
      rootDirectory,
      includedPackageLocations: new Set(['node_modules/react']),
    })
    await writeFile(
      join(outputDirectory, 'THIRD_PARTY_LICENSES.txt'),
      renderRuntimeLicenseReport(truncatedEntries),
    )

    await expect(
      checkRuntimeLicenseReport({
        rootDirectory,
        outputDirectory,
        requiredPackages: ['react'],
        viteBuild: async () => viteOutputFor(['react', 'bundled-extra']),
      }),
    ).rejects.toThrow(/does not match the Vite runtime package inventory.*bundled-extra/)
  })

  it('rejects a report after the Vite runtime package inventory changes', async () => {
    await writeFixture([
      { name: 'react', license: 'MIT', material: 'React license' },
      { name: 'later-bundled', license: 'MIT', material: 'Later license' },
    ])
    const outputDirectory = join(rootDirectory, 'dist')
    await writeRuntimeLicenseReport({
      rootDirectory,
      outputDirectory,
      requiredPackages: ['react'],
      includedPackageLocations: new Set(['node_modules/react']),
    })

    await expect(
      checkRuntimeLicenseReport({
        rootDirectory,
        outputDirectory,
        requiredPackages: ['react'],
        viteBuild: async () => viteOutputFor(['react', 'later-bundled']),
      }),
    ).rejects.toThrow(/does not match the Vite runtime package inventory.*later-bundled/)
  })

  it('enforces the React, Supabase, AI SDK, and Lucide build coverage set', async () => {
    await writeFixture(
      requiredRuntimeLicensePackages.map((name) => ({
        name,
        license: 'MIT',
        material: `${name} license`,
      })),
    )

    const result = await writeRuntimeLicenseReport({
      rootDirectory,
      outputDirectory: join(rootDirectory, 'dist'),
    })

    for (const packageName of requiredRuntimeLicensePackages) {
      expect(result.report).toContain(`Package: ${packageName}@1.0.0`)
    }
  })

  it('rejects a missing or stale production report', async () => {
    await writeFixture([{ name: 'react', license: 'MIT', material: 'License text' }])
    const outputDirectory = join(rootDirectory, 'dist')

    await expect(
      checkRuntimeLicenseReport({
        rootDirectory,
        outputDirectory,
        requiredPackages: ['react'],
      }),
    ).rejects.toThrow(/missing from the production build/)

    await mkdir(outputDirectory)
    await writeFile(join(outputDirectory, 'THIRD_PARTY_LICENSES.txt'), 'stale')
    await expect(
      checkRuntimeLicenseReport({
        rootDirectory,
        outputDirectory,
        requiredPackages: ['react'],
      }),
    ).rejects.toThrow(/invalid header/)
  })

  it('rejects a report that does not cover the required runtime packages', async () => {
    await writeFixture([{ name: 'react', license: 'MIT', material: 'License text' }])

    await expect(
      writeRuntimeLicenseReport({
        rootDirectory,
        outputDirectory: join(rootDirectory, 'dist'),
        requiredPackages: ['react', '@supabase/supabase-js'],
      }),
    ).rejects.toThrow(/missing required packages: @supabase\/supabase-js/)
  })
})
