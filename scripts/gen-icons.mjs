import sharp from 'sharp'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const publicDir = join(root, 'public')

const svgBuffer = readFileSync(join(publicDir, 'icon.svg'))

await sharp(svgBuffer).resize(192, 192).png().toFile(join(publicDir, 'icon-192.png'))
console.log('✓ icon-192.png')

await sharp(svgBuffer).resize(512, 512).png().toFile(join(publicDir, 'icon-512.png'))
console.log('✓ icon-512.png')

console.log('Icons generated in public/')
