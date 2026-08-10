import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const runtimeLicenseFileName = 'THIRD_PARTY_LICENSES.txt'

export const requiredRuntimeLicensePackages = [
  '@ai-sdk/react',
  '@supabase/supabase-js',
  'ai',
  'lucide-react',
  'react',
]

export const distributionFiles = [
  { source: 'LICENSE', target: 'LICENSE.txt' },
  { source: 'THIRD_PARTY_NOTICES.md', target: 'THIRD_PARTY_NOTICES.md' },
]

const CURATED_LICENSE_MATERIALS = new Map([
  [
    '@ai-sdk/provider-utils@5.0.10',
    ['scripts/third-party-license-materials/ai-sdk-provider-utils-5.0.10-LICENSE.txt'],
  ],
  [
    'use-composed-ref@1.4.0',
    ['scripts/third-party-license-materials/use-composed-ref-1.4.0-LICENSE.txt'],
  ],
])

const LICENSE_FILE_PATTERN = /^(?:licen[cs]e|copying|copyright|notice|patents)(?:[._-]|$)/i
const INVALID_LICENSE_DECLARATION_PATTERN = /^(?:unlicen[cs]ed|proprietary|none)$/i
const REFERENCED_LICENSE_DECLARATION_PATTERN = /^SEE LICEN[CS]E IN (.+)$/i

function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, '\n')
}

function normalizeLocation(value) {
  return value.replaceAll('\\', '/')
}

function compareText(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function packageLicenseDeclaration(packageJson) {
  if (typeof packageJson.license === 'string' && packageJson.license.trim()) {
    return packageJson.license.trim()
  }

  if (Array.isArray(packageJson.licenses)) {
    const declarations = packageJson.licenses
      .map((license) => (typeof license === 'string' ? license : license?.type))
      .filter((license) => typeof license === 'string' && license.trim())
      .map((license) => license.trim())
    if (declarations.length > 0) return declarations.join(' OR ')
  }

  return null
}

function assertSafePackageLocation(location, rootDirectory) {
  const normalized = normalizeLocation(location)
  if (
    isAbsolute(location) ||
    !normalized.startsWith('node_modules/') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe package location in package-lock.json: ${location}`)
  }

  const packageDirectory = resolve(rootDirectory, location)
  const relativePath = relative(rootDirectory, packageDirectory)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Package location escapes the repository: ${location}`)
  }
  return packageDirectory
}

async function licenseMaterialFiles(packageDirectory, currentDirectory = packageDirectory) {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') return []
        return licenseMaterialFiles(packageDirectory, path)
      }
      if (!entry.isFile() || !LICENSE_FILE_PATTERN.test(entry.name)) return []

      const content = normalizeNewlines(await readFile(path, 'utf8')).trim()
      const materialPath = normalizeLocation(relative(packageDirectory, path))
      if (!content) throw new Error(`License material is empty: ${materialPath}`)
      return [{ path: materialPath, content, packageLevel: currentDirectory === packageDirectory }]
    }),
  )

  return nested.flat().sort((left, right) => compareText(left.path, right.path))
}

async function curatedLicenseMaterials(rootDirectory, packageName, packageVersion) {
  const packageKey = `${packageName}@${packageVersion}`
  const paths = CURATED_LICENSE_MATERIALS.get(packageKey) ?? []
  return Promise.all(
    paths.map(async (materialPath) => {
      let content
      try {
        content = normalizeNewlines(
          await readFile(join(rootDirectory, materialPath), 'utf8'),
        ).trim()
      } catch {
        throw new Error(`Curated license material is missing for ${packageKey}: ${materialPath}`)
      }
      if (!content) throw new Error(`Curated license material is empty: ${materialPath}`)
      return { path: `curated/${normalizeLocation(materialPath)}`, content, packageLevel: true }
    }),
  )
}

function parseLockfile(contents, lockfilePath) {
  let lockfile
  try {
    lockfile = JSON.parse(contents)
  } catch (error) {
    throw new Error(`Unable to parse ${lockfilePath}: ${error.message}`)
  }

  if (lockfile.lockfileVersion !== 3 || !lockfile.packages || !lockfile.packages['']) {
    throw new Error(`${lockfilePath} must use npm lockfileVersion 3 and contain a root package.`)
  }
  return lockfile
}

async function readLockfile(
  rootDirectory,
  lockfilePath = join(rootDirectory, 'package-lock.json'),
) {
  return parseLockfile(await readFile(lockfilePath, 'utf8'), lockfilePath)
}

