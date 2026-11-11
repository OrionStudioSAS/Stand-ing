import assert from 'node:assert/strict';
import test from 'node:test';
import { t, uiText, translations } from '../src/i18n.js';
import { englishUi, translateCatalogLabel } from '../src/uiTranslations.js';

test('every added French UI phrase has an English equivalent without changing French',()=>{
  for(const [fr,en] of Object.entries(englishUi)){assert.equal(uiText('fr',fr),fr);assert.equal(uiText('en',fr),en);}
  for(const key of Object.keys(translations.fr))assert.ok(Object.hasOwn(translations.en,key),`Missing English key: ${key}`);
});

test('new catalogue objects, options, colours and dynamic counters are localized at display time only',()=>{
  assert.equal(translateCatalogLabel('Machine à café (300 dosettes)'),'Coffee machine (300 pods)');
  assert.equal(translateCatalogLabel('Bloc 3 Étagères'),'3-shelf unit');
  assert.equal(translateCatalogLabel('Fauteuil José'),'Armchair José','Catalogue brand names keep their accents');
  assert.equal(translateCatalogLabel('Cache Compteur Blanc 500x500x750ht'),'Meter cover white 500x500x750ht');
  assert.equal(uiText('en','Enseigne Haute 2m + Kit Tournette'),'Overhead sign 2m + rotating kit');
  assert.equal(uiText('en','3 couleurs incluses'),'3 included colours');
  assert.equal(uiText('en','6 couleurs en option'),'6 optional colours');
  assert.equal(uiText('en','3 ml inclus dans votre formule'),'3 linear metres included in your package');
  assert.equal(uiText('en','€ HT'),'€ excl. VAT');
  assert.equal(uiText('en','Stand-ING'),'Stand-ING');
  assert.equal(uiText('en',null),null);
  assert.equal(t('en','client_company'),'Company');
});
