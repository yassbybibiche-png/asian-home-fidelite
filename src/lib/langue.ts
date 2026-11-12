// Version anglaise des pages clientes (P2-Q1) : #/jouer, #/carte, #/menu, #/desinscription, #/confidentialite,
// #/reglement (R4 : chrome traduit, texte légal en français comme la politique de confidentialité).
// Le back-office et la caisse restent en français. #/desinscription et #/confidentialite n'ont pas de
// commutateur : elles appliquent la langue mémorisée sur les autres pages clientes.
// Logique pure (testée sans React) : le français est la clé, l'anglais la traduction ; une chaîne absente du
// dictionnaire reste en français (jamais de texte vide). Les noms de plats et de lots ne sont pas traduits.

export type Langue = 'fr' | 'en'

/** Choix mémorisé sur ce téléphone (localStorage). */
export const CLE_LANGUE = 'fideliz:langue'

/** Pages où la langue mémorisée s'applique (pages publiques du client final ; le commutateur FR / EN
 *  n'est affiché que sur #/jouer, #/carte et #/menu). */
export const PAGES_TRADUITES = ['jouer', 'carte', 'menu', 'desinscription', 'confidentialite', 'reglement'] as const

export function estPageTraduite(page: string): boolean {
  return (PAGES_TRADUITES as readonly string[]).includes(page)
}

export function langueValide(v: unknown): Langue {
  return v === 'en' ? 'en' : 'fr'
}

export function lireLangue(stockage: Pick<Storage, 'getItem'> | null | undefined): Langue {
  try {
    return langueValide(stockage?.getItem(CLE_LANGUE))
  } catch {
    return 'fr'
  }
}

export function memoriserLangue(stockage: Pick<Storage, 'setItem'> | null | undefined, langue: Langue): void {
  try {
    stockage?.setItem(CLE_LANGUE, langue)
  } catch {
    // Stockage indisponible (navigation privée stricte) : le choix vaut pour cette page seulement.
  }
}

/** Libellés du commutateur : chaque langue est nommée dans sa propre langue. */
export const LIBELLES_LANGUE: Record<Langue, { court: string; long: string }> = {
  fr: { court: 'FR', long: 'Français' },
  en: { court: 'EN', long: 'English' },
}

/**
 * Dictionnaire français → anglais des chaînes principales : titres, boutons, navigation, messages de gain / perdu.
 * Les modèles `{x}` sont remplis par `traduire(modele, langue, { x })`.
 */
