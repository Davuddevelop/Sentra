/**
 * Run with: node generate-icons.js
 * Generates PNG icons from the Sentra diamond SVG.
 * Requires: npm install canvas (optional — icons can also be made manually)
 */

// Fallback: copy any 16/32/48/128 px PNG named icon16.png etc. into this folder.
// The manifest references icons/icon16.png etc.

console.log(`
To add icons, place these files in the extension/icons/ folder:
  icon16.png  (16×16)
  icon32.png  (32×32)
  icon48.png  (48×48)
  icon128.png (128×128)

Use the Sentra diamond ◆ on #1A2A22 background with #F8F4E8 text color.
`)
