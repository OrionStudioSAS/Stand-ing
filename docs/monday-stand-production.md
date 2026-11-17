# Hauteur et allée du stand dans Monday

- **Hauteur plafond** : colonne Nombre, en mètres. Si la cellule est vide, le configurateur utilise **5,25 m**. Sur le tableau pilote Signature / SITL 2027 (`18410370871`), la préparation explicite du tableau via `monday-sync` (`prepareBoardId`) crée la colonne si nécessaire. On peut aussi l'ajouter directement dans le tableau.
- **ELINGUE** (`color_mm91v4f9` sur le pilote) : **4,25 m** et **5,25 m** sont des limites supplémentaires. **AUTRE** utilise la hauteur du plafond renseignée. **ATT** et **PAS BESOIN** n'imposent pas de limite supplémentaire. Le haut de l'enseigne, hors câbles du modèle, ne dépasse pas la plus basse des limites ; l'enseigne n'est pas remontée si elle est déjà plus basse.
- **ALLEE PLAN** (`color_mm91rwqj` sur le pilote) : **HAUT**, **BAS**, **GAUCHE** ou **DROITE** positionnent la mention de la colonne **ALLÉE** sur le BAT. Si la cellule est vide ou sur **ATT**, le BAT conserve sa mention générique. Le plan lui-même n'est pas tourné.

Les hauteurs sont synchronisées à la création et tant que la scène n'a pas de brouillon. Une nouvelle synchronisation peut corriger l'allée du BAT même après soumission, sans changer la hauteur de l'enseigne en cours de configuration. Sur les anciens brouillons sans hauteur enregistrée, le placement existant est conservé.

Déploiement : appliquer la migration de protection des hauteurs, puis publier `monday-sync` et le configurateur. La lecture par titre permet de réutiliser les colonnes sur les autres tableaux sans reprendre les identifiants du pilote.
