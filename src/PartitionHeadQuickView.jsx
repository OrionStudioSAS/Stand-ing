import React, { useId, useState } from 'react';
import { Check, FileImage, Info, X } from 'lucide-react';
import { headArtwork, headArtworkIsCustom, headArtworkStatus } from './partitionHeadPresentation.js';
import { normalizeImageFraming } from './imageFraming.js';
import './partitionHeadQuickView.css';

export default function PartitionHeadQuickView({ rows, signature, equipped, companyName, visualContext = {}, differentVisuals, disabled, uploading, error, onSide, onCompanyName, onDifferentVisuals, onArtwork, onReset, onPending, onTopEnabled, onMainMode, onFraming, onApply, renderFraming, accept, t, total = 0, logoCharged = false }) {
  const [activeSide, setActiveSide] = useState('left');
  const [intents, setIntents] = useState({});
  const id = useId();
  const selected = rows.filter(row => row.selected);
  const separate = selected.length === 2 && differentVisuals;
  const row = (separate ? selected.find(row => row.side === activeSide) : null) || selected[0];
  const currentSide = row?.side || 'left';
  const busy = disabled || Boolean(uploading);
  const custom = (row, part) => headArtworkIsCustom(headArtwork(row.visual, part === 'top' ? row.topSlot?.id : ''), intents[row.side]?.[part]);
  const setIntent = (part, value) => setIntents(current => {
    const next = { ...current };
    for (const target of separate ? [currentSide] : selected.map(row => row.side)) next[target] = { ...next[target], [part]: value };
    return next;
  });
  const choose = (part, value) => {
    if (busy || !row) return;
    setIntent(part, value);
    if (part === 'top') onTopEnabled(row, value);
    else {
      if (!value) onReset(row);
      onMainMode?.(row, value);
    }
  };
  const complete = (row) => {
    const parts = signature ? ['top', 'main'] : ['main'];
    return parts.every(part => ['ready', 'standard'].includes(headArtworkStatus(headArtwork(row.visual, part === 'top' ? row.topSlot.id : ''), signature ? custom(row, part) : true)));
  };
  const needsArtwork = selected.some(target => (signature ? ['top', 'main'] : ['main']).some(part =>
    headArtworkStatus(headArtwork(target.visual, part === 'top' ? target.topSlot.id : ''), signature ? custom(target, part) : true) === 'missing'));
  const mode = (value) => { setIntents({}); onDifferentVisuals?.(value); };
  const company = <label className="head-company-input"><span className="sr-only">{t('partition_head_company_field')}</span><input value={companyName || ''} disabled={disabled} onChange={event => onCompanyName?.(event.target.value)} placeholder={t('partition_head_company_placeholder')} /><small>{t('head_character_count', { count: (companyName || '').length })}</small></label>;
  const upload = (part) => {
    const slot = part === 'top' ? row.topSlot : null;
    const art = headArtwork(row.visual, slot?.id);
    return <HeadArtworkUpload key={`${currentSide}-${part}`} artwork={art} format={part === 'top' ? row.topFormat : row.mainFormat} label={t(part === 'top' ? 'head_top' : signature ? 'head_lower' : 'head_upper_visual')} accept={accept} disabled={disabled} uploading={Boolean(uploading)} t={t}
      onImage={file => onArtwork(row, file, slot)} onReset={() => onReset(row, slot)} onPending={value => onPending(row, value, slot)}
      renderFraming={art.url ? () => renderFraming(art, framing => onFraming(row, framing, slot), busy) : null} />;
  };

  return <div className={`partition-head-panel head-quickview${signature ? ' signature-head-options' : ''}`}>
    {!signature && <div className="partition-head-choice-grid head-side-choices" role="group" aria-label={t('head_stand_heads')}>{rows.map(row => <button type="button" key={row.side} className={row.selected ? 'partition-head-side-card active' : 'partition-head-side-card'} disabled={busy || !row.type} aria-pressed={row.selected} onClick={() => onSide?.(row.side, !row.selected)}><span className="head-choice-dot" /><span><strong>{row.label}</strong><small>{!row.type ? t('partition_not_configured') : row.price ? `+ ${row.price.toLocaleString('fr-FR')} € HT` : t('reserve_included')}</small></span></button>)}</div>}
    {selected.length > 0 ? <>
      <div className="head-front-preview">
        <div className={`head-preview-heads${separate ? ' separate' : ''}`}>{(separate ? selected : selected.slice(0, 1)).map(target => <button type="button" key={target.side} className={target.side === currentSide ? 'head-front-head active' : 'head-front-head'} disabled={!separate} aria-label={t('head_preview_side', { side: target.label })} onClick={() => setActiveSide(target.side)}>
          <span className="head-front-top">{signature && !custom(target, 'top') ? <span className="head-preview-name-lines"><i /><i /></span> : <HeadPreviewImage artwork={headArtwork(target.visual, signature ? target.topSlot.id : '')} custom={!signature || custom(target, 'top')} />}</span>
          <span className={signature ? 'head-front-body' : 'head-front-body head-front-information'}>{signature ? <HeadPreviewImage artwork={headArtwork(target.visual)} custom={custom(target, 'main')} /> : <><strong>{companyName || visualContext.company}</strong><span>{[visualContext.aisleNumber, visualContext.standNumber].filter(Boolean).join(' · ')}</span>{equipped && /^[a-z]{2}$/i.test(visualContext.country || '') && <img className="head-country-flag" src={`/flags/${visualContext.country.toLowerCase()}.svg`} alt={t('head_country_flag', { country: visualContext.country })} />}</>}</span>
          <small>{separate ? target.label : t(selected.length === 2 ? 'head_both_preview' : target.side === 'left' ? 'head_left_title' : 'head_right_title')}</small>
        </button>)}</div>
        {row && <div className="head-preview-callouts"><div><strong>{t('head_top')}</strong><b>{signature ? row.topFormat : row.mainFormat}</b><small>{t(signature ? custom(row, 'top') ? 'head_your_logo' : 'head_name_location' : 'head_your_visual')}</small></div><div><strong>{t(signature ? 'head_lower' : 'head_information')}</strong>{signature ? <><b>{row.mainFormat}</b><small>{t(headArtwork(row.visual).pending ? 'head_art_pending' : custom(row, 'main') ? 'head_your_visual' : 'head_standard_art')}</small></> : <small>{t(equipped ? 'head_equipped_information' : 'head_smcl_information')}</small>}</div></div>}
        <span className="head-front-view-label">{t('head_front_view')}</span>
      </div>
      {selected.length === 2 && <div className="head-configuration-mode"><strong>{t('head_on_both')}</strong><div role="group" aria-label={t('head_configuration_mode')}><button type="button" aria-pressed={!differentVisuals} disabled={busy} onClick={() => mode(false)}>{t('head_same_configuration')}</button><button type="button" aria-pressed={differentVisuals} disabled={busy} onClick={() => mode(true)}>{t('head_different_configuration')}</button></div></div>}
      {separate && <div className="head-side-tabs" role="tablist" aria-label={t('head_edit_side')}>{selected.map(target => <button key={target.side} type="button" role="tab" id={`${id}-${target.side}`} aria-controls={`${id}-panel`} aria-selected={currentSide === target.side} tabIndex={currentSide === target.side ? 0 : -1} onClick={() => setActiveSide(target.side)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'left' : event.key === 'End' ? 'right' : currentSide === 'left' ? 'right' : 'left'; setActiveSide(next); document.getElementById(`${id}-${next}`)?.focus(); } }}>{t(target.side === 'left' ? 'head_left_title' : 'head_right_title')}{complete(target) ? <Check size={13} /> : <small>{t('head_incomplete')}</small>}</button>)}</div>}
      <div className="head-current-configuration" id={`${id}-panel`} role={separate ? 'tabpanel' : undefined} aria-labelledby={separate ? `${id}-${currentSide}` : undefined}>
        {signature ? <>
          <HeadSectionTitle title={t('head_top')} format={row.topFormat} />
          <div className="head-art-choices" data-part="top" role="group" aria-label={t('head_top')}><HeadChoice selected={!custom(row, 'top')} disabled={busy} title={t('head_name_location')} detail={t('head_generated')} badge={t('reserve_included')} included onClick={() => choose('top', false)} /><HeadChoice selected={custom(row, 'top')} disabled={busy} title={t('head_your_logo')} detail={t('head_logo_flat_rate')} badge="+ 97 € HT" onClick={() => choose('top', true)} /></div>
          {custom(row, 'top') ? upload('top') : <div className="head-company-section">{company}<small>{t('head_auto_location_hint')}</small></div>}
          <HeadSectionTitle title={t('head_lower')} format={row.mainFormat} />
          <div className="head-art-choices" role="group" aria-label={t('head_lower')}><HeadChoice selected={!custom(row, 'main')} disabled={busy} title={t('head_standard_art')} detail={t('head_provided_by')} badge={t('reserve_included')} included onClick={() => choose('main', false)} /><HeadChoice selected={custom(row, 'main')} disabled={busy} title={t('head_your_visual')} detail={t('head_backlit')} badge={t('reserve_included')} included onClick={() => choose('main', true)} /></div>
          {custom(row, 'main') && upload('main')}
        </> : <>
          <HeadSectionTitle title={t('head_upper_visual')} format={row.mainFormat} />{upload('main')}
          <HeadSectionTitle title={t('head_name_location')} />{company}
          <div className="head-automatic-information"><Info size={14} /><span>{t(equipped ? 'head_equipped_information' : 'head_smcl_information')}{[visualContext.hall ? `${t('head_hall')} ${visualContext.hall}` : '', visualContext.aisleNumber, visualContext.standNumber].filter(Boolean).length > 0 && <strong>{[visualContext.hall ? `${t('head_hall')} ${visualContext.hall}` : '', visualContext.aisleNumber, visualContext.standNumber].filter(Boolean).join(' · ')}</strong>}</span>{equipped && /^[a-z]{2}$/i.test(visualContext.country || '') && <img className="head-country-flag" src={`/flags/${visualContext.country.toLowerCase()}.svg`} alt={t('head_country_flag', { country: visualContext.country })} />}</div>
        </>}
      </div>
    </> : <div className="partition-head-empty">{t('partition_select_visual')}</div>}
    {error && <p className="partition-head-upload-error" role="alert">{error}</p>}
    {!signature && <button type="button" className="partition-head-remove-button" disabled={busy || !selected.length} onClick={() => { onSide?.('left', false); onSide?.('right', false); }}><X size={14} />{t('partition_remove')}</button>}
    <footer className="head-options-footer"><div><span>{t('head_supplements')}<small>{t(logoCharged ? 'head_logo_summary' : total ? 'head_selected_options' : needsArtwork ? 'head_configuration_incomplete' : 'head_included_configuration')}</small></span><strong>{total > 0 ? '+ ' : ''}{total.toLocaleString('fr-FR')} €</strong></div><button type="button" onClick={onApply}>{t('head_apply')}</button></footer>
  </div>;
}

