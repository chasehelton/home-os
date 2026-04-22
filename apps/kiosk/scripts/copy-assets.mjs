// Post-tsc asset pipeline for the kiosk build:
//   1. copy the static crash screen into dist/
//   2. vendor qrcode-generator's UMD bundle into dist/vendor/ so the
//      crash screen can render a QR offline (no network needed after a
//      boot failure).
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const vendor = path.join(dist, 'vendor');

await mkdir(vendor, { recursive: true });
await copyFile(path.join(root, 'src', 'crash.html'), path.join(dist, 'crash.html'));

const qr = path.join(root, 'node_modules', 'qrcode-generator', 'qrcode.js');
await copyFile(qr, path.join(vendor, 'qrcode-generator.js'));

console.log('[kiosk] copied crash.html and vendored qrcode-generator into dist/');