export const TRADUCTIONS_EN: Record<string, string> = {
  // ---- Accès à la carte (P0-S7) ----
  'tampons sur cette carte': 'stamps on this card',
  'Gain du jour à retirer : {lot}, code {code}': 'Today’s prize to collect: {lot}, code {code}',
  'Accès limité sur ce téléphone': 'Limited access on this phone',
  'Ce lien d’accès a expiré ou a déjà servi : demandez-en un nouveau.': 'This access link has expired or was already used: ask for a new one.',
  'Votre carte n’est plus ouverte sur ce téléphone': 'Your card is no longer open on this phone',
  'Pour des raisons de sécurité, l’accès a expiré ou a été retiré. Retrouvez votre carte avec votre téléphone ou votre e-mail, ou demandez au comptoir le QR d’accès à votre carte : vous pourrez ensuite tourner la roue.':
    'For security reasons, access has expired or was removed. Find your card with your phone number or e-mail, or ask at the counter for your card’s access QR code: you can then spin the wheel.',
  'Pour voir votre carte complète (points, messages, historique), ouvrez-la sur le téléphone utilisé à l’inscription, ou demandez au comptoir de vous montrer le QR d’accès à votre carte.':
    'To see your full card (points, messages, history), open it on the phone you signed up with, or ask at the counter to show you your card’s access QR code.',
  'Ce lien ne suffira plus à ouvrir la carte après le {date}.': 'This link will no longer open the card after {date}.',
  'Votre carte est maintenant protégée sur ce téléphone. Après le {date}, son ancien lien ou son ancien QR ne l’ouvriront plus seuls : gardez-la ici (ou ajoutez-la à l’écran d’accueil).':
    'Your card is now protected on this phone. After {date}, its old link or old QR code alone will no longer open it: keep it here (or add it to your home screen).',
  'Déconnecter cette carte de tous les téléphones, celui-ci compris ? Pour la rouvrir en entier, il faudra un lien d’accès du comptoir.':
    'Sign this card out of every phone, this one included? To open it in full again, you will need an access link from the counter.',
  'Sécurité de ma carte': 'My card’s security',
  'Téléphone perdu ou carte ouverte ailleurs ? Déconnectez-la partout : seul un lien d’accès du comptoir la rouvrira.':
    'Lost your phone, or card opened elsewhere? Sign it out everywhere: only an access link from the counter will open it again.',
  'Déconnecter tous mes appareils': 'Sign out all my devices',
  // ---- Commutateur ----
  'Langue': 'Language',
  // ---- Jeu (#/jouer) ----
  'Tournez la roue et gagnez un cadeau !': 'Spin the wheel and win a gift!',
  // Variante B du test A/B « accroche » (P2-Q3) : le libellé du lot n'est pas traduit (comme sur la roue).
  'Tournez la roue : {lot} à gagner !': 'Spin the wheel: {lot} to win!',
  'À gagner': 'Prizes',
  'Lots de la roue': 'Wheel prizes',
  'Roue de la chance : {n} lots à gagner, détaillés ci-dessous': 'Wheel of fortune: {n} prizes to win, listed below',
  'Son de la roue': 'Wheel sound',
  '🎡 Tourner la roue{prenom} !': '🎡 Spin the wheel{prenom}!',
  'La roue tourne…': 'The wheel is spinning…',
  'Tirage en cours…': 'Drawing…',
  'Réessayer': 'Try again',
  'Réessayer maintenant': 'Try again now',
  'Serveur injoignable': 'Server unreachable',
  'Serveur injoignable — vérifiez la connexion.': 'Server unreachable — check your connection.',
  // Message affiché (via MessagePublic) quand l'app tourne sans serveur — P2-Q1 : manquait au
  // dictionnaire (constante MESSAGE_MODE_SERVEUR, store.tsx), trouvé par l'analyseur t(…).
  'Disponible avec le serveur (données partagées) : pas dans la démo locale.': 'Available with the server (shared data): not in the local demo.',
  '1 participation par visite validée au comptoir, 1 tirage par jour. Tirage effectué par le serveur.':
    '1 spin per visit validated at the counter, 1 draw per day. The draw is made by the server.',
  'Données stockées dans ce navigateur uniquement. 1 participation par visite validée, 1 tirage par jour.':
    'Data stored in this browser only. 1 spin per validated visit, 1 draw per day.',
  'Données stockées dans ce navigateur uniquement.': 'Data stored in this browser only.',
  'QR code inconnu': 'Unknown QR code',
  'Ce QR code ne correspond à aucun commerce.': 'This QR code does not match any business.',
  'Le jeu de ce commerce n’est plus disponible.': 'This business’s game is no longer available.',
  'Aucun lot n’est configuré pour le moment.': 'No prizes have been set up yet.',
  'Un instant, la roue arrive.': 'One moment, the wheel is on its way.',
  'Vérification de votre carte…': 'Checking your card…',
  'Voir ma carte de fidélité': 'See my loyalty card',
  '📖 Voir le menu en attendant': '📖 See the menu while you wait',
  'C’est validé ? Vérifier maintenant': 'Validated? Check now',
  'Pour débloquer la roue': 'To unlock the wheel',
  'Plus que deux petites étapes avant de tourner la roue :': 'Just two quick steps before you spin the wheel:',
  'Présentez votre carte de fidélité en caisse.': 'Show your loyalty card at the counter.',
  'Revenez ici : la roue se débloque toute seule.': 'Come back here: the wheel unlocks by itself.',
  'En attente de validation…': 'Waiting for validation…',
  'Connexion perdue : impossible de vérifier votre visite pour le moment. Nous réessayons automatiquement dès le retour du réseau.':
    'Connection lost: your visit cannot be checked right now. We will try again automatically as soon as the network is back.',
  'Visite validée — à vous de jouer !': 'Visit validated — your turn to play!',
  '1 visite validée = 1 participation par jour.': '1 validated visit = 1 spin per day.',
  'Bonjour{prenom} !': 'Hello{prenom}!',
  'Vous avez déjà joué aujourd’hui{prenom} !': 'You have already played today{prenom}!',
  'Résultat du jour :': 'Today’s result:',
  '✓ Lot déjà remis au comptoir. Bon appétit !': '✓ Prize already collected at the counter. Enjoy your meal!',
  '1 tirage par personne et par jour. Prochaine chance à votre prochaine visite validée, dès demain.':
    '1 spin per person per day. Next chance at your next validated visit, from tomorrow.',
  'Re-bonjour': 'Welcome back',
  'Continuer en tant que {prenom}': 'Continue as {prenom}',
  'Continuer avec ma carte': 'Continue with my card',
  'Ce n’est pas moi': 'This is not me',
  'Pour jouer, votre téléphone ou votre e-mail suffit': 'To play, your phone number or e-mail is all you need',
  'Clavier du champ': 'Keyboard type',
  '📱 Téléphone': '📱 Phone',
  '✉️ E-mail': '✉️ E-mail',
  'Téléphone ou e-mail': 'Phone or e-mail',
  'Déjà client ? Le même numéro ou e-mail retrouve votre carte de fidélité.': 'Already a customer? The same number or e-mail finds your loyalty card.',
  // Bandeau parrainage sur le formulaire d'inscription (P2-Q1 : brut avant).
  '👥 Vous êtes parrainé(e) ! Inscrivez-vous : vous gagnerez 50 points à votre 1re visite, et votre ami aussi.':
    '👥 You were referred! Sign up: you will earn 50 points on your first visit, and so will your friend.',
  'J’accepte de recevoir les offres de {commerce} par SMS ou e-mail (désinscription à tout moment).':
    'I agree to receive offers from {commerce} by text or e-mail (unsubscribe at any time).',
  // ---- Désinscription : clés enregistrées par src/pages/Desinscription.tsx (P2-Q1, bundle P2-Q2) ----
  // ---- Navigation (‹ Retour est enregistré par src/pages/Confidentialite.tsx, P2-Q1) ----
  'Vos données servent uniquement à votre carte de fidélité, jamais revendues :': 'Your data is only used for your loyalty card, never sold:',
  'Un instant…': 'One moment…',
  'C’est parti': 'Let’s go',
  'Saisissez un numéro (10 chiffres) ou un e-mail valide.': 'Enter a valid phone number (10 digits) or e-mail.',
  // Progression de la saisie (message dynamique « N chiffre(s) sur 10 » — seules les formes 0–9 sont
  // atteignables : 10–13 chiffres forment déjà un numéro valide, « 0 chiffre » arrive en tapant « + »).
  '0 chiffre sur 10': '0 digits out of 10',
  '1 chiffre sur 10': '1 digit out of 10',
  '2 chiffres sur 10': '2 digits out of 10',
  '3 chiffres sur 10': '3 digits out of 10',
  '4 chiffres sur 10': '4 digits out of 10',
  '5 chiffres sur 10': '5 digits out of 10',
  '6 chiffres sur 10': '6 digits out of 10',
  '7 chiffres sur 10': '7 digits out of 10',
  '8 chiffres sur 10': '8 digits out of 10',
  '9 chiffres sur 10': '9 digits out of 10',
  '✓ E-mail valide': '✓ Valid e-mail',
  '✓ Numéro valide': '✓ Valid number',
  'E-mail incomplet (ex. marie@exemple.fr).': 'Incomplete e-mail (e.g. marie@exemple.fr).',
  'Cet e-mail n’a pas l’air valide (ex. marie@exemple.fr).': 'This e-mail does not look valid (e.g. marie@exemple.fr).',
  'Ce numéro n’a pas l’air valide (ex. 06 12 34 56 78).': 'This number does not look valid (e.g. 06 12 34 56 78).',
  'Apple Wallet et Google Wallet arrivent bientôt ; en attendant, l’icône sur votre écran d’accueil ouvre directement votre carte.':
    'Apple Wallet and Google Wallet are coming soon; meanwhile, the icon on your home screen opens your card directly.',
  'Votre prénom (optionnel)': 'Your first name (optional)',
  'Votre prénom, pour que l’équipe vous reconnaisse ? (optionnel)': 'Your first name, so the team recognises you? (optional)',
  'Merci {prenom}, votre carte est à votre nom.': 'Thank you {prenom}, the card is now in your name.',
  // Résultat : gain / perdu.
  '{bravo}, vous avez gagné :': '{bravo}, you won:',
  'Rien à retirer au comptoir : votre visite du jour compte sur votre carte de fidélité.': 'Nothing to collect at the counter: today’s visit counts on your loyalty card.',
  'Bravo': 'Well done',
  'Pas de lot cette fois{prenom}… mais votre visite compte !': 'No prize this time{prenom}… but your visit counts!',
  // Roue v2, R4 : avant le tirage (lots du jour, règles, règlement), résultat (dates du gain, solde de points).
  'À gagner aujourd’hui': 'To win today',
  'consolation': 'consolation prize',
  '1 tirage par jour · gain utilisable dès demain, pendant 30 jours': '1 spin per day · prize usable from tomorrow, for 30 days',
  'Le résultat est tiré au hasard.': 'The result is drawn at random.',
  'Règlement du jeu': 'Game rules',
  '1 tirage par jour. Tirage effectué par le serveur.': '1 spin per day. Draw made by the server.',
  'Données stockées dans ce navigateur uniquement. 1 tirage par jour.': 'Data stored in this browser only. 1 spin per day.',
  'Pas de lot cette fois{prenom}…': 'No prize this time{prenom}…',
  '+{n} points ajoutés à votre carte. Elle compte {total} points.': '+{n} points added to your card. It now has {total} points.',
  'Prochaine chance demain !': 'Next chance tomorrow!',
  'À utiliser dès demain et jusqu’au {date} au comptoir.': 'To use at the counter from tomorrow until {date}.',
  'Le jour venu, ouvrez votre carte au comptoir et appuyez sur « Utiliser mon gain » : votre code s’affiche pendant 10 minutes.':
    'When the day comes, open your card at the counter and tap “Use my prize”: your code shows for 10 minutes.',
  // Roue v2, R4 : gains sur la carte (en attente, à utiliser, code affiché 10 minutes).
  'Votre gain de la roue': 'Your wheel prize',
  '🎁 Votre gain : {lot}': '🎁 Your prize: {lot}',
  'Utilisable du {du} au {au}.': 'Usable from {du} to {au}.',
  'Le code s’affichera quand vous serez au comptoir.': 'The code will show when you are at the counter.',
  'À retirer directement au comptoir aujourd’hui.': 'Collect it directly at the counter today.',
  'Présentez ce code au comptoir :': 'Show this code at the counter:',
  'Il expire dans {reste} — passé ce délai, réactivez-le ici.': 'It expires in {reste} — after that, reactivate it here.',
  'Utilisable jusqu’au {au}.': 'Usable until {au}.',
  'Code expiré : appuyez de nouveau au comptoir pour en afficher un nouveau.': 'Code expired: tap again at the counter to show a new one.',
  'Utiliser mon gain': 'Use my prize',
  'Appuyez au comptoir : le code ne s’affiche que 10 minutes.': 'Tap at the counter: the code only shows for 10 minutes.',
  'Votre visite du jour est bien enregistrée sur votre carte de fidélité : un tampon de plus vers votre récompense.':
    'Today’s visit is saved on your loyalty card: one more stamp towards your reward.',
  'Prochaine chance à votre prochaine visite validée au comptoir, dès demain.': 'Next chance at your next visit validated at the counter, from tomorrow.',
  'Montrez cet écran au comptoir pour profiter de votre lot.': 'Show this screen at the counter to collect your prize.',
  'Montrez ce code au serveur :': 'Show this code to the waiter:',
  'Le code est vérifié en caisse et ne sert qu’une fois.': 'The code is checked at the till and can only be used once.',
  'Copier le code': 'Copy the code',
  '✓ Copié': '✓ Copied',
  'Copie impossible : sélectionnez le texte': 'Copy failed: select the text',
  '📲 Garder ma carte sur mon téléphone': '📲 Keep my card on my phone',
  // Instructions « Garder ma carte » (P2-Q1 : brutes avant) — en-tête selon la plateforme (modèle
  // {appareil}) ; les étapes sont choisies par la langue dans `etapesEcranAccueilLangue` (P2-Q1, bundle P2-Q2),
  // hors dictionnaire : 8 clés de moins dans le bundle initial.
  'Sur {appareil} : ajoutez votre carte à l’écran d’accueil': 'On {appareil}: add your card to your home screen',
  'Ouvrir ma carte': 'Open my card',
  'Politique de confidentialité': 'Privacy policy',
  'Démo': 'Demo',
  // Invitation à l'avis (après le jeu).
  'Vous avez aimé votre passage ?': 'Did you enjoy your visit?',
  'Votre avis compte — touchez une étoile pour ajuster, puis laissez votre avis sur Google.': 'Your opinion matters — tap a star to adjust, then leave your review on Google.',
  'Votre note': 'Your rating',
  '{n} étoile': '{n} star',
  '{n} étoiles': '{n} stars',
  'Décevant': 'Disappointing',
  'Moyen': 'Average',
  'Bien': 'Good',
  'Très bien': 'Very good',
  'Excellent': 'Excellent',
  'Laisser un avis 1★ sur Google': 'Leave a 1★ review on Google',
  'Laisser un avis 2★ sur Google': 'Leave a 2★ review on Google',
  'Laisser un avis 3★ sur Google': 'Leave a 3★ review on Google',
  'Laisser un avis 4★ sur Google': 'Leave a 4★ review on Google',
  'Laisser un avis 5★ sur Google': 'Leave a 5★ review on Google',
  'Google s’ouvre dans un nouvel onglet : sélectionnez-y vos étoiles et publiez votre avis.': 'Google opens in a new tab: choose your stars there and post your review.',
  'Sur Google, vous confirmez vous-même vos étoiles avant de publier.': 'On Google, you confirm your stars yourself before posting.',
  '(Le commerce n’a pas encore renseigné son lien Google.)': '(The restaurant hasn’t added its Google link yet.)',
  'Avis publié ? Revenir à ma carte de fidélité': 'Review posted? Back to my loyalty card',
  'Le lot n’est pas conditionné à l’avis — gagnez d’abord, avis libre ensuite.': 'The prize never depends on a review — win first, review freely afterwards.',
  // ---- Carte (#/carte) ----
  'Carte de fidélité': 'Loyalty card',
  'Titulaire': 'Holder',
  'tampons': 'stamps',
  'points': 'points',
  'point': 'point',
  'Tampons : {n} sur {total}': 'Stamps: {n} of {total}',
  'Tampon {i} : obtenu': 'Stamp {i}: earned',
  'Tampon {i} : à obtenir': 'Stamp {i}: to earn',
  'Tampon {i} : récompense': 'Stamp {i}: reward',
  'Progression vers la récompense': 'Progress towards the reward',
  'Carte complète': 'Card complete',
  'Récompense en attente': 'Reward waiting',
  'À demander au comptoir.': 'Ask for it at the counter.',
  'Objectif :': 'Goal:',
  'À retirer au comptoir': 'To collect at the counter',
  'Code à montrer :': 'Code to show:',
  'Valable aujourd’hui seulement': 'Valid today only',
  'Sans date limite': 'No expiry date',
  // Forme datée de l'expiration (P2-Q1, revue Codex point 9) : l'appel texteExpiration(r.expireLe,
  // maintenant) est conservé (épinglé par carte-pwa-p1-c3.test.ts:312), la date est reformulée en anglais.
  'Valable jusqu’au {date}': 'Valid until {date}',
  // Nouveaux tampons depuis la dernière ouverture + libellé d'accessibilité de la barre de défi.
  '✨ +{n} tampon{s} depuis votre dernière ouverture de la carte': '✨ +{n} stamp{s} since you last opened your card',
  'Progression du défi': 'Challenge progress',
  'Vos points': 'Your points',
  // Programme (niveaux, paliers, défi, réserve, offre hebdo, parrainage) : cadres traduits, libellés
  // du commerce (noms de niveaux, récompenses, offres) jamais traduits — comme les noms de plats.
  '👑 VIP — nos clients les plus fidèles': '👑 VIP — our most loyal customers',
  'Plus que {n} visite{s} avant :': 'Only {n} visit{s} to go:',
  '🎯 Défi : {a}/{b} visites en {jours} jours': '🎯 Challenge: {a}/{b} visits in {jours} days',
  'Plus que {n} visite{s} → {recompense}': 'Only {n} visit{s} to go → {recompense}',
  '{recompense} gagné !': '{recompense} won!',
  '🍜 Plat en réserve': '🍜 Dish on hold',
  'Un plat offert à utiliser avant le {date}.': 'A free dish to use before {date}.',
  'Aujourd’hui, membres :': 'Today, members:',
  'Tous les {jour}s, membres :': 'Every {jour}, members:',
  '👥 Parrainez un ami, vous gagnez chacun {n} points': '👥 Refer a friend, you each earn {n} points',
  'Votre code :': 'Your code:',
  'Votre ami le saisit à son inscription, vous gagnez vos points à sa 1re visite.': 'Your friend enters it when signing up, and you earn your points on their 1st visit.',
  '✓ Lien copié !': '✓ Link copied!',
  'Copier mon lien de parrainage': 'Copy my referral link',
  // Caisse (back-office, en français par conception) : les libellés passent par t() via MessagePublic,
  // mais estPageTraduite('caisse') est faux — ils s'affichent donc en français tant que la caisse
  // n'est pas bilingue. Les clés restent présentes pour ce jour-là.
  'Caisse': 'Checkout',
  'Lien incomplet : ouvrez la caisse depuis le tableau de bord (Équipe → « Ouvrir la caisse »).': 'Incomplete link: open the till from the dashboard (Team → “Open the till”).',
  'Hors ligne et aucune donnée en mémoire sur cet appareil.': 'Offline, with no data stored on this device.',
  'À présenter en caisse pour valider votre visite': 'Show at the till to validate your visit',
  'Chargement du QR code…': 'Loading the QR code…',
  'QR code indisponible pour le moment. Rechargez la page pour réessayer.': 'QR code unavailable right now. Reload the page to try again.',
  'Dernière visite :': 'Last visit:',
  'aucune pour l’instant': 'none yet',
  'Messages': 'Messages',
  'Historique des visites et des lots': 'Visit and prize history',
  // Libellés d'historique affichés (P2-Q1, revue Codex point 5) : les préfixes fixes sont traduits, les
  // noms (récompense, lot) ne le sont pas ; historiqueCarte() reste en français (épinglé par
  // carte-pwa-p1-c3.test.ts:346), l'adaptation se fait à l'affichage dans CartePublique.
  'Visite validée (+1 tampon)': 'Visit validated (+1 stamp)',
  'Récompense remise : {libelle}': 'Reward given: {libelle}',
  'Défi réussi : {recompense}': 'Challenge completed: {recompense}',
  'Roue : {lot} ({statut})': 'Wheel: {lot} ({statut})',
  'retiré': 'collected',
  'non retiré, expiré': 'not collected, expired',
  'à retirer aujourd’hui': 'to collect today',
  'Aucune visite pour l’instant : votre premier tampon arrive au comptoir.': 'No visits yet: your first stamp is waiting at the counter.',
  'Votre lien personnel': 'Your personal link',
  'Votre lien personnel :': 'Your personal link:',
  'Copier mon lien': 'Copy my link',
  '🎡 Tourner la roue du jour': '🎡 Spin today’s wheel',
  '📖 Voir le menu': '📖 See the menu',
  'Le restaurant': 'The restaurant',
  // 'Commerce introuvable' est enregistré par src/pages/Confidentialite.tsx (P2-Q1, bundle P2-Q2).
  'Carte introuvable': 'Card not found',
  'Ce lien ne correspond à aucune carte de fidélité.': 'This link does not match any loyalty card.',
  'Carte indisponible': 'Card unavailable',
  'La carte de fidélité de ce commerce n’est plus disponible.': 'This business’s loyalty card is no longer available.',
  'Un instant, votre carte arrive.': 'One moment, your card is on its way.',
  'Carte à jour.': 'Card up to date.',
  'Hors ligne : carte affichée telle qu’au dernier chargement.': 'Offline: card shown as last loaded.',
  'Votre profil': 'Your profile',
  'Pour recevoir votre récompense d’anniversaire et des offres sur vos plats préférés.': 'To receive your birthday reward and offers on your favourite dishes.',
  // Libellés du profil (P2-Q1 : bruts avant) — le suffixe « enregistré » est un modèle {valeur}.
  'Anniversaire (JJ/MM)': 'Birthday (DD/MM)',
  'Plat préféré': 'Favourite dish',
  ' — enregistré : {valeur}': ' — saved: {valeur}',
  'Enregistrer mon profil': 'Save my profile',
  'J’ai oublié de scanner': 'I forgot to scan',
  'Signalez une visite oubliée (sous {jours} jours) : le restaurant la validera et votre tampon + vos points seront crédités.': 'Report a forgotten visit (within {jours} days): the restaurant will validate it and your stamp and points will be credited.',
  'Date de la visite': 'Date of the visit',
  'Montant payé (€)': 'Amount paid (€)',
  'N° de ticket (optionnel)': 'Receipt number (optional)',
  'Envoyer ma demande': 'Send my request',
  // Confirmations et erreurs des formulaires du programme (P2-Q1, revue Codex point 4) : affichées via
  // t(message) / t(erreur) — les messages d'erreur du serveur restent en français (API en français).
  'Merci, votre profil est à jour !': 'Thank you, your profile is up to date!',
  'Demande envoyée : le restaurant la validera et votre visite sera créditée.': 'Request sent: the restaurant will validate it and your visit will be credited.',
  'Indiquez la date de la visite et le montant payé.': 'Enter the visit date and the amount paid.',
  'Envoi impossible pour le moment.': 'Cannot send right now.',
  '{n} demande{s} en attente de validation par le restaurant.': '{n} request{s} awaiting validation by the restaurant.',
  'Mes données personnelles': 'My personal data',
  'Recevez une copie de vos données ou demandez leur suppression.': 'Get a copy of your data or ask for it to be deleted.',
  'Demande de suppression enregistrée le {date} : le restaurant va supprimer votre carte.': 'Deletion request recorded on {date}: the restaurant will delete your card.',
  'Recevoir mes données': 'Get my data',
  'Demander la suppression': 'Request deletion',
  'Votre téléphone ou e-mail (celui de l’inscription)': 'Your phone or e-mail (the one used to sign up)',
  'Retrouver ma carte': 'Find my card',
  'Téléphone ou e-mail donné à l’inscription': 'Phone or e-mail given when signing up',
  // ---- Confidentialité (#/confidentialite) ----
  // Chrome de la page (titre, chargement, retour) traduit ; le corps de la politique est un texte légal,
  // il reste en français par conception. Les clés du chrome sont enregistrées par
  // src/pages/Confidentialite.tsx (P2-Q1, bundle P2-Q2).
  // ---- Menu (#/menu) ----
  'Menu': 'Menu',
  'Menu introuvable': 'Menu not found',
  // 'Ce lien ne correspond à aucun commerce.' est enregistré par src/pages/Confidentialite.tsx et
  // src/pages/MenuPublic.tsx (P2-Q1, bundle P2-Q2).
  'Menu indisponible': 'Menu unavailable',
  'Le menu de ce commerce n’est plus disponible.': 'This business’s menu is no longer available.',
  'Un instant, le menu arrive.': 'One moment, the menu is on its way.',
  'Menu à venir': 'Menu coming soon',
  'Le commerce n’a pas encore publié son menu.': 'The business has not published its menu yet.',
  'Cuisine asiatique halal · Thaï, Japon, Vietnam, Chine': 'Halal Asian cuisine · Thai, Japanese, Vietnamese, Chinese',
  'Contacter le restaurant': 'Contact the restaurant',
  'C’est l’heure du Menu Midi !': 'It’s Lunch Menu time!',
  'Formules du lundi au vendredi, jusqu’à 14h30.': 'Set menus Monday to Friday, until 2:30 pm.',
  'Voir': 'See',
  'Rechercher un plat': 'Search for a dish',
  '🔍 Rechercher un plat… (ex : dynamite, maki)': '🔍 Search for a dish… (e.g. dynamite, maki)',
  'Catégories': 'Categories',
  'Toutes': 'All',
  'Aucun plat ne correspond à « {recherche} ».': 'No dish matches “{recherche}”.',
  '{n} plat': '{n} dish',
  '{n} plats': '{n} dishes',
  ' pour « {recherche} »': ' for “{recherche}”',
  'Prix sur place': 'Price on site',
  'Prix :': 'Price:',
  'sur place': 'on site',
  'Description à venir — demandez conseil à l’équipe.': 'Description coming soon — ask the team for advice.',
  'Allergènes :': 'Allergens:',
  'Allergènes : demander en caisse': 'Allergens: please ask at the counter.',
  '★ Signature': '★ Signature',
  '★ Plat signature — l’un des best-sellers du restaurant.': '★ Signature dish — one of the restaurant’s best-sellers.',
  'Allergènes : demandez conseil à l’équipe en cas de doute.': 'Allergens: ask the team for advice if in doubt.',
  'Photo du plat : {nom}': 'Photo of the dish: {nom}',
  // Badges déduits (🌶 / 🌱) : libellés fixes traduits, comme les cadres — les noms de plats, eux, ne le sont pas.
  // Les 4 libellés sont enregistrés par src/pages/MenuPublic.tsx (P2-Q1, bundle P2-Q2).
  'à confirmer': 'to confirm',
  'Déduit de la description — {mention}': 'Inferred from the description — {mention}',
  // Détail des badges sous le plat (P2-Q1, revue Codex point 3) : la branche FR garde littéralement
  // `{MENTION_BADGE_DEDUIT} auprès de l’équipe` (épinglé par menu-client-p1-c5.test.ts:246) ; en EN,
  // la phrase entière passe par ce modèle (libellés et mention déjà traduits par t()).
  '{labels} — {mention} — ask the team.': '{labels} — {mention} — ask the team.',
  '* 🌶 / 🌱 : déduit du nom ou de la description du plat, {mention} auprès de l’équipe.': '* 🌶 / 🌱: inferred from the dish name or description, {mention} — ask the team.',
}

