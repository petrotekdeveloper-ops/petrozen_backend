const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const frontendImagesDir = path.resolve(__dirname, "../../frontend/src/assets/images");
const logoDir = path.resolve(__dirname, "../../frontend/src/assets");

const conversions = [
  { input: path.join(logoDir, "logo.png"), output: path.join(logoDir, "logo.webp"), width: 720, quality: 82 },
  { input: path.join(logoDir, "logo_white.png"), output: path.join(logoDir, "logo_white.webp"), width: 720, quality: 82 },
  { input: path.join(frontendImagesDir, "aboutUS.jpg"), output: path.join(frontendImagesDir, "aboutUS.webp"), width: 1400, quality: 80 },
  { input: path.join(frontendImagesDir, "aboutUsHero.jpg"), output: path.join(frontendImagesDir, "aboutUsHero.webp"), width: 1920, quality: 80 },
  { input: path.join(frontendImagesDir, "airCompService.jpeg"), output: path.join(frontendImagesDir, "airCompService.webp"), width: 1280, quality: 78 },
  { input: path.join(frontendImagesDir, "cncServices.jpeg"), output: path.join(frontendImagesDir, "cncServices.webp"), width: 1280, quality: 78 },
  { input: path.join(frontendImagesDir, "heroTest1.jpeg"), output: path.join(frontendImagesDir, "heroTest1.webp"), width: 1920, quality: 78 },
  { input: path.join(frontendImagesDir, "heroTest1.jpeg"), output: path.join(frontendImagesDir, "heroTest1-1280.webp"), width: 1280, quality: 76 },
  { input: path.join(frontendImagesDir, "heroTest1.jpeg"), output: path.join(frontendImagesDir, "heroTest1-768.webp"), width: 768, quality: 74 },
  { input: path.join(frontendImagesDir, "industrial-manufacturing.jpg"), output: path.join(frontendImagesDir, "industrial-manufacturing.webp"), width: 1280, quality: 78 },
  { input: path.join(frontendImagesDir, "industry-refinery.jpg"), output: path.join(frontendImagesDir, "industry-refinery.webp"), width: 1280, quality: 78 },
  { input: path.join(frontendImagesDir, "missionandvisiomAbout.png"), output: path.join(frontendImagesDir, "missionandvisiomAbout.webp"), width: 1920, quality: 76 },
  { input: path.join(frontendImagesDir, "safety.png"), output: path.join(frontendImagesDir, "safety.webp"), width: 1600, quality: 76 },
  { input: path.join(frontendImagesDir, "serviceMain.jpeg"), output: path.join(frontendImagesDir, "serviceMain.webp"), width: 1600, quality: 78 },
  { input: path.join(frontendImagesDir, "servicesHero.avif"), output: path.join(frontendImagesDir, "servicesHero.webp"), width: 1920, quality: 80 },
  { input: path.join(frontendImagesDir, "vaccumPumpServives.png"), output: path.join(frontendImagesDir, "vaccumPumpServives.webp"), width: 1280, quality: 76 },
];

const homeCardDir = path.join(frontendImagesDir, "homeServiceCard");
for (let i = 1; i <= 5; i += 1) {
  const input = i === 4 ? path.join(homeCardDir, "seviceCard4.webp") : path.join(homeCardDir, `serviceCard${i}.webp`);
  const output = i === 4 ? path.join(homeCardDir, "seviceCard4-optimized.webp") : path.join(homeCardDir, `serviceCard${i}-optimized.webp`);
  conversions.push({ input, output, width: 960, quality: 78 });
}

async function run() {
  const results = [];
  for (const item of conversions) {
    if (!fs.existsSync(item.input)) {
      results.push({ output: item.output, status: "missing-input" });
      continue;
    }

    await sharp(item.input)
      .rotate()
      .resize({ width: item.width, withoutEnlargement: true })
      .webp({ quality: item.quality, effort: 5 })
      .toFile(item.output);

    const sizeKb = Math.round(fs.statSync(item.output).size / 1024);
    results.push({ output: item.output, status: `ok (${sizeKb} KiB)` });
  }

  for (const row of results) {
    process.stdout.write(`${row.status.padEnd(16)} ${path.relative(path.resolve(__dirname, "../.."), row.output)}\n`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
