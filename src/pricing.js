// Pricing for the sticker kit shown in the configurator.
// These are PLACEHOLDER numbers — set them to your real costs and margins.
import { UNIT_CM } from './helmet.js';

export const PRICING = {
  currency: 'GBP',
  locale: 'en-GB',
  designFee: 12, // one-off setup per design
  perPiece: 0.6, // weeding / handling per sticker piece
  perCm2: 0.018, // printed vinyl, per square cm
  minimum: 20, // minimum order value
  // Premium films cost more than standard gloss vinyl.
  finishMultiplier: { gloss: 1, satin: 1, matte: 1.1, metallic: 1.4, pearl: 1.5, chrome: 2.2, carbon: 1.6 },
  // Where "Request a quote" sends the enquiry. Leave blank to only download the files.
  orderEmail: '',
};

const fmt = new Intl.NumberFormat(PRICING.locale, { style: 'currency', currency: PRICING.currency });
export const money = (v) => fmt.format(v);

export function quote(layers, base) {
  const pieces = [];
  for (const l of layers) {
    if (!l.visible) continue;
    const area = l.width * UNIT_CM * l.height * UNIT_CM;
    const finish = l.finish === 'inherit' ? base.finish : l.finish;
    const copies = l.mirror ? 2 : 1;
    pieces.push({ area: area * copies, count: copies, mult: PRICING.finishMultiplier[finish] ?? 1 });
  }
  const count = pieces.reduce((s, p) => s + p.count, 0);
  const area = pieces.reduce((s, p) => s + p.area, 0);
  const vinyl = pieces.reduce((s, p) => s + p.area * PRICING.perCm2 * p.mult, 0);
  const lines = [];
  if (count) {
    lines.push({ label: 'Design & setup', amount: PRICING.designFee });
    lines.push({ label: `Printed vinyl · ${(area / 100).toFixed(1)} dm²`, amount: vinyl });
    lines.push({ label: `Cutting & weeding · ${count} piece${count === 1 ? '' : 's'}`, amount: count * PRICING.perPiece });
  }
  let total = lines.reduce((s, l) => s + l.amount, 0);
  if (count && total < PRICING.minimum) {
    lines.push({ label: 'Minimum order top-up', amount: PRICING.minimum - total });
    total = PRICING.minimum;
  }
  return { lines, total, count, area };
}
