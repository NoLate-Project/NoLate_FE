const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const WIDTH = 1320;
const HEIGHT = 2868;
const FRONTEND_ROOT = path.resolve(__dirname, "../../..");
const WORKSPACE_ROOT = path.resolve(FRONTEND_ROOT, "..");
const BACKGROUND = path.join(__dirname, "source", "nolate-route-background.png");
const ICON = path.join(FRONTEND_ROOT, "assets", "icon.png");

const panels = [
  {
    file: "01-departure-ready.png",
    screenshot: path.join(
      WORKSPACE_ROOT,
      "artifacts/simulator-ui-detail-polish-2026-08-06/edit.png",
    ),
    headline: ["약속에 늦지 않도록", "출발까지 챙겨요"],
    subline: "일정·경로·출발 알림을 하나로 준비하세요.",
    palette: { top: "#F8FBFF", bottom: "#DDEBFF", wash: "#EAF3FF", dark: false },
  },
  {
    file: "02-quick-schedule.png",
    screenshot: path.join(
      WORKSPACE_ROOT,
      "artifacts/simulator-ui-detail-polish-2026-08-06/quick-input.png",
    ),
    headline: ["한 문장으로", "빠르게 일정 만들기"],
    subline: "입력한 내용을 미리보기에서 확인하고 저장하세요.",
    palette: { top: "#FBFAFF", bottom: "#E9E5FF", wash: "#F3F0FF", dark: false },
  },
  {
    file: "03-route-compare.png",
    screenshot: path.join(
      FRONTEND_ROOT,
      "screenshots/new-simulator-route-check/iphone17pro-route-select-result-soft-final.png",
    ),
    headline: ["가는 방법은 다르게", "경로는 한눈에"],
    subline: "자차·대중교통·도보·자전거 경로를 비교해요.",
    palette: { top: "#07111F", bottom: "#163A70", wash: "#0E2446", dark: true },
  },
  {
    file: "04-smart-departure-alert.png",
    screenshot: path.join(
      WORKSPACE_ROOT,
      "artifacts/simulator-ui-detail-polish-2026-08-06/quick-notification.png",
    ),
    headline: ["도착 시간에 맞춰", "출발할 때를 알려줘요"],
    subline: "교통 상황에 따라 추천 출발 시각을 다시 계산해요.",
    palette: { top: "#F7FFFD", bottom: "#DDF8F1", wash: "#EAFBF7", dark: false },
  },
  {
    file: "05-calendar-overview.png",
    screenshot: path.join(FRONTEND_ROOT, "screenshots/handoff-final-today3.png"),
    headline: ["모든 일정과 출발을", "한눈에 관리해요"],
    subline: "월간 캘린더에서 중요한 약속을 빠르게 확인하세요.",
    palette: { top: "#FFF9FB", bottom: "#EAF2FF", wash: "#F5F2FA", dark: false },
  },
];

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function svgBuffer(markup) {
  return Buffer.from(markup);
}

function getBrandLayout(panel) {
  const hero = panel.file.startsWith("01-");

  return hero
    ? {
        hero: true,
        pill: { x: 94, y: 64, width: 330, height: 108, radius: 54 },
        icon: { left: 110, top: 74, size: 88, radius: 22 },
        label: { x: 218, y: 136, size: 50 },
      }
    : {
        hero: false,
        pill: { x: 94, y: 78, width: 246, height: 80, radius: 40 },
        icon: { left: 106, top: 90, size: 56, radius: 14 },
        label: { x: 178, y: 132, size: 34 },
      };
}

