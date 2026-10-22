import React from 'react';
import { Info } from 'lucide-react';
import './groundOptionsQuickView.css';

export default function GroundOptionsQuickView({ signature, carpet, footprint, carpetArea = 0, footprintArea = 0, thick = false, footprintEnabled = true, disabled = false, footprintDisabled = false, footprintDisabledReason = '', dirtyFootprint = false, onCarpet, onFootprint, onThick, onRestoreFootprint, t }) {
  const thickTotal = Math.round(30 * Math.max(0, Number(carpetArea) || 0)) + Math.round(30 * Math.max(0, Number(footprintArea) || 0));
  const thickOption = <button type="button" className={`config-toggle-option ground-thick-option${thick ? ' active' : ''}`} aria-pressed={thick} disabled={disabled} onClick={() => onThick?.(!thick)}>
    <i aria-hidden="true" /><span><span className="ground-thick-heading"><strong>{t('carpet_thick_label')}</strong><em>+ {money(thickTotal)} €</em></span><small>{t(signature ? 'ground_thick_detail' : 'ground_thick_smcl_detail')}</small></span>
  </button>;

  return <div className={`ground-options-quickview ${signature ? 'ground-signature' : 'ground-smcl'}`}>
    <GroundPalette title={t('ground_carpet')} group={carpet} disabled={disabled} onSelect={onCarpet} compactSingle={!signature} t={t} />
    {thickOption}
    {!signature && <>
      <GroundPalette title={t('ground_footprint')} detail={t('ground_footprint_detail')} group={footprint} disabled={disabled || footprintDisabled || !footprintEnabled} onSelect={onFootprint} t={t} />
      {(!footprintEnabled || footprintDisabledReason) && <div className="ground-footprint-unavailable"><p>{footprintDisabledReason || t('footprint_disabled')}</p>{!footprintEnabled && !footprintDisabled && <button type="button" disabled={disabled} onClick={onRestoreFootprint}>{t('footprint_restore')}</button>}</div>}
      {footprintEnabled && dirtyFootprint && <div className="ground-light-warning" role="note"><Info size={14} /><span>{t('ground_light_warning')}</span></div>}
    </>}
  </div>;
}

function GroundPalette({ title, detail, group = {}, compactSingle = false, disabled, onSelect, t }) {
  const { selected = {}, includedColors = [], optionalColors = [], optionTotal = 0, fromPrice = false } = group;
  const single = compactSingle && includedColors.length === 1 && !optionalColors.length;
  const label = (color) => `${color.name || ''}${color.code ? ` (${color.code})` : ''}`;
  const selectedId = String(selected.id ?? '');
  const swatches = (colors, included) => <div className="ground-color-swatches" role="group" aria-label={t(included ? 'ground_included_palette' : 'ground_optional_palette', { title })}>{colors.map(color => <button type="button" key={color.id} className={String(color.id) === selectedId ? 'active' : ''}
    style={{ '--ground-swatch': color.hex || '#d1d4db' }} disabled={disabled} aria-label={label(color)} aria-pressed={String(color.id) === selectedId}
    title={`${label(color)} · ${included ? t('color_included') : `+ ${money(Number(color.price || 0) * Number(group.area || 0))} €`}`}
    onClick={() => onSelect?.(color.id)} />)}</div>;

  return <section className="ground-palette" aria-label={title}>
    <div className="ground-palette-heading"><strong>{title}</strong><span>{label(selected)}</span></div>
    {detail && <p className="ground-palette-detail">{detail}</p>}
    {single ? <div className="ground-single-color"><button type="button" disabled={disabled} style={{ '--ground-swatch': includedColors[0].hex || '#d1d4db' }} aria-label={label(includedColors[0])} aria-pressed={String(includedColors[0].id) === selectedId} onClick={() => onSelect?.(includedColors[0].id)} /><strong>{includedColors[0].name}</strong><span className="ground-price-badge included">{t('color_included')}</span></div> : <>
      {includedColors.length > 0 && <div className="ground-palette-group"><div className="ground-palette-group-heading"><small>{t(includedColors.length === 1 ? 'ground_included_one' : 'ground_included_many', { count: includedColors.length })}</small><span className="ground-price-badge included">{t('color_included')}</span></div>{swatches(includedColors, true)}</div>}
      {optionalColors.length > 0 && <div className="ground-palette-group"><div className="ground-palette-group-heading"><small>{t(optionalColors.length === 1 ? 'ground_optional_one' : 'ground_optional_many', { count: optionalColors.length })}</small><span className="ground-price-badge">{fromPrice ? `${t('ground_from')} ` : ''}+ {money(optionTotal)} €</span></div>{swatches(optionalColors, false)}</div>}
      {!includedColors.length && !optionalColors.length && <p className="ground-palette-empty">{t('ground_no_colors')}</p>}
    </>}
  </section>;
}

function money(value) { return Math.round(Number(value) || 0).toLocaleString('fr-FR'); }