function normalizedModulePath(moduleId) {
  let path = moduleId.startsWith('\0') ? moduleId.slice(1) : moduleId
  path = path.split('?')[0]
  if (path.startsWith('file:')) path = fileURLToPath(path)
  return isAbsolute(path) ? resolve(path) : null
}

export function runtimePackageLocationsFromViteOutput({ rootDirectory, lockfile, outputs }) {
  const buildOutputs = Array.isArray(outputs) ? outputs : [outputs]
  const modulePaths = new Set()
  for (const buildOutput of buildOutputs) {
    for (const output of buildOutput?.output ?? []) {
      if (output.type !== 'chunk') continue
      for (const moduleId of Object.keys(output.modules ?? {})) {
        const modulePath = normalizedModulePath(moduleId)
        if (modulePath) modulePaths.add(modulePath)
      }
    }
  }
  if (modulePaths.size === 0) throw new Error('Vite produced no runtime module inventory.')

  const candidates = Object.entries(lockfile.packages)
    .filter(([location]) => location.startsWith('node_modules/'))
    .map(([location]) => ({
      location: normalizeLocation(location),
      directory: assertSafePackageLocation(location, rootDirectory),
    }))
    .sort((left, right) => right.directory.length - left.directory.length)

  const packageLocations = new Set()
  const unmappedPackageModules = []
  const nodeModulesDirectory = resolve(rootDirectory, 'node_modules')
  for (const modulePath of modulePaths) {
    const owner = candidates.find(
      (candidate) =>
        modulePath === candidate.directory || modulePath.startsWith(`${candidate.directory}${sep}`),
    )
    if (owner) {
      packageLocations.add(owner.location)
    } else if (
      modulePath === nodeModulesDirectory ||
      modulePath.startsWith(`${nodeModulesDirectory}${sep}`)
    ) {
      unmappedPackageModules.push(normalizeLocation(relative(rootDirectory, modulePath)))
    }
  }
  if (unmappedPackageModules.length > 0) {
    throw new Error(
      `Vite runtime modules did not map to package-lock.json: ${unmappedPackageModules.join(', ')}`,
    )
  }
  if (packageLocations.size === 0) {
    throw new Error('Vite runtime modules did not map to installed production packages.')
  }
  return packageLocations
}

export async function collectRuntimeLicenseEntries({
  rootDirectory = process.cwd(),
  lockfilePath = join(rootDirectory, 'package-lock.json'),
  includedPackageLocations,
} = {}) {
  const lockfile = await readLockfile(rootDirectory, lockfilePath)
  const requestedLocations = includedPackageLocations
    ? new Set([...includedPackageLocations].map(normalizeLocation))
    : null
  const collectedLocations = new Set()
  const entries = []

  for (const [location, lockedPackage] of Object.entries(lockfile.packages)) {
    const normalized = normalizeLocation(location)
    if (
      !normalized.startsWith('node_modules/') ||
      (!requestedLocations && lockedPackage.dev === true) ||
      (requestedLocations && !requestedLocations.has(normalized))
    ) {
      continue
    }

    const packageDirectory = assertSafePackageLocation(location, rootDirectory)
    const packageJsonPath = join(packageDirectory, 'package.json')
    let packageJson
    try {
      packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    } catch (error) {
      if (!requestedLocations && lockedPackage.optional === true && error?.code === 'ENOENT')
        continue
      throw new Error(`Required production package is not installed correctly: ${location}`)
    }

    if (!packageJson.name || !packageJson.version) {
      throw new Error(`Installed package metadata is incomplete: ${location}`)
    }
    if (packageJson.version !== lockedPackage.version) {
      throw new Error(
        `Installed package version does not match package-lock.json: ${packageJson.name} has ${packageJson.version}, expected ${lockedPackage.version}.`,
      )
    }

    const declaredLicense = packageLicenseDeclaration(packageJson)
    if (declaredLicense && INVALID_LICENSE_DECLARATION_PATTERN.test(declaredLicense)) {
      throw new Error(
        `Production package is not distributable: ${packageJson.name}@${packageJson.version} declares ${declaredLicense}.`,
      )
    }

    const packageMaterials = await licenseMaterialFiles(packageDirectory)
    const curatedMaterials = await curatedLicenseMaterials(
      rootDirectory,
      packageJson.name,
      packageJson.version,
    )
    const materials = [...curatedMaterials, ...packageMaterials].sort((left, right) =>
      compareText(left.path, right.path),
    )
    if (!materials.some((material) => material.packageLevel)) {
      throw new Error(
        `Production package has no package-level license material: ${packageJson.name}@${packageJson.version}`,
      )
    }

    const referencedLicense = declaredLicense?.match(REFERENCED_LICENSE_DECLARATION_PATTERN)?.[1]
    if (
      referencedLicense &&
      !packageMaterials.some(
        (material) =>
          material.path.toLowerCase() === normalizeLocation(referencedLicense).toLowerCase(),
      )
    ) {
      throw new Error(
        `Production package references missing license material: ${packageJson.name}@${packageJson.version} expects ${referencedLicense}`,
      )
    }

    entries.push({
      name: packageJson.name,
      version: packageJson.version,
      location: normalized,
      declaredLicense,
      materials,
    })
    collectedLocations.add(normalized)
  }

  if (requestedLocations) {
    const missingLocations = [...requestedLocations].filter(
      (location) => !collectedLocations.has(location),
    )
    if (missingLocations.length > 0) {
      throw new Error(
        `Runtime package locations were not collected: ${missingLocations.join(', ')}`,
      )
    }
  }
  if (entries.length === 0) {
    throw new Error('No installed production packages were found for the license report.')
  }

  return entries.sort(
    (left, right) =>
      compareText(left.name, right.name) ||
      compareText(left.version, right.version) ||
      compareText(left.location, right.location),
  )
}

