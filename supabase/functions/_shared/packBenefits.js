export const packAllowanceLineType = 'pack-accessories-allowance';

export function normalizePackBenefits(value = {}) {
  const amount = Number(value?.allowanceAmount || 0);
  return {
    mode: value?.mode === 'allowance' ? 'allowance' : 'included-items',
    allowanceAmount: Number.isFinite(amount) ? Math.round(Math.max(0, amount) * 100) / 100 : 0,
  };
}

export function scenePackBenefits(scene = {}) {
  return normalizePackBenefits(scene.source_payload?.packBenefits || scene.source_payload?.pricing?.packBenefits || {});
}

export function inheritCurrentPackBenefits(scene = {}) {
  const metadata = scene.salon_offers?.metadata;
  if (scene.client_status === 'configured' || !metadata?.packBenefits) return scene;
  const packBenefits = normalizePackBenefits(metadata.packBenefits);
  return {
    ...scene,
    source_payload: {
      ...(scene.source_payload || {}),
      packBenefits,
      baseItems: packBenefits.mode === 'allowance' ? [] : metadata.baseItems || scene.source_payload?.baseItems || [],
    },
  };
}

export function packAllowanceBreakdown(eligibleTotal, benefits = {}) {
  const settings = normalizePackBenefits(benefits);
  const gross = Math.round(Math.max(0, Number(eligibleTotal) || 0) * 100) / 100;
  const allowanceAmount = settings.mode === 'allowance' ? settings.allowanceAmount : 0;
  const allowanceApplied = Math.min(gross, allowanceAmount);
  return {
    packBenefits: settings,
    allowanceAmount,
    allowanceApplied,
    allowanceRemaining: Math.round((allowanceAmount - allowanceApplied) * 100) / 100,
    accessoriesSupplement: Math.round((gross - allowanceApplied) * 100) / 100,
    allowanceLine: allowanceApplied > 0 ? {
      type: packAllowanceLineType,
      label: 'Forfait accessoires offert',
      quantity: 1,
      unitPrice: -allowanceApplied,
      total: -allowanceApplied,
      reference: 'FORFAIT-PACK',
      mandatory: true,
    } : null,
  };
}

export function withPackAllowance(lines = [], benefits = {}) {
  const accessories = lines.filter((line) => line?.type !== packAllowanceLineType);
  const eligibleTotal = accessories.reduce((sum, line) => sum + (line.type === 'mandatory-furniture-insurance' ? 0 : Math.max(0, Number(line.total || 0))), 0);
  const { allowanceLine } = packAllowanceBreakdown(eligibleTotal, benefits);
  return allowanceLine ? [...accessories, allowanceLine] : accessories;
}
