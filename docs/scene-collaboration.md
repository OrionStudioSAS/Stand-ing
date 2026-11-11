# Collaborateurs des scènes

Le contact principal accède aux invitations depuis l'icône **Inviter un collaborateur** dans l'en-tête ou depuis **Renseignements client**. Une invitation est liée à une scène et à une adresse normalisée. Une scène a deux emplacements au maximum, invitations en attente comprises. Les invitations en attente expirent après sept jours et peuvent être retirées pour libérer un emplacement.

Le lien d'invitation et le code sont deux éléments distincts : le code est envoyé uniquement à l'adresse invitée. Après vérification, le membre peut modifier le brouillon, importer ses visuels et soumettre la configuration. La confirmation est envoyée à l'adresse de contact de la scène. Seul le contact principal gère les accès. Les restrictions sont appliquées côté serveur et la révocation bloque aussi les sessions existantes.

Les sauvegardes de configuration utilisent une révision et une transaction pour les options et les objets. En cas de modification concurrente, le deuxième onglet doit recharger la scène avant de pouvoir sauvegarder.

## Déploiement

1. Déployer `scene-collaborators`, `scene-access-request`, `scene-access-verify`, `scene-completion-email`, `scene-contact-sync`, `scene-config-sync` et `scene-question-email` ensemble. Les invitations réutilisent `RESEND_API_KEY`, `RESEND_FROM_EMAIL` et `PUBLIC_APP_URL` de l'environnement ; le code utilise le modèle OTP Supabase existant.
2. Redéployer la passerelle SFTP si les imports HD sont activés.
3. Appliquer la migration `20261111182446_scene_collaborators.sql`. Le configurateur reste compatible avec la base existante : le bouton d'invitation n'apparaît qu'après la migration et au rechargement de la scène.
4. Sur une scène de test, inviter une adresse de test, confirmer par code, modifier un objet et soumettre la configuration en tant qu'invité. Vérifier la confirmation puis retirer l'accès.

Vérifications locales : `node --test tests/scene-collaborators-edge.test.mjs`, `node tests/scene-collaboration.browser.mjs` et `psql -v ON_ERROR_STOP=1 -f tests/scene-collaboration.sql` sur une base de test avec les migrations appliquées.
