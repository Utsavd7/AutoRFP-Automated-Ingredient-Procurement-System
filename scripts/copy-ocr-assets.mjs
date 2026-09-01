import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(projectRoot, 'public', 'ocr');

await mkdir(join(destination, 'core'), { recursive: true });
await mkdir(join(destination, 'lang'), { recursive: true });

await cp(
  join(projectRoot, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  join(destination, 'worker.min.js'),
);
await cp(
  join(projectRoot, 'node_modules', 'tesseract.js', 'LICENSE.md'),
  join(destination, 'LICENSE-tesseract-js.txt'),
);
await cp(
  join(projectRoot, 'node_modules', 'tesseract.js-core', 'LICENSE'),
  join(destination, 'LICENSE-tesseract-core.txt'),
);

for (const file of [
  'tesseract-core.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]) {
  await cp(
    join(projectRoot, 'node_modules', 'tesseract.js-core', file),
    join(destination, 'core', file),
  );
}

await cp(
  join(
    projectRoot,
    'node_modules',
    '@tesseract.js-data',
    'eng',
    '4.0.0_best_int',
    'eng.traineddata.gz',
  ),
  join(destination, 'lang', 'eng.traineddata.gz'),
);
