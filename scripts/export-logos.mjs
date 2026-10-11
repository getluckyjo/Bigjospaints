// Derives the single-colour logo variants from the master logo.
// Master: public/logos/big-jos-paints-primary.svg (Clay wordmark, Ink "PAINTS"), built from the Big Jo's
// master logo with the descriptor redrawn as "PAINTS" in DM Sans Bold. Run after changing it: npm run logos
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public/logos');
const master = fs.readFileSync(path.join(dir, 'big-jos-paints-primary.svg'), 'utf8');
const colours = { clay: '#A3442F', ink: '#292C27', bone: '#F4F0E7' };
const variants = {
  bone: { wordmark: colours.bone, descriptor: colours.bone },
  ink: { wordmark: colours.ink, descriptor: colours.ink },
};
for (const [name, fills] of Object.entries(variants)) {
  let svg = master;
  for (const [id, fill] of Object.entries(fills)) {
    svg = svg.replace(new RegExp(`(<g id="${id}" fill=")#[0-9A-Fa-f]{6}"`), `$1${fill}"`);
  }
  fs.writeFileSync(path.join(dir, `big-jos-paints-${name}.svg`), svg);
}
console.log(`Wrote ${Object.keys(variants).length} logo variants to public/logos/`);
