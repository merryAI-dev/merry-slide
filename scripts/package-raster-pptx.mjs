#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const DEFAULT_OUT = 'merry-slide-deck.pptx';
const WIDE = { width: 13.333333, height: 7.5 };
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SKILL_DIR = path.resolve(path.dirname(SCRIPT_PATH), '..');

function usage() {
  console.log(`사용법:
  node package-raster-pptx.mjs --images page_1.png,page_2.png --out deck.pptx
  node package-raster-pptx.mjs --dir . --out deck.pptx

옵션:
  --images  쉼표로 구분한 이미지 경로. 입력 순서를 그대로 유지합니다.
  --dir     page_<n>.png 파일이 있는 디렉터리. page 번호 기준으로 정렬합니다.
  --out     출력 .pptx 경로. 기본값은 ${DEFAULT_OUT}입니다.
  --title   선택적 덱 메타데이터 제목입니다.
  --layout  현재는 wide만 지원합니다. 향후 확장용입니다.
`);
}

function parseArgs(argv) {
  const args = { images: '', dir: '', out: DEFAULT_OUT, title: 'Merry-slide deck', layout: 'wide' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--help' || key === '-h') {
      args.help = true;
    } else if (key === '--images') {
      args.images = value || '';
      i += 1;
    } else if (key === '--dir') {
      args.dir = value || '';
      i += 1;
    } else if (key === '--out') {
      args.out = value || DEFAULT_OUT;
      i += 1;
    } else if (key === '--title') {
      args.title = value || args.title;
      i += 1;
    } else if (key === '--layout') {
      args.layout = value || args.layout;
      i += 1;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${key}`);
    }
  }
  return args;
}

function imageNumber(filePath) {
  const name = path.basename(filePath);
  const match = name.match(/^page[_-](\d+)[.](png|jpg|jpeg)$/i);
  return match ? Number.parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
}

function resolveImages(args) {
  if (args.images) {
    return args.images.split(',').map((item) => item.trim()).filter(Boolean);
  }

  const dir = args.dir || '.';
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`이미지 디렉터리를 찾을 수 없습니다: ${dir}`);
  }
  const files = fs.readdirSync(dir)
    .filter((name) => /^page[_-]\d+[.](png|jpg|jpeg)$/i.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => imageNumber(a) - imageNumber(b));
  return files;
}

function assertReadableImages(images) {
  if (!images.length) {
    throw new Error('page 이미지가 없습니다. --images를 제공하거나 page_<n>.png 파일이 있는 --dir을 지정하세요.');
  }
  for (const image of images) {
    if (!fs.existsSync(image)) {
      throw new Error(`이미지를 찾을 수 없습니다: ${image}`);
    }
    const stat = fs.statSync(image);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`이미지가 비어 있거나 파일이 아닙니다: ${image}`);
    }
  }
}

async function loadPptxGenJS() {
  const attempts = [
    {
      label: '현재 workspace',
      require: () => createRequire(path.join(process.cwd(), 'package.json'))('pptxgenjs'),
    },
    {
      label: 'Merry-slide vendor',
      require: () => createRequire(path.join(SKILL_DIR, 'vendor', 'package.json'))('pptxgenjs'),
    },
    {
      label: 'Merry-slide skill package',
      require: () => createRequire(path.join(SKILL_DIR, 'package.json'))('pptxgenjs'),
    },
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      return attempt.require();
    } catch (error) {
      errors.push(`${attempt.label}: ${error.code || error.message}`);
    }
  }

  const setup = path.join(SKILL_DIR, 'scripts', 'setup-deps.sh');
  throw new Error([
    'pptxgenjs를 찾을 수 없습니다.',
    `먼저 실행: bash ${setup}`,
    '또는 현재 workspace에서 npm install pptxgenjs를 실행하세요.',
    `확인한 위치: ${errors.join(' / ')}`,
  ].join(' '));
}

async function main() {
  try {
    await fs.promises.access(SKILL_DIR);
  } catch {
    throw new Error(`Merry-slide skill directory를 찾을 수 없습니다: ${SKILL_DIR}`);
  }
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (args.layout !== 'wide') {
    throw new Error('현재는 --layout wide만 지원합니다.');
  }

  const images = resolveImages(args);
  assertReadableImages(images);

  const PptxGenJS = await loadPptxGenJS();
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Merry-slide';
  pptx.subject = args.title;
  pptx.title = args.title;
  pptx.company = 'Merry-slide';
  pptx.lang = 'ko-KR';

  for (const image of images) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addImage({
      path: image,
      x: 0,
      y: 0,
      w: WIDE.width,
      h: WIDE.height,
    });
  }

  const outPath = path.resolve(args.out);
  await pptx.writeFile({ fileName: outPath });
  console.log(JSON.stringify({
    output: outPath,
    slides: images.length,
    images: images.map((image) => path.resolve(image)),
  }, null, 2));
}

main().catch((error) => {
  const script = path.basename(fileURLToPath(import.meta.url));
  console.error(`${script}: ${error.message}`);
  process.exit(1);
});