async function roundedImage(input, width, height, radius) {
  const resized = await sharp(input)
    .resize(width, height, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const mask = svgBuffer(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/>
    </svg>
  `);
  return sharp(resized)
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function makePhone(screenshot) {
  const metadata = await sharp(screenshot).metadata();
  const innerWidth = 1010;
  const innerHeight = Math.round((innerWidth * metadata.height) / metadata.width);
  const bezel = 20;
  const phoneWidth = innerWidth + bezel * 2;
  const phoneHeight = innerHeight + bezel * 2;
  const clipped = await roundedImage(screenshot, innerWidth, innerHeight, 82);

  const shell = svgBuffer(`
    <svg width="${phoneWidth}" height="${phoneHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bezel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#13161C"/>
          <stop offset="0.48" stop-color="#030407"/>
          <stop offset="1" stop-color="#2C313A"/>
        </linearGradient>
      </defs>
      <rect width="${phoneWidth}" height="${phoneHeight}" rx="108" fill="url(#bezel)"/>
      <rect x="8" y="8" width="${phoneWidth - 16}" height="${phoneHeight - 16}" rx="100" fill="none" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="3"/>
    </svg>
  `);

  return {
    width: phoneWidth,
    height: phoneHeight,
    buffer: await sharp(shell)
      .composite([{ input: clipped, left: bezel, top: bezel }])
      .png()
      .toBuffer(),
  };
}

async function makeBackground(panel) {
  const pathBackground = await sharp(BACKGROUND)
    .resize(WIDTH, HEIGHT, { fit: "cover" })
    .modulate({ brightness: panel.palette.dark ? 0.45 : 1.03, saturation: panel.palette.dark ? 0.75 : 0.72 })
    .png()
    .toBuffer();

  const overlay = svgBuffer(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${panel.palette.top}" stop-opacity="${panel.palette.dark ? 0.96 : 0.80}"/>
          <stop offset="0.54" stop-color="${panel.palette.wash}" stop-opacity="${panel.palette.dark ? 0.86 : 0.52}"/>
          <stop offset="1" stop-color="${panel.palette.bottom}" stop-opacity="${panel.palette.dark ? 0.88 : 0.56}"/>
        </linearGradient>
        <radialGradient id="glow" cx="15%" cy="8%" r="74%">
          <stop offset="0" stop-color="${panel.palette.dark ? "#3E8BFF" : "#FFFFFF"}" stop-opacity="${panel.palette.dark ? 0.24 : 0.72}"/>
          <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#wash)"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
      <circle cx="1150" cy="470" r="220" fill="none" stroke="${panel.palette.dark ? "#75ABFF" : "#2F7BFF"}" stroke-opacity="0.10" stroke-width="2"/>
      <circle cx="1150" cy="470" r="150" fill="none" stroke="${panel.palette.dark ? "#75ABFF" : "#2F7BFF"}" stroke-opacity="0.08" stroke-width="2"/>
    </svg>
  `);

  return sharp(pathBackground)
    .composite([{ input: overlay }])
    .removeAlpha()
    .png()
    .toBuffer();
}

function makeTypography(panel) {
  const ink = panel.palette.dark ? "#FFFFFF" : "#0B1424";
  const muted = panel.palette.dark ? "#D5E2F8" : "#4F6078";
  const pill = panel.palette.dark ? "#FFFFFF" : "#FFFFFF";
  const brand = getBrandLayout(panel);
  const pillOpacity = panel.palette.dark ? 0.10 : brand.hero ? 0.78 : 0.66;
  const pillStrokeOpacity = panel.palette.dark ? 0.22 : brand.hero ? 0.55 : 0.40;
  const [line1, line2] = panel.headline.map(escapeXml);

  return svgBuffer(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${brand.pill.x}" y="${brand.pill.y}" width="${brand.pill.width}" height="${brand.pill.height}" rx="${brand.pill.radius}" fill="${pill}" fill-opacity="${pillOpacity}" stroke="#FFFFFF" stroke-opacity="${pillStrokeOpacity}" stroke-width="2"/>
      <text x="${brand.label.x}" y="${brand.label.y}" font-family="Pretendard, Apple SD Gothic Neo, sans-serif" font-size="${brand.label.size}" font-weight="800" letter-spacing="-0.7" fill="${ink}">NoLate</text>
      <text x="94" y="282" font-family="Pretendard, Apple SD Gothic Neo, sans-serif" font-size="82" font-weight="800" letter-spacing="-2.1" fill="${ink}">
        <tspan x="94" dy="0">${line1}</tspan>
        <tspan x="94" dy="104">${line2}</tspan>
      </text>
      <text x="96" y="512" font-family="Pretendard, Apple SD Gothic Neo, sans-serif" font-size="36" font-weight="550" letter-spacing="-0.45" fill="${muted}">${escapeXml(panel.subline)}</text>
    </svg>
  `);
}

async function makeIcon(panel) {
  const brand = getBrandLayout(panel);
  return roundedImage(ICON, brand.icon.size, brand.icon.size, brand.icon.radius);
}

async function render(panel) {
  const brand = getBrandLayout(panel);
  const [background, phone, icon] = await Promise.all([
    makeBackground(panel),
    makePhone(panel.screenshot),
    makeIcon(panel),
  ]);
  const phoneLeft = Math.round((WIDTH - phone.width) / 2);
  const phoneTop = 672;

  const shadow = await sharp(
    svgBuffer(`
      <svg width="${phone.width + 120}" height="${phone.height + 120}" xmlns="http://www.w3.org/2000/svg">
        <rect x="60" y="48" width="${phone.width}" height="${phone.height}" rx="112" fill="#06152E" fill-opacity="0.26"/>
      </svg>
    `),
  )
    .blur(34)
    .png()
    .toBuffer();

  const output = path.join(__dirname, panel.file);
  await sharp(background)
    .composite([
      { input: makeTypography(panel), left: 0, top: 0 },
      { input: icon, left: brand.icon.left, top: brand.icon.top },
      { input: shadow, left: phoneLeft - 60, top: phoneTop - 28 },
      { input: phone.buffer, left: phoneLeft, top: phoneTop },
    ])
    .removeAlpha()
    .png({ compressionLevel: 9, palette: false })
    .toFile(output);

  return output;
}

async function renderContactSheet(outputs) {
  const sheetWidth = 1400;
  const sheetHeight = 2140;
  const thumbWidth = 400;
  const thumbHeight = Math.round((thumbWidth * HEIGHT) / WIDTH);
  const positions = [
    { left: 60, top: 170 },
    { left: 500, top: 170 },
    { left: 940, top: 170 },
    { left: 280, top: 1120 },
    { left: 720, top: 1120 },
  ];
  const thumbs = await Promise.all(
    outputs.map((output) => sharp(output).resize(thumbWidth, thumbHeight).jpeg({ quality: 88 }).toBuffer()),
  );
  const title = svgBuffer(`
    <svg width="${sheetWidth}" height="${sheetHeight}" xmlns="http://www.w3.org/2000/svg">
      <text x="60" y="90" font-family="Pretendard, Apple SD Gothic Neo, sans-serif" font-size="52" font-weight="800" fill="#F7FAFF">NoLate · App Store 6.9″</text>
      <text x="60" y="138" font-family="Pretendard, Apple SD Gothic Neo, sans-serif" font-size="26" font-weight="500" fill="#9FB0C8">ko-KR · 1320 × 2868 PNG · upload order 01 → 05</text>
    </svg>
  `);
  const output = path.join(__dirname, "preview-contact-sheet.jpg");
  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 3,
      background: "#08111F",
    },
  })
    .composite([
      { input: title, left: 0, top: 0 },
      ...thumbs.map((input, index) => ({ input, ...positions[index] })),
    ])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toFile(output);
  return output;
}

(async () => {
  const outputs = [];
  for (const panel of panels) {
    const output = await render(panel);
    outputs.push(output);
    const metadata = await sharp(output).metadata();
    console.log(`${path.basename(output)} ${metadata.width}x${metadata.height} alpha=${metadata.hasAlpha}`);
  }
  const contactSheet = await renderContactSheet(outputs);
  console.log(path.basename(contactSheet));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
