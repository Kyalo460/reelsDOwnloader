const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const projectRoot = path.join(__dirname, '..');
const svgPath = path.join(projectRoot, 'public', 'icon.svg');

async function generateIcons() {
  for (const size of sizes) {
    const outputPath = path.join(projectRoot, 'public', `icon-${size}.png`);
    await sharp(svgPath).resize(size, size).png().toFile(outputPath);
    console.log(`Generated icon-${size}.png`);
  }

  // Also create favicon.png (32x32)
  await sharp(svgPath)
    .resize(32, 32)
    .png()
    .toFile(path.join(projectRoot, 'public', 'favicon.png'));

  console.log('All icons generated!');
}

generateIcons().catch(console.error);
