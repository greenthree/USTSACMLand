import { copyFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve(process.cwd(), process.argv[2] ?? 'dist')
const indexFile = resolve(outputDirectory, 'index.html')
const fallbackFile = resolve(outputDirectory, '404.html')

await stat(indexFile)
await copyFile(indexFile, fallbackFile)

console.log(`Created GitHub Pages SPA fallback at ${fallbackFile}`)
