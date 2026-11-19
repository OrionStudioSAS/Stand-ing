# Historique des scenes exposant

La liste des exposants affiche la derniere modification humaine (date, heure et
auteur) et place leurs scenes les plus recemment modifiees en premier. Les noms
de stand ne servent jamais d'identifiant : chaque bouton Historique filtre sur
l'identifiant exact de la scene.

Les synchronisations automatiques sont exclues de la derniere activite pour ne
pas faire passer une ancienne scene pour la derniere utilisee. Le journal
detaille conserve tous les evenements existants. Les actions anterieures a
l'activation de l'audit ne sont pas reconstituees.

Deploiement : appliquer la migration admin_scene_latest_activity, publier la
fonction admin-users puis le frontend. La fonction SQL est reservee au backend ;
le point d'entree exige un compte administrateur actif.

Verification : tests/admin-scene-latest-activity.integration.sql sur une base de
test (transaction annulee), tests/admin-user-credentials.test.mjs et
tests/counter-exhibitor-refinements.browser.mjs.
