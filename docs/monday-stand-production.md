# Hauteur et allée du stand dans Monday

- **Hauteur plafond** : colonne Nombre, en mètres. Si la cellule est vide, le configurateur utilise **5,25 m**. Sur le tableau pilote Signature / SITL 2027 (`18410370871`), la préparation explicite du tableau via `monday-sync` (`prepareBoardId`) crée la colonne si nécessaire. On peut aussi l'ajouter directement dans le tableau.
- **ELINGUE** (`color_mm91v4f9` sur le pilote) : **4,25 m** et **5,25 m** sont des limites supplémentaires. **AUTRE** utilise la hauteur du plafond renseignée. **ATT** et **PAS BESOIN** n'imposent pas de limite supplémentaire. Le haut de l'enseigne, hors câbles du modèle, ne dépasse pas la plus basse des limites ; l'enseigne n'est pas remontée si elle est déjà plus basse.
- **ALLEE PLAN** (`color_mm91rwqj` sur le pilote) : **HAUT**, **BAS**, **GAUCHE** ou **DROITE** positionnent la mention de la colonne **ALLÉE** sur le BAT. Si la cellule est vide ou sur **ATT**, le BAT conserve sa mention générique. Le plan lui-même n'est pas tourné.

Les colonnes **Hauteur plafond**, **ELINGUE** et **ALLEE PLAN** sont reprises à chaque synchronisation Monday, y compris pour les scènes existantes, en brouillon ou déjà validées. Après avoir changé une cellule, lancer la synchronisation Monday dans l'admin, puis recharger la scène ou rouvrir son BAT. Ce n'est pas une mise à jour en direct des onglets déjà ouverts.

Les objets, leurs positions X/Z, les visuels et le statut de validation sont conservés. Seule la hauteur d'affichage des enseignes est recalculée pour respecter la limite ; une enseigne déjà plus basse n'est pas remontée. Une colonne absente ne supprime pas sa valeur enregistrée. Une cellule de hauteur vide revient au plafond par défaut de **5,25 m** ; **ATT**, **AUTRE** et **PAS BESOIN** enlèvent uniquement la limite supplémentaire des élingues. Pour **ALLEE PLAN**, une cellule vide ou **ATT** rétablit la mention générique.

Un changement effectif des hauteurs incrémente la révision de configuration : un ancien onglet en cours de modification doit être rechargé avant de pouvoir enregistrer, pour éviter une validation avec une hauteur périmée. Une simple correction de l'allée ne bloque pas les modifications.

Déploiement : appliquer la migration `monday_production_settings_after_creation` après les migrations existantes, puis publier `monday-sync`. La lecture par titre permet de réutiliser les colonnes sur les autres tableaux sans reprendre les identifiants du pilote.