export function verifyRuntimeLicenseEntries(
  entries,
  requiredPackages = requiredRuntimeLicensePackages,
) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('The runtime license inventory is empty.')
  }
  if (entries.some((entry) => !entry.materials?.some((material) => material.packageLevel))) {
    throw new Error('Every runtime package must include non-empty package-level license material.')
  }

  const packageNames = new Set(entries.map((entry) => entry.name))
  const missingPackages = requiredPackages.filter((packageName) => !packageNames.has(packageName))
  if (missingPackages.length > 0) {
    throw new Error(
      `Runtime license inventory is missing required packages: ${missingPackages.join(', ')}`,
    )
  }
}

export function renderRuntimeLicenseReport(entries) {
  const sections = entries.map((entry) => {
    const header = [
      '================================================================================',
      `Package: ${entry.name}@${entry.version}`,
      `Installed path: ${entry.location}`,
      `Declared license: ${entry.declaredLicense ?? 'not declared'}`,
    ]
    const materials = entry.materials.map(
      (material) =>
        `\n----- BEGIN ${material.path} -----\n${material.content}\n----- END ${material.path} -----`,
    )
    return `${header.join('\n')}\n${materials.join('\n')}`
  })

  return `${[
    'THIRD-PARTY RUNTIME LICENSES',
    '',
    'This file is generated deterministically from package-lock.json, installed package',
    'materials, and the modules included in the Vite production bundle. Do not edit it',
    'or commit dist/.',
    '',
    `Production package entries: ${entries.length}`,
    '',
    ...sections,
    '',
  ].join('\n')}`
}

export function verifyRuntimeLicenseReport(
  report,
  requiredPackages = requiredRuntimeLicensePackages,
) {
  if (typeof report !== 'string' || !report.trim()) {
    throw new Error(`${runtimeLicenseFileName} is missing or empty.`)
  }
  if (!report.startsWith('THIRD-PARTY RUNTIME LICENSES\n')) {
    throw new Error(`${runtimeLicenseFileName} has an invalid header.`)
  }

  const missingPackages = requiredPackages.filter(
    (packageName) => !report.includes(`Package: ${packageName}@`),
  )
  if (missingPackages.length > 0) {
    throw new Error(`${runtimeLicenseFileName} is missing packages: ${missingPackages.join(', ')}`)
  }
}

function packageLocationsFromReport(report) {
  const locations = [...report.matchAll(/^Installed path: (node_modules\/.+)$/gm)].map(
    (match) => match[1],
  )
  if (locations.length === 0 || new Set(locations).size !== locations.length) {
    throw new Error(`${runtimeLicenseFileName} has missing or duplicate package locations.`)
  }
  return new Set(locations)
}

async function writeDistributionFiles(rootDirectory, outputDirectory) {
  for (const file of distributionFiles) {
    const source = await readFile(join(rootDirectory, file.source))
    if (!source.toString('utf8').trim()) throw new Error(`${file.source} is empty.`)
    const targetPath = join(outputDirectory, file.target)
    await writeFile(targetPath, source)
    const written = await readFile(targetPath)
    if (!written.equals(source)) throw new Error(`${file.target} was not copied byte-for-byte.`)
  }
}

async function checkDistributionFiles(rootDirectory, outputDirectory) {
  for (const file of distributionFiles) {
    const source = await readFile(join(rootDirectory, file.source))
    let distributed
    try {
      distributed = await readFile(join(outputDirectory, file.target))
    } catch {
      throw new Error(`${file.target} is missing from the production build.`)
    }
    if (!distributed.equals(source)) {
      throw new Error(`${file.target} does not match ${file.source} byte-for-byte.`)
    }
  }
}