function HeadSectionTitle({ title, format }) { return <div className="head-section-title"><strong>{title}</strong>{format && <span>{format}</span>}</div>; }

function HeadChoice({ selected, disabled, title, detail, badge, included, onClick }) {
  return <button type="button" className={selected ? 'head-art-choice active' : 'head-art-choice'} disabled={disabled} aria-pressed={selected} onClick={onClick}><span className="head-choice-heading"><i className="head-choice-dot" /><strong>{title}</strong></span><small>{detail}</small><span className={included ? 'head-choice-badge included' : 'head-choice-badge'}>{badge}</span></button>;
}

function HeadPreviewImage({ artwork, custom }) {
  const framing = normalizeImageFraming(artwork.framing);
  return custom ? artwork.url ? <img src={artwork.url} alt="" style={{ transform: `translate(${framing.imageOffsetX}%, ${framing.imageOffsetY}%) scale(${framing.imageZoom})` }} /> : <span className="head-preview-missing" /> : <span className="head-preview-standard" />;
}

function HeadArtworkUpload({ artwork, format, label, accept, disabled, uploading, t, onImage, onReset, onPending, renderFraming }) {
  const blocked = disabled || uploading;
  const canImport = !blocked && (!artwork.pending || artwork.url);
  const onFile = (file) => { if (file && canImport) onImage?.(file); };
  return <div className="partition-head-upload-block head-artwork-upload" aria-label={label}>
    {artwork.url ? <div className="head-uploaded-file"><span className="head-uploaded-thumb"><img src={artwork.url} alt="" /></span><span><strong title={artwork.name}>{artwork.name || t('head_imported_art')}</strong><small><Check size={12} />{t('head_imported_art')}</small></span><label className={blocked ? 'head-file-action disabled' : 'head-file-action'}>{uploading ? t('partition_uploading') : t('head_replace')}<input type="file" accept={accept} disabled={blocked} onChange={event => { onFile(event.target.files?.[0]); event.target.value = ''; }} /></label></div>
      : <label className={canImport ? 'head-art-dropzone' : 'head-art-dropzone disabled'} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onFile(event.dataTransfer.files?.[0]); }}><FileImage size={21} /><span><strong>{uploading ? t('partition_uploading') : t('head_drop_visual')}</strong><small>{format ? `${format} · ` : ''}PNG, JPG, SVG, PDF</small></span><b>{t('partition_import')}</b><input type="file" accept={accept} disabled={!canImport} onChange={event => { onFile(event.target.files?.[0]); event.target.value = ''; }} /></label>}
    {artwork.url && renderFraming?.()}
    <label className="head-pending-checkbox"><input type="checkbox" checked={artwork.pending} disabled={blocked} onChange={event => onPending?.(event.target.checked)} /><span>{t('visual_pending_label')}</span></label>
    {artwork.pending && <p className="head-pending-hint"><Info size={12} />{t('head_pending_hint')}</p>}
    {artwork.url && <button className="item-image-reset" type="button" disabled={blocked} onClick={onReset}><X size={12} />{t('img_upload_reset')}</button>}
  </div>;
}
