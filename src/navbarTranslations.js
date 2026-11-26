// English texts of the configurator top bar, its cart drawer and the guided tour, kept in their own
// file so this work stays independent from the other translation changes.
export const navbarEnglishUi = {
  'Aide par téléphone · conseiller disponible': 'Phone support · advisor available', 'Un conseiller vous guide': 'An advisor guides you',
  'Un doute sur une option ou un prix ? Appelez-nous, on regarde votre stand avec vous.': 'Unsure about an option or a price? Call us and we will look at your stand with you.',
  'Appel non surtaxé': 'Standard call rate', 'Lun – ven, 9 h – 18 h': 'Mon – Fri, 9 am – 6 pm', 'ouvert maintenant': 'open now', 'fermé': 'closed',
  'Copier': 'Copy', 'E-mail': 'Email', 'Modifier coordonnées, société, facturation': 'Edit contact details, company, billing',
  'Ajouter un collaborateur sur le stand': 'Add a collaborator to the stand', 'Il pourra voir et modifier ce stand': 'They will be able to view and edit this stand',
  'E-mail du collaborateur': 'Collaborator email', 'Inviter': 'Invite', 'Sur ce stand': 'On this stand', 'Exposant': 'Exhibitor', 'Vous': 'You',
  'Invitation envoyée': 'Invitation sent', 'En attente': 'Pending', 'Question ou remarque': 'Question or comment', 'Message envoyé': 'Message sent',
  'On vous répond par e-mail sous 24 h ouvrées.': 'We will reply by email within 24 business hours.', 'Écrire un autre message': 'Write another message',
  'Retour': 'Back', 'Rechercher : visuel, livraison, devis…': 'Search: artwork, delivery, quote…',
  'Posez-nous la question, on vous répond sous 24 h ouvrées.': 'Ask us and we will reply within 24 business hours.', 'Poser ma question': 'Ask my question',
  'Écrivez-nous': 'Write to us', 'Revoir la visite guidée': 'Replay the guided tour', '2 minutes pour prendre l’outil en main': '2 minutes to get to grips with the tool',
  'Voir la réponse': 'See the answer', 'Ex. : ajouter une deuxième réserve': 'E.g. add a second storage room', 'Votre message': 'Your message',
  'Décrivez votre besoin en quelques lignes': 'Describe what you need in a few lines', 'Envoyer': 'Send', 'Envoi…': 'Sending…',
  'Réponse par e-mail sous 24 h ouvrées': 'Reply by email within 24 business hours', 'HT': 'excl. VAT',
  'Entièrement utilisé. Le reste de vos options est facturé en supplément.': 'Fully used. Your other options are charged on top.',
  'Retirer un': 'Remove one', 'Ajouter un': 'Add one', 'Aucune option ajoutée': 'No option added',
  'Ajoutez des options depuis le panneau de configuration.': 'Add options from the configuration panel.', 'Options et accessoires': 'Options and accessories',
  'Forfait accessoires déduit': 'Accessory allowance deducted', 'TVA 20 % · Total TTC': 'VAT 20% · Total incl. VAT', 'Continuer vers la boutique': 'Continue to the shop',
  'Structures': 'Structures',
  'Aide par téléphone': 'Phone support', 'Langue': 'Language', 'Mon profil': 'My profile', 'Mes informations': 'My details',
  'Coordonnées, société et emplacement du stand': 'Contact details, company and stand location', 'Étapes de la commande': 'Order steps',
  'Numéro copié': 'Number copied', 'Copier le numéro': 'Copy number', 'Une question, une remarque ?': 'A question or a comment?',
  'Revoir la prise en main du configurateur': 'Go through the configurator walkthrough again', 'Rechercher une réponse': 'Search for an answer',
  'Rechercher dans les questions fréquentes': 'Search the frequently asked questions',
  'Aucune réponse trouvée : posez-nous la question ci-dessous.': 'No answer found: ask us below.',
  'Pas trouvé ? Écrivez-nous': 'Not found? Write to us',
  'Votre message part avec la référence de ce stand : pas besoin de tout réexpliquer.': 'Your message is sent with this stand’s reference, so there is no need to explain everything again.',
  'Toujours bloqué ?': 'Still stuck?', 'Voir le panier': 'View cart', 'Votre panier': 'Your cart', 'Modifier': 'Edit',
  'Continuer la configuration': 'Continue configuring', 'Envoi...': 'Sending...',
};

// Navbar sentences built at runtime (cart, invitations, FAQ search).
export function translateNavbarUi(text, translate) {
  let match;
  if ((match=text.match(/^Il vous reste (.+) HT d[’']accessoires inclus à utiliser\.$/))) return `You have ${match[1]} excl. VAT of included accessories left to use.`;
  if ((match=text.match(/^Invitation envoyée à (.+)$/))) return `Invitation sent to ${match[1]}`;
  if ((match=text.match(/^(.+) retiré du panier$/))) return `${translate(match[1])} removed from the cart`;
  if ((match=text.match(/^Votre formule (.+) reste incluse\.$/))) return `Your ${match[1]} package remains included.`;
  if ((match=text.match(/^Aucune réponse pour « (.*) »$/))) return `No answer for “${match[1]}”`;
  if ((match=text.match(/^Urgent \? Appelez le (.+)\.$/))) return `Urgent? Call ${match[1]}.`;
  if ((match=text.match(/^(\d+) articles?$/))) return `${match[1]} item${match[1] === '1' ? '' : 's'}`;
  if ((match=text.match(/^Stand (\d+) m² · (\d+) éléments? inclus$/))) return `Stand ${match[1]} m² · ${match[2]} included item${match[2] === '1' ? '' : 's'}`;
  if ((match=text.match(/^Inclus dans votre formule(?: (.+))?$/))) return `Included in your ${match[1] ? `${match[1]} ` : ''}package`;
  return null;
}