export async function writeRuntimeLicenseReport({
  rootDirectory = process.cwd(),
  outputDirectory = join(rootDirectory, 'dist'),
  requiredPackages = requiredRuntimeLicensePackages,
  includedPackageLocations,
} = {}) {
  const entries = await collectRuntimeLicenseEntries({ rootDirectory, includedPackageLocations })
  verifyRuntimeLicenseEntries(entries, requiredPackages)
  const report = renderRuntimeLicenseReport(entries)
  verifyRuntimeLicenseReport(report, requiredPackages)

  await mkdir(outputDirectory, { recursive: true })
  const outputPath = join(outputDirectory, runtimeLicenseFileName)
  await writeFile(outputPath, report, 'utf8')
  await writeDistributionFiles(rootDirectory, outputDirectory)
  const writtenReport = await readFile(outputPath, 'utf8')
  if (writtenReport !== report) {
    throw new Error(`${runtimeLicenseFileName} did not round-trip exactly after writing.`)
  }
  return { outputPath, entries, report }
}

export async function checkRuntimeLicenseReport({
  rootDirectory = process.cwd(),
  outputDirectory = join(rootDirectory, 'dist'),
  requiredPackages = requiredRuntimeLicensePackages,
  viteBuild,
} = {}) {
  const outputPath = join(outputDirectory, runtimeLicenseFileName)
  let actualReport
  try {
    actualReport = await readFile(outputPath, 'utf8')
  } catch {
    throw new Error(`${runtimeLicenseFileName} is missing from the production build.`)
  }
  verifyRuntimeLicenseReport(actualReport, requiredPackages)

  const build = viteBuild ?? (await import('vite')).build
  const outputs = await build({ root: rootDirectory, build: { write: false } })
  const lockfile = await readLockfile(rootDirectory)
  const bundledPackageLocations = runtimePackageLocationsFromViteOutput({
    rootDirectory,
    lockfile,
    outputs,
  })
  const reportedPackageLocations = packageLocationsFromReport(actualReport)
  const missingLocations = [...bundledPackageLocations].filter(
    (location) => !reportedPackageLocations.has(location),
  )
  const extraLocations = [...reportedPackageLocations].filter(
    (location) => !bundledPackageLocations.has(location),
  )
  if (missingLocations.length > 0 || extraLocations.length > 0) {
    const details = [
      missingLocations.length > 0 ? `missing: ${missingLocations.join(', ')}` : null,
      extraLocations.length > 0 ? `extra: ${extraLocations.join(', ')}` : null,
    ].filter(Boolean)
    throw new Error(
      `${runtimeLicenseFileName} does not match the Vite runtime package inventory (${details.join('; ')}).`,
    )
  }

  const entries = await collectRuntimeLicenseEntries({
    rootDirectory,
    includedPackageLocations: bundledPackageLocations,
  })
  verifyRuntimeLicenseEntries(entries, requiredPackages)
  const expectedReport = renderRuntimeLicenseReport(entries)
  if (actualReport !== expectedReport) {
    throw new Error(`${runtimeLicenseFileName} is stale or does not match installed dependencies.`)
  }
  await checkDistributionFiles(rootDirectory, outputDirectory)
  return { outputPath, entries, report: actualReport }
}

export async function buildProductionWithRuntimeLicenses({
  rootDirectory = process.cwd(),
  outputDirectory = join(rootDirectory, 'dist'),
  requiredPackages = requiredRuntimeLicensePackages,
  viteBuild,
} = {}) {
  const build = viteBuild ?? (await import('vite')).build
  const outputs = await build()
  const lockfile = await readLockfile(rootDirectory)
  const includedPackageLocations = runtimePackageLocationsFromViteOutput({
    rootDirectory,
    lockfile,
    outputs,
  })
  return writeRuntimeLicenseReport({
    rootDirectory,
    outputDirectory,
    requiredPackages,
    includedPackageLocations,
  })
}

async function main() {
  const mode = process.argv[2] ?? '--build'
  if (!['--build', '--check'].includes(mode)) {
    throw new Error('Usage: node scripts/generate-third-party-licenses.mjs [--build|--check]')
  }

  const result =
    mode === '--check'
      ? await checkRuntimeLicenseReport()
      : await buildProductionWithRuntimeLicenses()
  const action = mode === '--check' ? 'Verified' : 'Built and generated'
  console.log(
    `${action} ${runtimeLicenseFileName} with ${result.entries.length} production package entries.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
