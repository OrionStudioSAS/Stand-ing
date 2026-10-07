# Mini configurateur de reserve

## Preparation dans Assets 3D

1. Conserver les groupes de reserve et les regles de surface du pack existants.
2. Composer chaque reserve avec des portes et cloisons separees de 1 m. Les
   equipements presents dans ce groupe definissent sa dotation incluse.
3. Dans la fiche de chaque objet ou groupe de variantes a proposer, renseigner
   "Disponible dans la reserve comme" : porte, cloison ou equipement interieur.
4. Activer "Reserve au mini configurateur" pour masquer cet objet dans la
   boutique normale. Ce reglage est active par defaut lorsqu'un role est ajoute.
   Renseigner ses prix et references sur les packs concernes, puis enregistrer.
5. Dans le groupe de reserve, verifier la largeur/profondeur interieure. Elles
   sont deduites des cloisons, pas de l'encombrement importe du groupe. Il est
   possible de desactiver la personnalisation ou de limiter les objets proposes.

Les objets originaux du groupe restent disponibles, meme si la liste est limitee.
Les nouveaux objets doivent etre actifs et disponibles sur le pack de la scene.
Une reserve monobloc, sans porte, ou faite de modules de 50 cm doit etre preparee
avant de pouvoir utiliser cet editeur a pas de 1 m.

## Utilisation par un exposant

- Etape 2 > Reserve > "Personnaliser ma reserve", ou bouton crayon de la reserve.
- La structure reste de la meme taille et au meme emplacement dans le stand.
- Choisir une porte/cloison sur le plan, changer son modele ou inverser son sens.
  Glisser une porte sur une cloison echange leurs emplacements par modules de 1 m.
- Les murs fournis par le stand sont grises et ne sont pas modifiables.
- Ajouter, retirer, tourner et deplacer les equipements a l'interieur. Le champ
  hauteur permet notamment de placer une machine a cafe sur une etagere.
- Chaque module doit rester rempli et il faut conserver au moins une porte.
  Les chevauchements entre equipements et le passage de la porte sont controles.
- Annuler, la croix ou Echap abandonne le brouillon. Enregistrer attend la
  sauvegarde de la composition et du prix avant de fermer le mini configurateur.
  Une scene verrouillee pour l'exposant n'est pas modifiable.

## Prix et documents

La reserve de base conserve son prix/regime d'inclusion actuel. Ses enfants
definissent les quantites incluses pour cette taille de reserve. Reajouter un
produit retire consomme d'abord sa quantite incluse ; les quantites au-dela sont
facturees au prix du pack. Une porte/cloison remplacee par un modele plus cher
facture uniquement la difference de prix, dans la limite de la dotation de ce
type de structure. Retirer un produit ou choisir un modele moins cher ne genere
pas de remboursement.

Les supplements apparaissent a l'etape 4 et sur le bon de commande. Le forfait
Signature et les regles d'assurance existantes s'appliquent aux produits
eligibles. Le BAT et le debit salon utilisent les vrais enfants personnalises,
pas la composition d'origine du groupe.

La composition est versionnee dans
`source_payload.options.reserveOptions.customizations[typeDeReserve]`.
Les prix, modeles, emplacements autorises et quantites incluses sont reconstruits
depuis les assets du pack, pas depuis des prix envoyes dans ce brouillon. Aucune
migration de base de donnees n'est necessaire.

Verification : `node --test tests/*.test.mjs` et `npm run build`.
