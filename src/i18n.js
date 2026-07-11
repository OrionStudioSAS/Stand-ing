export const translations = {
  fr: {
    // Loading
    loading_objects: 'Chargement des objets 3D...',

    // Stepper / Header
    step_home: 'Accueil',
    step_options: 'Options',
    step_furniture: 'Mobilier',
    step_validation: 'Validation',
    step_counter: 'Étape {step} / 4',
    total_ht_estimated: 'Total HT estimé',
    aria_questions: 'Questions et remarques',
    aria_language: 'Choisir la langue',
    aria_client: 'Renseignements client',

    // Intro card
    intro_title: 'Stand·ING — Configurateur 3D',
    intro_subtitle: 'Votre espace de configuration est prêt. Renseignez les informations de votre stand pour démarrer la visualisation 3D en temps réel.',
    intro_start: 'Commencer la configuration →',

    // Footer
    back: '← Retour',
    next_step: 'Étape suivante →',

    // Toolbar
    toolbar_rotation: 'Rotation',
    toolbar_settings: 'Paramètres',
    toolbar_delete: 'Supprimer',
    toolbar_locked_move: 'Déplacement verrouillé',
    toolbar_locked_rotation: 'Rotation verrouillée',
    toolbar_locked_delete: 'Suppression verrouillée',

    // Base pack
    base_pack: 'Pack de base',

    // Panel heads
    panel_options_title: 'Options de configuration',
    panel_furniture_title: 'Bibliothèque accessoires',
    panel_validation_title: 'Validation',
    panel_step: 'Etape {step} / 4',

    // Rules summary
    rules_title: 'Regles SMCL appliquees automatiquement',
    rules_head: '{count} tete{s} de cloison incluse{s}',
    rules_led: '{count} spots LED (1/3m2)',
    rules_no_reserve: 'Pas de réserve incluse',

    // Options accordions
    section_options: 'Les options',
    option_carpet: 'Moquette',
    option_footprint: 'Empreinte moquette',
    option_wall: 'Cloison',
    option_floor: 'Plancher technique',
    option_led: 'Spots LED',
    option_reserve: 'Réserve',
    option_partition_head: 'Tête de cloison',
    option_counter: 'Banque d\'accueil',

    // ColorOptionCard
    color_title: 'Couleur',
    color_included: 'Inclus',
    color_options_paid: 'Options payantes',
    color_swatch_label: '{count} couleur{s} — {label}',

    // WallCoverOptionCard
    wall_cover_title: 'Bâche sur cloisons',
    wall_cover_ref: 'SMCL14BAC01A',
    wall_cover_price: '245 € / ml',
    wall_cover_active: 'actives',
    wall_cover_empty: 'Aucune cloison disponible sur cette implantation.',
    wall_cover_spec: 'Format simulateur conseillé :',
    wall_cover_missing: 'Visuel à fournir',
    wall_cover_ready: 'VISUEL',
    wall_cover_external_notice: 'Si vous activez une ou plusieurs bâches, notre équipe vous contactera pour récupérer les fichiers HD adaptés à l’impression.',
    wall_cover_generic_visual: 'Image générique affichée sur la scène',
    wall_cover_selected: 'Sélectionnée',
    wall_cover_not_selected: 'Option',
    wall_cover_toggle_add: 'Activer {label}',
    wall_cover_toggle_remove: 'Retirer {label}',

    // TechnicalFloorOptionCard
    floor_warning: 'Le plancher technique retire automatiquement l\'empreinte moquette.',
    floor_choose_height: 'Choisissez une hauteur',
    floor_none: 'Aucun plancher',
    floor_none_detail: 'Sol moquette standard conservé',
    floor_included: 'Inclus',
    floor_open_edges: 'Cornières uniquement sur :',
    floor_trim_type: 'Type de cornière',
    floor_ramp_title: 'Rampe obligatoire',
    floor_ramp_detail: 'elle est intégrée au plancher et peut être déplacée horizontalement dans la vue 3D.',

    // LedRailOptionCard
    led_title: 'Spots LED automatiques',
    led_count: '{count} spots calcules automatiquement, soit 1 spot tous les 3m2.',
    led_keep: 'Les laisser',
    led_remove: 'Tous les retirer',
    led_note: 'Ils sont places en haut des murs et restent inclus dans la scene de base.',

    // CarpetColorOptionCard
    carpet_locked: 'La couleur de la moquette standard est {color}.',
    carpet_thick_label: 'Moquette épaisse',
    carpet_thick_detail: 'Épaisseur 8mm, aspect velours',
    carpet_dirty_warning: 'Couleur de moquette sensible aux salissures et traces d\'usage',
    carpet_included_count: '{count} coloris disponible{s} — Inclus',
    carpet_option_from: 'En option {price} €',
    carpet_premium: 'PREMIUM',
    carpet_or: 'ou',

    // FootprintColorOptionCard
    footprint_disabled: 'Empreinte retirée de la scène.',
    footprint_restore: 'La remettre',
    footprint_remove: 'Retirer l\'empreinte moquette',
    footprint_standard: 'Standard',
    footprint_premium: 'PREMIUM',

    // ReserveOptionCard
    reserve_empty_title: 'Aucune réserve configurée',
    reserve_empty_detail: 'Cette surface ne déclenche pas de réserve automatique ni d\'option complémentaire.',
    reserve_choose_size: 'Choisissez une taille',
    reserve_remove: 'Supprimer la réserve',
    reserve_included: 'Inclus',
    formula_title: 'Votre formule inclus :',
    formula_reserve_included: 'Une réserve {area} est incluse dans votre formule.',
    formula_reserve_detail: 'Une réserve permet de stocker votre matériel, vos sacs et documents à l\'abri des regards.',
    formula_reserve_none: 'Aucune réserve n\'est incluse automatiquement pour cette surface.',

    // PartitionHeadOptionCard
    partition_left: 'Gauche',
    partition_right: 'Droite',
    partition_not_configured: 'Non configurée',
    partition_select_visual: 'Sélectionnez une tête de cloison pour ajouter un visuel.',
    partition_remove: 'Supprimer les têtes de cloison',
    partition_formula_detail1: 'Cliquer directement sur le(s) visuel(s) puis sur le crayon pour ajouter votre logo ou visuel au format de 800 × 500 mm ht.',
    partition_formula_detail2: 'Pour modifier votre nom, N° ou drapeau, cliquer sur « mes informations » en haut à droite.',
    partition_upload_drag: 'Glissez votre visuel',
    partition_browse: 'Parcourir',
    partition_uploading: 'Upload...',
    partition_size: '800 × 500 mm',
    visual_pending_label: 'Je veux un visuel, mais je ne l’ai pas encore',

    // PartitionHeadOptionsPanel (inline edit)
    partition_head_title: 'Tête de cloison',
    partition_head_subtitle: 'Options de cet objet uniquement',
    partition_head_image: 'Image à modifier',
    partition_head_company: 'Nom société',

    // CounterOptionCard
    counter_empty_title: 'Aucune banque d\'accueil sur cette scène',
    counter_empty_detail: 'Le paramétrage apparaîtra ici dès qu\'une banque d\'accueil sera incluse dans la configuration de base.',
    counter_formula_title: 'Votre formule inclut :',
    counter_formula_detail: 'Une banque d\'accueil 1m en finition bois naturel, avec l\'emplacement logo personnalisable.',
    counter_selector_label: 'Banque à personnaliser',
    counter_size_title: 'Taille',
    counter_logo_title: 'Logo de votre entreprise',
    counter_logo_custom: 'Visuel personnalisé',
    counter_logo_default: 'Image frontale du comptoir',
    counter_logo_ok: 'Conforme',
    counter_logo_spec: 'Format conseillé :',
    counter_logo_add: 'Importer une image JPG, PNG ou WebP',
    counter_logo_replace_hint: 'Cliquer pour remplacer',
    counter_replace: 'Remplacer',
    counter_remove: 'Retirer',
    counter_no_logo: 'Aucun logo personnalisé',
    counter_why_title: 'Pourquoi ajouter un comptoir ?',
    counter_why_1: 'Surface d\'accueil pour vos prospects',
    counter_why_2: 'Affichage de votre logo et identité',
    counter_why_3: 'Rangement intégré (documents, sacs)',
    counter_why_4: 'Plus professionnel et structuré',
    counter_uploading: 'Upload du visuel...',
    counter_finish_title: 'Finition',

    // FurnitureStepPanel
    furniture_subtitle: 'Cliquez un accessoire pour le configurer',
    furniture_search: 'Rechercher un accessoire...',
    furniture_aria_filter: 'Filtrer les accessoires',
    furniture_empty: 'Aucun accessoire dans cette catégorie.',

    // MarketplaceCard
    market_from_price: 'À partir de {price} €',
    market_included: 'Inclus / sur devis',

    // FurnitureCartBar
    cart_my_stand: 'Mon stand',
    cart_articles: '{count} article{s} AMCO',
    cart_add: 'Ajouter',
    cart_add_detail: 'Choisir dans la bibliothèque',
    cart_quantity: 'Quantité · 1',
    cart_next: 'Étape suivante',
    cart_next_detail: 'Validation →',
    cart_next_furniture: 'Mobilier →',

    // ItemConfiguratorModal
    item_config_add: 'Configurer {name}',
    item_config_edit: 'Paramétrer {name}',
    item_config_breadcrumb: 'Bibliothèque ›',
    item_config_ref: 'Réf.',
    item_config_variant_title: 'Variante',
    item_config_quantity: 'Quantité',
    item_config_total: 'Total cet article',
    item_config_add_btn: '+ Ajouter au stand',
    item_config_save_btn: 'Enregistrer',
    item_config_uploading: 'Upload...',
    item_config_included: 'Inclus',
    item_config_close: 'Fermer',

    // ValidationPanel
    validation_summary_title: 'Récapitulatif HT',
    validation_total_label: 'Total options et mobilier',
    validation_total_note: 'La scène de base est incluse à 0 €. Seuls les ajouts hors pack ou au-delà des quantités incluses sont facturés.',
    validation_options_title: 'Options choisies',
    validation_carpet: 'Moquette',
    validation_footprint: 'Empreinte moquette',
    validation_footprint_removed: 'Retirée',
    validation_wall: 'Coton cloison',
    validation_floor: 'Plancher technique',
    validation_floor_none: 'Non sélectionné',
    validation_led: 'Spots LED',
    validation_led_kept: '{count} spots conserves',
    validation_led_removed: 'Retires',
    validation_reserve: 'Réserve',
    validation_reserve_removed: 'Retirée',
    validation_reserve_none: 'Non incluse',
    validation_partition_heads: 'Têtes de cloison',
    validation_base_items_title: 'Objets inclus dans le pack',
    validation_no_base_items: 'Aucun quota mobilier configuré sur ce pack.',
    validation_supplements_title: 'Suppléments facturés AMCO',
    validation_no_supplements: 'Aucun supplément : la configuration reste à 0 € HT.',
    validation_confirmed_note: 'Scène confirmée côté admin. Vous pouvez encore la modifier.',
    validation_confirm_loading: 'Confirmation...',
    validation_confirm_update: 'Mettre à jour la scène confirmée',
    validation_confirm_btn: 'Confirmer la scène',

    // LanguageMenu
    lang_title: 'Choisir la langue',
    lang_note: 'Les textes du stand restent en français',

    // ModalHead
    modal_close: 'Fermer',

    // ClientInfoModal
    client_title: 'Renseignements',
    client_intro: 'Ces informations seront associées à votre configuration et à votre BAT.',
    client_firstname: 'Prénom',
    client_lastname: 'Nom',
    client_company: 'Société',
    client_role: 'Fonction',
    client_email: 'Email',
    client_phone: 'Téléphone',
    client_location: 'Localisation',
    client_address: 'Adresse',
    client_zip: 'Code postal',
    client_city: 'Ville',
    client_country: 'Pays',
    client_placement: 'Emplacement',
    client_salon: 'Salon',
    client_hall: 'Hall',
    client_placement_field: 'Emplacement',
    client_note: 'Les prix affichés sont hors taxes. Ces informations sont transmises à Stand-ING pour la gestion de votre dossier.',
    client_validate: 'Valider',
    country_france: 'France',
    country_belgium: 'Belgique',
    country_switzerland: 'Suisse',
    country_luxembourg: 'Luxembourg',

    // QuestionModal
    question_title: 'Questions / Remarques',
    question_intro: 'Vous avez une question sur votre stand ou souhaitez ajouter une remarque particulière ? L\'équipe Stand-ING vous répond sous 24h.',
    question_faq_title: 'Questions fréquentes',
    question_subject: 'Objet',
    question_subject_placeholder: 'Ex : Dimension des cloisons pour mon logo...',
    question_message: 'Message',
    question_attachments: 'Pièces jointes (optionnel)',
    question_drag: 'Glisser un fichier ou',
    question_browse: 'Parcourir',
    question_file_types: 'PNG, JPG, PDF — Max 10 Mo',
    question_note: 'Notre équipe vous répondra directement par email et mettra à jour votre configuration si nécessaire.',
    question_send: 'Envoyer ma question',
    question_cancel: 'Annuler',

    // FAQ
    faq_q1: 'Puis-je modifier ma configuration après validation ?',
    faq_a1: 'Tant que votre BAT n\'est pas validé, vous pouvez modifier votre configuration en nous contactant. Une fois le BAT signé, toute modification est soumise à faisabilité et peut entraîner un surcoût.',
    faq_q2: 'Quels formats sont acceptés pour les visuels logo ?',
    faq_a2: 'Nous acceptons les fichiers PDF vectoriels, AI, EPS ou PNG haute résolution (300 dpi minimum). Les fichiers Word, PowerPoint et JPEG basse résolution ne sont pas adaptés à l\'impression.',
    faq_q3: 'Quel est le délai de réponse ?',
    faq_a3: 'Notre équipe répond sous 24h ouvrées. Pour les demandes urgentes en période de salon, n\'hésitez pas à nous appeler directement.',
    faq_q4: 'Quand mon stand sera-t-il livré sur le salon ?',
    faq_a4: 'La livraison est organisée avant l\'ouverture du salon. Vous recevrez les informations logistiques (horaires, lieu de montage) par email dès la validation de votre commande.',

    // WoodReceptionDeskOptionsPanel
    wood_desk_subtitle: 'Image frontale et couleur du panneau',

    // Poster
    poster_title: 'Affiche murale',
    poster_subtitle: 'Visuel 1000 × 1000 mm à hauteur écran',
    poster_format_title: 'Format conseillé pour le simulateur',
    poster_format_zone: 'Zone affichée : {size}',
    poster_format_image: 'Image conseillée : {pixels}',
    poster_format_ratio: 'Ratio à respecter : {ratio} · fichier léger JPG, PNG ou WebP',
    poster_image_label: 'Image de l\'affiche',
    poster_no_image: 'Aucune image personnalisée',
    poster_reset: 'Retirer l\'image personnalisée',

    // Image quality
    img_quality_ok: 'Qualité simulateur OK',
    img_quality_warning: 'Image un peu faible',
    img_quality_danger: 'Image trop petite',
    img_quality_ok_detail: 'Cette image est adaptée au rendu 3D. Le fichier HD print sera transmis séparément.',
    img_quality_low_detail: 'Pour un meilleur aperçu 3D, importez une image plus proche du format conseillé.',
    img_upload_drag: 'Glissez votre image',
    img_upload_browse: 'Parcourir',
    img_upload_reset: 'Revenir à l\'image d\'origine',
    img_uploading: 'Upload du visuel...',
    img_format_spec: 'Format conseillé : {w} × {h} px · JPG ou PNG',

    // Wood desk
    wood_desk_title: 'Banque accueil bois',
    wood_desk_no_color: 'Aucune couleur comptoir active pour ce salon.',
    wood_desk_reset_image: 'Revenir à l\'image d\'origine',
    wood_desk_reset_color: 'Revenir à la couleur d\'origine',
    wood_desk_color_included: '· Inclus',
    wood_desk_color_price: '· +{price} € HT/m²',
    wood_desk_image_label: 'Image à modifier',

    // Scene loader
    scene_loading: 'Chargement de la scene...',
    scene_texture_loading: 'Chargement de la scène 3D',
    scene_texture_progress: 'Préparation des modèles et textures… {progress}%',
    scene_confirmed_badge: 'Scène confirmée — mode visualisation',

    // Carpet premium details
    carpet_velvet: '✦ Aspect velours',
    carpet_dense: '◐ Plus dense',
    carpet_starting: 'À partir de {price} € /m²',
    carpet_for_area: 'Pour {area} m² · +{extra} €',

    // Reserve descriptions
    reserve_desc_small: '1m × 1m · 1 personne',
    reserve_desc_standard: '1m × 2m · idéale petits salons',
    reserve_desc_large: '2m × 2m · bagages + sacs équipe',

    // Furniture categories
    cat_all: 'TOUS',
    cat_furniture: 'Mobilier',
    cat_multimedia: 'Multimédia',
    cat_electricity: 'Électricité',
    cat_signage: 'Signalétique',
    cat_structure: 'Structures',
  },

  en: {
    // Loading
    loading_objects: 'Loading 3D objects...',

    // Stepper / Header
    step_home: 'Home',
    step_options: 'Options',
    step_furniture: 'Furniture',
    step_validation: 'Review',
    step_counter: 'Step {step} / 4',
    total_ht_estimated: 'Estimated total excl. VAT',
    aria_questions: 'Questions & comments',
    aria_language: 'Choose language',
    aria_client: 'Contact information',

    // Intro card
    intro_title: 'Stand·ING — 3D Configurator',
    intro_subtitle: 'Your configuration space is ready. Enter your stand information to start the real-time 3D visualisation.',
    intro_start: 'Start configuring →',

    // Footer
    back: '← Back',
    next_step: 'Next step →',

    // Toolbar
    toolbar_rotation: 'Rotation',
    toolbar_settings: 'Settings',
    toolbar_delete: 'Delete',
    toolbar_locked_move: 'Movement locked',
    toolbar_locked_rotation: 'Rotation locked',
    toolbar_locked_delete: 'Deletion locked',

    // Base pack
    base_pack: 'Base pack',

    // Panel heads
    panel_options_title: 'Configuration options',
    panel_furniture_title: 'Accessories library',
    panel_validation_title: 'Review',
    panel_step: 'Step {step} / 4',

    // Rules summary
    rules_title: 'SMCL rules applied automatically',
    rules_head: '{count} partition head{s} included',
    rules_led: '{count} LED spots (1/3m²)',
    rules_no_reserve: 'No storage included',

    // Options accordions
    section_options: 'Options',
    option_carpet: 'Carpet',
    option_footprint: 'Carpet footprint',
    option_wall: 'Partition',
    option_floor: 'Technical floor',
    option_led: 'LED spots',
    option_reserve: 'Storage',
    option_partition_head: 'Partition head',
    option_counter: 'Reception desk',

    // ColorOptionCard
    color_title: 'Colour',
    color_included: 'Included',
    color_options_paid: 'Paid options',
    color_swatch_label: '{count} colour{s} — {label}',

    // WallCoverOptionCard
    wall_cover_title: 'Banner on partitions',
    wall_cover_ref: 'SMCL14BAC01A',
    wall_cover_price: '245 € / lm',
    wall_cover_active: 'active',
    wall_cover_empty: 'No partition available for this layout.',
    wall_cover_spec: 'Recommended simulator format:',
    wall_cover_missing: 'Visual required',
    wall_cover_ready: 'VISUAL',
    wall_cover_external_notice: 'If you enable one or more banners, our team will contact you to collect print-ready HD files.',
    wall_cover_generic_visual: 'Generic image displayed in the scene',
    wall_cover_selected: 'Selected',
    wall_cover_not_selected: 'Option',
    wall_cover_toggle_add: 'Enable {label}',
    wall_cover_toggle_remove: 'Remove {label}',

    // TechnicalFloorOptionCard
    floor_warning: 'The technical floor automatically removes the carpet footprint.',
    floor_choose_height: 'Choose a height',
    floor_none: 'No floor',
    floor_none_detail: 'Standard carpet floor kept',
    floor_included: 'Included',
    floor_open_edges: 'Angle trims only on:',
    floor_trim_type: 'Trim type',
    floor_ramp_title: 'Ramp required',
    floor_ramp_detail: 'It is integrated into the floor and can be moved horizontally in the 3D view.',

    // LedRailOptionCard
    led_title: 'Automatic LED spots',
    led_count: '{count} spots calculated automatically, 1 spot every 3m².',
    led_keep: 'Keep them',
    led_remove: 'Remove all',
    led_note: 'They are placed at the top of the walls and are included in the base scene.',

    // CarpetColorOptionCard
    carpet_locked: 'The standard carpet colour is {color}.',
    carpet_thick_label: 'Thick carpet',
    carpet_thick_detail: '8mm thickness, velvet look',
    carpet_dirty_warning: 'This carpet colour is sensitive to dirt and marks',
    carpet_included_count: '{count} available colour{s} — Included',
    carpet_option_from: 'Option from {price} €',
    carpet_premium: 'PREMIUM',
    carpet_or: 'or',

    // FootprintColorOptionCard
    footprint_disabled: 'Footprint removed from scene.',
    footprint_restore: 'Restore it',
    footprint_remove: 'Remove carpet footprint',
    footprint_standard: 'Standard',
    footprint_premium: 'PREMIUM',

    // ReserveOptionCard
    reserve_empty_title: 'No storage configured',
    reserve_empty_detail: 'This surface area does not trigger automatic storage or any complementary option.',
    reserve_choose_size: 'Choose a size',
    reserve_remove: 'Remove storage',
    reserve_included: 'Included',
    formula_title: 'Your package includes:',
    formula_reserve_included: 'A {area} storage unit is included in your package.',
    formula_reserve_detail: 'Storage lets you keep your equipment, bags and documents out of sight.',
    formula_reserve_none: 'No storage is included automatically for this surface area.',

    // PartitionHeadOptionCard
    partition_left: 'Left',
    partition_right: 'Right',
    partition_not_configured: 'Not configured',
    partition_select_visual: 'Select a partition head to add a visual.',
    partition_remove: 'Remove partition heads',
    partition_formula_detail1: 'Click directly on the visual(s) then on the pencil to add your logo or visual in 800 × 500 mm format.',
    partition_formula_detail2: 'To change your name, number or flag, click "my information" in the top right.',
    partition_upload_drag: 'Drag your visual here',
    partition_browse: 'Browse',
    partition_uploading: 'Uploading...',
    partition_size: '800 × 500 mm',
    visual_pending_label: 'I want a visual, but I do not have it yet',

    // PartitionHeadOptionsPanel (inline edit)
    partition_head_title: 'Partition head',
    partition_head_subtitle: 'Options for this object only',
    partition_head_image: 'Image to edit',
    partition_head_company: 'Company name',

    // CounterOptionCard
    counter_empty_title: 'No reception desk in this scene',
    counter_empty_detail: 'Settings will appear here once a reception desk is included in the base configuration.',
    counter_formula_title: 'Your package includes:',
    counter_formula_detail: 'A 1m reception desk in natural wood finish, with a customisable logo area.',
    counter_selector_label: 'Desk to customise',
    counter_size_title: 'Size',
    counter_logo_title: 'Your company logo',
    counter_logo_custom: 'Custom visual',
    counter_logo_default: 'Front panel image',
    counter_logo_ok: 'Compliant',
    counter_logo_spec: 'Recommended format:',
    counter_logo_add: 'Import a JPG, PNG or WebP image',
    counter_logo_replace_hint: 'Click to replace',
    counter_replace: 'Replace',
    counter_remove: 'Remove',
    counter_no_logo: 'No custom logo',
    counter_why_title: 'Why add a reception desk?',
    counter_why_1: 'Welcome area for your prospects',
    counter_why_2: 'Display your logo and identity',
    counter_why_3: 'Built-in storage (documents, bags)',
    counter_why_4: 'More professional and structured',
    counter_uploading: 'Uploading visual...',
    counter_finish_title: 'Finish',

    // FurnitureStepPanel
    furniture_subtitle: 'Click an accessory to configure it',
    furniture_search: 'Search an accessory...',
    furniture_aria_filter: 'Filter accessories',
    furniture_empty: 'No accessory in this category.',

    // MarketplaceCard
    market_from_price: 'From {price} €',
    market_included: 'Included / on quote',

    // FurnitureCartBar
    cart_my_stand: 'My stand',
    cart_articles: '{count} item{s} AMCO',
    cart_add: 'Add',
    cart_add_detail: 'Choose from the library',
    cart_quantity: 'Quantity · 1',
    cart_next: 'Next step',
    cart_next_detail: 'Review →',
    cart_next_furniture: 'Furniture →',

    // ItemConfiguratorModal
    item_config_add: 'Configure {name}',
    item_config_edit: 'Edit {name}',
    item_config_breadcrumb: 'Library ›',
    item_config_ref: 'Ref.',
    item_config_variant_title: 'Variant',
    item_config_quantity: 'Quantity',
    item_config_total: 'Total this item',
    item_config_add_btn: '+ Add to stand',
    item_config_save_btn: 'Save',
    item_config_uploading: 'Uploading...',
    item_config_included: 'Included',
    item_config_close: 'Close',

    // ValidationPanel
    validation_summary_title: 'Summary excl. VAT',
    validation_total_label: 'Total options and furniture',
    validation_total_note: 'The base scene is included at €0. Only add-ons outside the package or beyond included quantities are charged.',
    validation_options_title: 'Selected options',
    validation_carpet: 'Carpet',
    validation_footprint: 'Carpet footprint',
    validation_footprint_removed: 'Removed',
    validation_wall: 'Partition fabric',
    validation_floor: 'Technical floor',
    validation_floor_none: 'Not selected',
    validation_led: 'LED spots',
    validation_led_kept: '{count} spots kept',
    validation_led_removed: 'Removed',
    validation_reserve: 'Storage',
    validation_reserve_removed: 'Removed',
    validation_reserve_none: 'Not included',
    validation_partition_heads: 'Partition heads',
    validation_base_items_title: 'Objects included in package',
    validation_no_base_items: 'No furniture quota configured for this package.',
    validation_supplements_title: 'AMCO charged extras',
    validation_no_supplements: 'No extras: configuration stays at €0 excl. VAT.',
    validation_confirmed_note: 'Scene confirmed on admin side. You can still modify it.',
    validation_confirm_loading: 'Confirming...',
    validation_confirm_update: 'Update confirmed scene',
    validation_confirm_btn: 'Confirm scene',

    // LanguageMenu
    lang_title: 'Choose language',
    lang_note: 'Stand texts remain in French',

    // ModalHead
    modal_close: 'Close',

    // ClientInfoModal
    client_title: 'Contact information',
    client_intro: 'This information will be associated with your configuration and your proof.',
    client_firstname: 'First name',
    client_lastname: 'Last name',
    client_company: 'Company',
    client_role: 'Job title',
    client_email: 'Email',
    client_phone: 'Phone',
    client_location: 'Location',
    client_address: 'Address',
    client_zip: 'Postcode',
    client_city: 'City',
    client_country: 'Country',
    client_placement: 'Stand location',
    client_salon: 'Trade show',
    client_hall: 'Hall',
    client_placement_field: 'Stand number',
    client_note: 'Prices shown are exclusive of VAT. This information is shared with Stand-ING to manage your file.',
    client_validate: 'Confirm',
    country_france: 'France',
    country_belgium: 'Belgium',
    country_switzerland: 'Switzerland',
    country_luxembourg: 'Luxembourg',

    // QuestionModal
    question_title: 'Questions / Comments',
    question_intro: 'Have a question about your stand or want to add a specific note? The Stand-ING team will get back to you within 24 hours.',
    question_faq_title: 'Frequently asked questions',
    question_subject: 'Subject',
    question_subject_placeholder: 'E.g. Partition dimensions for my logo...',
    question_message: 'Message',
    question_attachments: 'Attachments (optional)',
    question_drag: 'Drag a file or',
    question_browse: 'Browse',
    question_file_types: 'PNG, JPG, PDF — Max 10 MB',
    question_note: 'Our team will reply directly by email and update your configuration if needed.',
    question_send: 'Send my question',
    question_cancel: 'Cancel',

    // FAQ
    faq_q1: 'Can I change my configuration after submitting?',
    faq_a1: 'As long as your proof has not been approved, you can still modify your configuration by contacting us. Once the proof is signed, any change is subject to feasibility review and may incur extra costs.',
    faq_q2: 'Which file formats are accepted for logo visuals?',
    faq_a2: 'We accept vector PDF, AI, EPS or high-resolution PNG (minimum 300 dpi). Word, PowerPoint and low-resolution JPEG files are not suitable for printing.',
    faq_q3: 'What is the response time?',
    faq_a3: 'Our team responds within 24 working hours. For urgent requests during a trade show period, please call us directly.',
    faq_q4: 'When will my stand be delivered to the venue?',
    faq_a4: 'Delivery is arranged before the show opening. You will receive logistics information (times, assembly location) by email once your order is confirmed.',

    // WoodReceptionDeskOptionsPanel
    wood_desk_subtitle: 'Front image and panel colour',

    // Poster
    poster_title: 'Wall poster',
    poster_subtitle: 'Visual 1000 × 1000 mm at screen height',
    poster_format_title: 'Recommended format for simulator',
    poster_format_zone: 'Displayed area: {size}',
    poster_format_image: 'Recommended image: {pixels}',
    poster_format_ratio: 'Ratio required: {ratio} · lightweight JPG, PNG or WebP',
    poster_image_label: 'Poster image',
    poster_no_image: 'No custom image',
    poster_reset: 'Remove custom image',

    // Image quality
    img_quality_ok: 'Simulator quality OK',
    img_quality_warning: 'Image slightly small',
    img_quality_danger: 'Image too small',
    img_quality_ok_detail: 'This image is suitable for 3D rendering. The HD print file will be provided separately.',
    img_quality_low_detail: 'For a better 3D preview, import an image closer to the recommended format.',
    img_upload_drag: 'Drag your image',
    img_upload_browse: 'Browse',
    img_upload_reset: 'Revert to original image',
    img_uploading: 'Uploading visual...',
    img_format_spec: 'Recommended format: {w} × {h} px · JPG or PNG',

    // Wood desk
    wood_desk_title: 'Wood reception desk',
    wood_desk_no_color: 'No active desk colour for this trade show.',
    wood_desk_reset_image: 'Revert to original image',
    wood_desk_reset_color: 'Revert to original colour',
    wood_desk_color_included: '· Included',
    wood_desk_color_price: '· +{price} € excl. VAT/m²',
    wood_desk_image_label: 'Image to edit',

    // Scene loader
    scene_loading: 'Loading scene...',
    scene_texture_loading: 'Loading 3D scene',
    scene_texture_progress: 'Preparing models and textures… {progress}%',
    scene_confirmed_badge: 'Scene confirmed — view mode',

    // Carpet premium details
    carpet_velvet: '✦ Velvet look',
    carpet_dense: '◐ Denser',
    carpet_starting: 'From {price} € /m²',
    carpet_for_area: 'For {area} m² · +{extra} €',

    // Reserve descriptions
    reserve_desc_small: '1m × 1m · 1 person',
    reserve_desc_standard: '1m × 2m · ideal for small shows',
    reserve_desc_large: '2m × 2m · luggage + team bags',

    // Furniture categories
    cat_all: 'ALL',
    cat_furniture: 'Furniture',
    cat_multimedia: 'Multimedia',
    cat_electricity: 'Electricity',
    cat_signage: 'Signage',
    cat_structure: 'Structures',
  },
};

export function t(lang, key, vars = {}) {
  const dict = translations[lang] || translations.fr;
  let str = dict[key] ?? translations.fr[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}