/** Noms des jours de semaine en anglais, même ordre que JOURS_SEMAINE (0 = dimanche, src/lib/programme.ts). */
export const JOURS_SEMAINE_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Locale de formatage des dates affichées (historique, suppression, grâce, réserve) : anglaise en mode EN. */
export function localeDate(langue: Langue): 'fr-FR' | 'en-GB' {
  return langue === 'en' ? 'en-GB' : 'fr-FR'
}

/** Enregistre les traductions d'une page différée (P2-Q1, bundle P2-Q2) : les clés des pages #/menu
 *  (badges seulement), #/desinscription et #/confidentialite ne sont pas dans le dictionnaire initial
 *  — elles s'y ajoutent au chargement de la page, avant son premier rendu. Sans cela, le bundle
 *  initial dépasserait le seuil du test performance-bundle-p2-q2 (80 % du bundle d'avant découpe). */
export function enregistrerTraductions(supplement: Record<string, string>): void {
  Object.assign(TRADUCTIONS_EN, supplement)
}
export function traduire(fr: string, langue: Langue, valeurs: Record<string, string | number> = {}): string {
  const modele = langue === 'en' ? (TRADUCTIONS_EN[fr] ?? fr) : fr
  return modele.replace(/\{(\w+)\}/g, (tout, cle: string) => (cle in valeurs ? String(valeurs[cle]) : tout))
}

/** « Encore 3 repas avant votre plat offert » → « 3 more meals until your free dish » (même règle que `texteProgression`). */
export function texteProgressionLangue<C extends { type: string; recompense: string }>(restants: number, commerce: C, langue: Langue, fr: (n: number, c: C) => string): string {
  if (langue === 'fr') return fr(restants, commerce)
  if (restants <= 0) return 'Card complete'
  const unite = commerce.type === 'restaurant' ? `meal${restants > 1 ? 's' : ''}` : `visit${restants > 1 ? 's' : ''}`
  const cible = /plat offert/i.test(commerce.recompense) ? 'your free dish' : 'your reward'
  return `${restants} more ${unite} until ${cible}`
}

/** « Valable aujourd’hui, mar. 10 nov. 2026 » / « Valid today, Tue 10 Nov 2026 » (même jour que `jourEnClair`). */
export function texteValiditeLangue(maintenant: Date, langue: Langue, fr: (d: Date) => string): string {
  if (langue === 'fr') return fr(maintenant)
  const jour = maintenant.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  return `Valid today, ${jour}`
}
