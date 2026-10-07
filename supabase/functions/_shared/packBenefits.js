export const packAllowanceLineType = 'pack-accessories-allowance';
export const signatureAllowancePerSquareMeter = 40;

export function normalizePackBenefits(value = {}) {
  const amount = Number(value?.allowanceAmount || 0);
  return {
    mode: value?.mode === 'allowance' ? 'allowance' : 'included-items',
    allowanceAmount: Number.isFinite(amount) ? Math.round(Math.max(0, amount) * 100) / 100 : 0,
  };
}

export function scenePackBenefits(scene = {}) {
  return packBenefitsForScene(scene, scene.source_payload?.packBenefits || scene.source_payload?.pricing?.packBenefits || scene.salon_offers?.metadata?.packBenefits);
}

export function isSignaturePackScene(scene = {}) {
  const labels = [scene.offer, scene.offer_name, scene.pack, scene.pack_name, scene.salon_offers?.name,
    scene.source_payload?.offer, scene.source_payload?.offerName, scene.source_payload?.pack];
  return labels.some((label) => /(^|[^a-z])signature([^a-z]|$)/i.test(String(label || '')));
}

export function packBenefitsForScene(scene = {}, benefits = {}) {
  if (!isSignaturePackScene(scene)) return normalizePackBenefits(benefits);
  const width = Number(scene.dimensions?.width || scene.width_m);
  const depth = Number(scene.dimensions?.depth || scene.depth_m);
  const area = Number.isFinite(width) && Number.isFinite(depth) && width > 0 && depth > 0 ? width * depth : 0;
  return { mode: 'allowance', allowanceAmount: Math.round(area * signatureAllowancePerSquareMeter * 100) / 100 };
}

export function inheritCurrentPackBenefits(scene = {}) {
  const metadata = scene.salon_offers?.metadata;
  if (isSignaturePackScene(scene)) {
    const packBenefits = scenePackBenefits(scene);
    return {
      ...scene,
      source_payload: {
        ...(scene.source_payload || {}),
        packBenefits,
        baseItems: [],
        ...(scene.source_payload?.pricing ? { pricing: { ...scene.source_payload.pricing, packBenefits } } : {}),
      },
    };
  }
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
  const eligibleTotal = accessories.reduce((sum, line) => sum + Math.max(0, Number(line.total || 0)), 0);
  const { allowanceLine } = packAllowanceBreakdown(eligibleTotal, benefits);
  return allowanceLine ? [...accessories, allowanceLine] : accessories;
}
