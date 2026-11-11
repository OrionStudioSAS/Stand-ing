# Collaborateurs des scènes

Le contact principal et les administrateurs actifs gèrent les invitations depuis l'icône **Inviter un collaborateur** dans l'en-tête ou depuis **Renseignements client**, même sur une scène validée. Une invitation est liée à une scène et à une adresse normalisée. Une scène a deux emplacements au maximum, invitations en attente comprises. Les invitations en attente expirent après sept jours et peuvent être retirées pour libérer un emplacement.

Le lien d'invitation et le code sont deux éléments distincts : le code est envoyé uniquement à l'adresse invitée. Après vérification, le membre peut modifier le brouillon, importer ses visuels et soumettre la configuration comme le contact principal. La confirmation est envoyée à l'adresse de contact de la scène. Une fois soumis, le stand reste consultable mais aucun exposant ne peut le modifier ni y importer de visuel, sauf si un administrateur le repasse en brouillon. La révocation bloque aussi les sessions existantes.

Les sauvegardes de configuration utilisent une révision et une transaction pour les options et les objets. En cas de modification concurrente, le deuxième onglet doit recharger la scène avant de pouvoir sauvegarder.

## Déploiement

1. Déployer `scene-collaborators`, `scene-access-request`, `scene-access-verify`, `scene-completion-email`, `scene-contact-sync`, `scene-config-sync` et `scene-question-email` ensemble. Les invitations réutilisent `RESEND_API_KEY`, `RESEND_FROM_EMAIL` et `PUBLIC_APP_URL` de l'environnement ; le code utilise le modèle OTP Supabase existant.
2. Redéployer la passerelle SFTP si les imports HD sont activés. Vérifier que la racine de la passerelle répond avec `sceneUploadLock: true` : le contrôle doit s'effectuer avant le dépôt sur le NAS, pas seulement après à l'enregistrement en base.
3. Appliquer la migration `20261111182446_scene_collaborators.sql`. Le configurateur reste compatible avec la base existante : le bouton d'invitation n'apparaît qu'après la migration et au rechargement de la scène.
4. Sur une scène de test, inviter une adresse de test, confirmer par code, modifier un objet et soumettre la configuration en tant qu'invité. Vérifier la confirmation puis retirer l'accès.

Vérifications locales : `node --test tests/scene-collaborators-edge.test.mjs`, `node tests/scene-collaboration.browser.mjs` et `psql -v ON_ERROR_STOP=1 -f tests/scene-collaboration.sql` sur une base de test avec les migrations appliquées.
