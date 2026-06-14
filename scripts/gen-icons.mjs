// Erzeugt aus public/icon-app.png das Windows-Icon build/icon.ico.
// electron-builder erkennt build/icon.ico automatisch und bettet es in die
// App und den Installer ein. Fehlt die Quelldatei, wird das Standard-Icon
// verwendet (kein Fehler) – so bleibt der Build ohne Bild lauffähig.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import png2icons from 'png2icons';

const SRC = 'public/icon-app.png';
const OUT = 'build/icon.ico';

if (!existsSync(SRC)) {
  console.log(`[icons] ${SRC} nicht gefunden – Standard-Icon wird verwendet.`);
  process.exit(0);
}

const ico = png2icons.createICO(readFileSync(SRC), png2icons.BICUBIC, 0, false);
if (!ico) {
  console.error('[icons] ICO konnte nicht erzeugt werden (ist die Quelle eine quadratische PNG?).');
  process.exit(1);
}
mkdirSync('build', { recursive: true });
writeFileSync(OUT, ico);
console.log(`[icons] ${OUT} erzeugt.`);
