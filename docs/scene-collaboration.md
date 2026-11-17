# Collaborateurs des scènes

Le contact principal et les administrateurs actifs gèrent les invitations depuis l'icône **Inviter un collaborateur** dans l'en-tête, même sur une scène validée. Une invitation est liée à une scène et à une adresse normalisée. Une scène a deux emplacements au maximum, invitations en attente comprises. Les invitations en attente expirent après sept jours et peuvent être retirées pour libérer un emplacement.

L'e-mail contient un bouton **Ouvrir la scène** et le même lien en clair. Ce lien personnel à usage unique connecte le membre sans code. Sa durée de connexion est celle des liens Supabase ; en cas d'expiration, l'écran permet de renvoyer un lien à l'adresse invitée tant que l'invitation est valide. Les anciennes invitations avec code restent compatibles. Le membre peut modifier le brouillon, importer ses visuels et soumettre la configuration comme le contact principal. La confirmation est envoyée à l'adresse de contact de la scène. Une fois soumis, le stand reste consultable mais aucun exposant ne peut le modifier ni y importer de visuel, sauf si un administrateur le repasse en brouillon. La révocation bloque aussi les sessions existantes.

Les sauvegardes de configuration utilisent une révision et une transaction pour les options et les objets. En cas de modification concurrente, le deuxième onglet doit recharger la scène avant de pouvoir sauvegarder.

## Déploiement

1. Déployer le configurateur qui sait ouvrir les liens personnels et lire une scène verrouillée via `read_locked_configurator_scene`. La passerelle HD existante peut rester en place : son accès direct ne voit plus les scènes verrouillées pour un exposant, tandis que la consultation passe par cette fonction en lecture seule.
2. Déployer `scene-access-request`, `scene-access-verify`, `scene-completion-email`, `scene-contact-sync`, `scene-config-sync`, `scene-question-email`, puis `scene-collaborators` pour commencer à envoyer les nouveaux liens. Les invitations réutilisent `RESEND_API_KEY`, `RESEND_FROM_EMAIL` et `PUBLIC_APP_URL` de l'environnement ; le contact principal conserve le modèle OTP Supabase existant.
3. Appliquer la migration `20261111230928_scene_collaborators.sql`. Le configurateur reste compatible avec la base existante : le bouton d'invitation n'apparaît qu'après la migration et au rechargement de la scène.
4. Sur une scène de test, inviter une adresse de test, ouvrir la scène depuis le bouton sans saisir de code, modifier un objet et soumettre la configuration. Vérifier la confirmation puis retirer l'accès.

Vérifications locales : `node --test tests/scene-collaborators-edge.test.mjs`, `node tests/scene-collaboration.browser.mjs` et `psql -v ON_ERROR_STOP=1 -f tests/scene-collaboration.sql` sur une base de test avec les migrations appliquées.
