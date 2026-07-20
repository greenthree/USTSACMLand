import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const distDirectory = join(process.cwd(), 'dist')
const html = await readFile(join(distDirectory, 'index.html'), 'utf8')

const requiredMetadata = [
  '<title>USTS ACM Land | 苏州科技大学 ACM 集训队官网</title>',
  'name="description"',
  'rel="canonical" href="https://ustsacm.fun/"',
  'property="og:title"',
  'property="og:description"',
  'property="og:image"',
  'name="twitter:card" content="summary"',
  'href="/favicon-192.png"',
]

for (const metadata of requiredMetadata) {
  if (!html.includes(metadata)) {
    throw new Error(`Production HTML is missing required metadata: ${metadata}`)
  }
}

await Promise.all([
  access(join(distDirectory, 'favicon-192.png')),
  access(join(distDirectory, 'favicon-512.png')),
])

console.log('Verified production site metadata and icon assets.')
