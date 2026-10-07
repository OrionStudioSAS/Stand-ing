import { packAllowanceBreakdown, packAllowanceLineType, withPackAllowance } from '../supabase/functions/_shared/packBenefits.js';

export const manualOrderCategories = [
  ['personalization', 'Sol et cloisons / Personnalisation'],
  ['furniture', 'Mobilier'],
  ['multimedia', 'Multim\u00e9dia'],
  ['signage', 'Signal\u00e9tique / Enseignes'],
  ['electricity', '\u00c9lectricit\u00e9'],
];

export function normalizeManualOrderCategory(value = '') {
  const key = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/personal|structure|sol|cloison|finition/.test(key)) return 'personalization';
  if (/multimedia/.test(key)) return 'multimedia';
  if (/signage|signal|enseigne/.test(key)) return 'signage';
  if (/electric/.test(key)) return 'electricity';
  if (/furniture|mobilier/.test(key)) return 'furniture';
  return '';
}

const money = (value) => Math.round(Number(value) * 100) / 100;

export function manualOrderRowsToPricingLines(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(Boolean).map((row, index) => ({
    type: `admin-manual-${row.id || index}`,
    label: String(row.label || '').trim(),
    reference: String(row.reference || '').trim(),
    category: normalizeManualOrderCategory(row.category) || 'furniture',
    assetType: String(row.assetType || ''),
    thumbnailUrl: String(row.thumbnailUrl || ''),
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    total: money(Number(row.quantity) * Number(row.unitPrice)),
  })).filter((line) => line.label && Number.isFinite(line.quantity) && line.quantity > 0
    && Number.isFinite(line.unitPrice) && line.unitPrice >= 0 && Number.isFinite(line.total));
}

export function replaceManualOrderPricingLines(lines = [], rows = []) {
  // Saved pricing may already contain these rows: the admin list is authoritative.
  return [...lines.filter((line) => !String(line.type || '').startsWith('admin-manual-')), ...manualOrderRowsToPricingLines(rows)];
}

export function mergeManualOrderPricing(pricing = {}, rows = [], benefits = {}) {
  const lines = withPackAllowance(replaceManualOrderPricingLines(pricing.lines || [], rows), benefits);
  const eligibleTotal = lines.reduce((sum, line) => sum + (line.type === packAllowanceLineType || line.type === 'mandatory-furniture-insurance' ? 0 : Number(line.total || 0)), 0);
  const allowance = packAllowanceBreakdown(eligibleTotal, benefits);
  const itemsTotal = money(lines.reduce((sum, line) => sum + Number(line.total || 0), 0));
  const basePrice = Number(pricing.basePrice || 0);
  return { ...pricing, ...allowance, lines, itemsTotal, total: money(basePrice + itemsTotal), grossTotal: money(basePrice + itemsTotal + allowance.allowanceApplied) };
}
