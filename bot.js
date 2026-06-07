'use strict';

/**
 * BOTteDePersil — EuropNet #cuisine
 * Gestion des défis cuisine : inscription, participation, vote, classement
 * + Commandes fantaisie
 * Dépendances : irc-framework, node-cron
 */

const IRC   = require('irc-framework');
const cron  = require('node-cron');
const fs    = require('fs');
const path  = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
  host:         'irc.europnet.org',
  port:         6697,
  ssl:          true,                // connexion SSL
  nick:         'BOTteDePersil',
  username:     'botteDePersil',
  realname:     'BOTteDePersil — Défis Cuisine EuropNet',
  account:      'BOTteDePersil',     // ⬅️ pseudo enregistré sur NickServ
  password:     'MOT_DE_PASSE',      // ⬅️ mot de passe NickServ du bot
  channel:      '#cuisine',
  founderLevel: 500, // niveau minimum pour lancer un défi (Coquelicot=500, Thaliane=9999)
  dataFile:     path.join(__dirname, 'data.json'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}
function today()       { const d = new Date(); d.setHours(0,0,0,0); return d; }
function dateOnly(iso) { const d = new Date(iso); d.setHours(0,0,0,0); return d; }
function pick(arr)     { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── Persistance JSON ─────────────────────────────────────────────────────────
function loadData() {
  if (!fs.existsSync(CONFIG.dataFile)) return defaultData();
  try { return JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8')); }
  catch { return defaultData(); }
}
function saveData(data) {
  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2), 'utf8');
}
function defaultData() {
  return { defi: null, historique: [], photosUrl: null };
}

// ─── Vérification founder via ChanServ ────────────────────────────────────────
const pendingAccessChecks = new Map();

function checkFounder(client, nick, channel) {
  return new Promise((resolve) => {
    const key = `${nick}|${channel}|${Date.now()}`;
    pendingAccessChecks.set(key, { resolve, nick, channel });
    client.say('ChanServ', `ACCESS ${channel} ${nick}`);
    setTimeout(() => {
      if (pendingAccessChecks.has(key)) { pendingAccessChecks.delete(key); resolve(false); }
    }, 5000);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// DONNÉES FANTAISIE
// ══════════════════════════════════════════════════════════════════════════════

const philippeRepliques = [
  // Répliques originales
  (n) => `${n}, MAIS QU'EST-CE QUE C'EST QUE CE TRAVAIL ?! On dirait que t'as cuisiné avec tes pieds ! Recommence, et cette fois, mets-y du CŒUR bon sang !`,
  (n) => `${n}… je vais être honnête avec toi. C'est pas bon. C'est même très pas bon. T'as mis du sel ou t'as versé la salière entière ?`,
  (n) => `Ah ${n} ! Voilà quelqu'un qui ose. C'est courageux. C'est même… téméraire. Parce que là, franchement, c'est limite immangeable.`,
  (n) => `${n}, t'appelles ça une recette ? Moi j'appelle ça un accident industriel. Mais bon, t'as essayé, et c'est déjà ça.`,
  (n) => `Écoute ${n}, je vais pas te mentir : ma grand-mère cuisinait mieux que ça les yeux fermés. Et elle était aveugle.`,
  (n) => `${n} ! T'as goûté avant de servir ?! NON ?! Ça se voit. Ça se voit énormément.`,
  (n) => `Bien ${n}, bien… c'est pas transcendant, c'est pas une révélation, mais… c'est mangeable. Pour une fois. Fais pas la fierté.`,
  (n) => `${n}, j'ai mangé dans des 3 étoiles, dans des cantines d'autoroute et dans des camps militaires. Là t'es quelque part entre les deux derniers.`,
  // Nouvelles répliques
  (n) => `${n}, t'as lu la recette ou tu l'as devinée ? Parce que là c'est ni l'un ni l'autre.`,
  (n) => `C'est généreux ${n}. Vraiment. Peut-être même trop. Beaucoup trop. Énormément trop.`,
  (n) => `J'ai vu des stagiaires de première semaine faire mieux que toi ${n}. Premier jour.`,
  (n) => `C'est quoi cette couleur ${n} ? C'est quoi cette texture ? C'est quoi CE PLAT ?`,
  (n) => `${n}, tu m'as mis du beurre là-dedans ? Non ? Ça s'entend.`,
  (n) => `Le problème ${n} c'est pas la recette. C'est l'exécution. Et un peu la recette aussi.`,
  (n) => `J'ai goûté ${n}. J'ai réfléchi. J'aurais pas dû goûter.`,
  (n) => `C'est audacieux ${n}. C'est même très audacieux. Malheureusement l'audace ne suffit pas.`,
  (n) => `Là ${n} t'as pas cuisiné, t'as improvisé. Et l'improvisation en cuisine ça donne… ça.`,
  (n) => `Je vais rester positif ${n} : l'assiette est propre. C'est beau une assiette propre.`,
];

const michelinResultats = [
  { etoiles: 0, icone: '🍽️',  commentaire: "Une cuisine sincère, mais qui manque encore de maîtrise. On reviendra… peut-être." },
  { etoiles: 0, icone: '🍽️',  commentaire: "L'assiette était là. C'est déjà un début." },
  { etoiles: 1, icone: '⭐',   commentaire: "Une très bonne cuisine dans sa catégorie. Originalité et générosité au rendez-vous." },
  { etoiles: 1, icone: '⭐',   commentaire: "Cuisine de qualité, avec un beau travail sur les saveurs. Prometteur !" },
  { etoiles: 2, icone: '⭐⭐',  commentaire: "Cuisine excellente, mérite le détour. Une vraie personnalité culinaire." },
  { etoiles: 2, icone: '⭐⭐',  commentaire: "Technique irréprochable et créativité bien maîtrisée. Bravo !" },
  { etoiles: 3, icone: '⭐⭐⭐', commentaire: "Cuisine exceptionnelle, vaut le voyage. Un grand moment de gastronomie." },
  { etoiles: 3, icone: '⭐⭐⭐', commentaire: "Une expérience culinaire hors du commun. Le guide est sans voix." },
];

const frigoIngredients = [
  // Ingrédients normaux
  'des anchois en boîte',
  'un fond de moutarde ancienne',
  'une courgette un peu molle',
  'du fromage dont on ne sait plus le nom',
  'trois oeufs',
  'un reste de riz cuit hier',
  'une boîte de pois chiches',
  'du lait de coco presque périmé',
  'une demi-pomme',
  'un bout de gingembre oublié',
  'de la crème fraîche',
  'des lardons',
  'un oignon qui commence à germer',
  'du concentré de tomate',
  'une escalope mystère',
  'du beurre',
  'une tablette de chocolat noir entamée',
  'des cornichons',
  'un yaourt nature',
  'des champignons en boîte',
  'un citron qui ride',
  'de la feta',
  'un fond de vin blanc',
  'des épinards surgelés',
  // Nouveaux ingrédients normaux
  'un ketchup dont la date est illisible',
  'une boîte de thon ouverte depuis hier',
  'un avocat trop mûr',
  'des câpres',
  'un reste de fondue solidifiée',
  'une tranche de jambon solitaire',
  'du Philadelphia entamé',
  'trois tomates cerises rescapées',
  'un fond de sauce soja',
  'une lichette de beurre',
  'un citron confit oublié',
  'du parmesan râpé en sachet',
  'une boîte de maïs presque vide',
  'deux feuilles de brick',
  'un reste de soupe d\'avant-hier',
  'une bouteille de vin blanc entamée',
  'du miel cristallisé',
  'un poivron rouge à moitié coupé',
  'des herbes fraîches qui commencent à rendre l\'âme',
  // Ingrédients douteux / oubliés
  'un yaourt périmé depuis 3 semaines (mais il sent encore bon… peut-être)',
  'une courgette qui a rendu l\'âme et commence à suinter',
  'du fromage blanc dont la surface est devenue suspecte',
  'un reste de pâtes collées en bloc compact depuis 4 jours',
  'une tomate qui s\'est transformée en liquide dans le bac à légumes',
  'un fond de jus d\'orange avec quelque chose qui flotte dedans',
  'une escalope oubliée sous du papier alu depuis… longtemps',
  'un bout de camembert tellement affiné qu\'il marche tout seul',
  'des fraises recouvertes d\'un duvet blanc artistique',
  'un citron rétréci et tout ridé qui ressemble à une météorite',
  'une boîte de conserve ouverte recouverte de film plastique, contenu non identifiable',
  'un poireau qui a décidé de repousser tout seul',
  'de la charcuterie dont la couleur pose question',
  'un reste de gratin fossilisé dans son plat',
  'une compote de pommes millésimée',
  'un reste de tapenade',
  'une boîte de lentilles cuites',
  'du tahini presque vide',
  'trois tranches de pain de mie qui commencent à sécher',
  'un fond de crème de coco',
  "une demi-boîte de sardines à l'huile",
  'du vinaigre balsamique',
  'un reste de houmous',
  'deux feuilles de lasagne non cuites',
  'un sachet de graines de sésame',
  'un fond de miso',
  'une boîte de flageolets entamée',
  'du lard fumé en tranches épaisses',
  'un reste de brandade de morue',
  "une petite boîte de caviar d'aubergine",
  'du beurre de cacahuète presque vide',
  'trois galettes de riz',
  'un demi-poivron jaune sous film',
  'un reste de couscous cuit',
  'une boîte de tomates pelées entamée',
  'du chorizo en rondelles',
  'un sachet de noix de cajou',
  'une lichette de crème de roquefort',
  'un reste de taboulé du week-end',
  'une boîte de haricots rouges entamée',
  'du Philadelphia aux herbes presque vide',
  'une escalope de dinde sous vide',
  'un sachet de gruyère râpé',
  "une pomme de terre cuite à l'eau d'hier",
  'du coulis de tomate en brique entamé',
  'un reste de guacamole qui commence à brunir',
  'trois champignons de Paris isolés',
  "du lait d'avoine presque fini",
  "une boîte de thon à l'huile d'olive entamée",
  'un reste de purée maison un peu sèche',
  'du pesto rosso au fond du pot',
  'une escalope de veau oubliée sous du papier sulfurisé',
  'un sachet de graines de tournesol',
  'du fromage frais nature',
  'une demi-boîte de maquereau au vin blanc',
  'un fond de sauce teriyaki',
  'deux tranches de pain complet qui durcissent',
  'un reste de ratatouille dans un tupperware',
  'du concentré de tomate en tube presque vide',
  'une courgette ronde oubliée dans le fond du bac',
  'du lait entier ouvert depuis quelques jours',
  'un sachet de noisettes entières',
  'un yaourt grec dont le couvercle est légèrement bombé',
  "une part de pizza d'il y a trois jours dans du papier alu",
  'un fond de soupe en brique dont la date est passée de peu',
  'un reste de riz cantonnais collé dans sa barquette',
  'une banane oubliée dans le bac à légumes, toute noire',
  "un morceau de brie qui a décidé de s'étaler tout seul",
  'des haricots verts cuits depuis… un moment',
  'une bouteille de lait entamée dont on préfère ne pas vérifier la date',
  'une boîte de petits pois ouverte recouverte d'un couvercle en métal tordu',
  'un camembert si fait qu'il coule de lui-même',
  'un reste de chili con carne de la semaine dernière dans une casserole',
  'une tomate cerise éclatée au fond du bac à légumes',
  'un fond de crème fraîche dont la surface inspire la méfiance',
  'une saucisse de Francfort solitaire dans son jus',
  'un reste de gratin dauphinois recouvert d'un film plastique déchiré',
  'une barquette de framboises dont la moitié a rendu l'âme',
  'du lait de soja ouvert depuis une semaine et demie',
  'un reste de brandade réchauffée deux fois déjà',
  'une botte de radis dont les feuilles ont décidé de mourir en premier',
  'un pot de yaourt brassé ouvert avec une cuillère dedans depuis hier',
  'des épinards frais tout juste en train de devenir visqueux',
  'un fond de crème anglaise industrielle dont la teinte jaune interroge',
  'une boîte de cassoulet ouverte recouverte d'un film aluminium froissé',
  'un reste de tarte aux poireaux dont la pâte est détrempée',
  'un, euh... qu\'est-ce que c\'est que ça, au juste ?',
  'un reste de gratin de restes de la semaine',
];

const menusEntrees = [
  'Velouté de chaussettes au parmesan',
  'Salade de bureau revisitée façon gastronomique',
  'Tartare de carottes à la pâte à tartiner',
  'Soupe froide de concombre au ketchup',
  'Œuf mollet sur lit de céréales du matin',
  'Carpaccio de pomme de terre crue',
  'Tartare de betterave au caramel mou',
  'Gaspacho de chewing-gum menthe',
  'Verrines de mayonnaise au coulis de sardine',
  'Soufflé au Kiri et aux cornichons',
  'Salade de pissenlits au beurre de cacahuète',
  'Velouté de petits pois à la guimauve grillée',
  'Salade de gésiers au caramel et aux bonbons acidulés',
  'Blinis au saumon fumé et à la pâte de spéculoos',
  "Soupe à l'oignon gratinée au chocolat au lait",
  'Feuilleté au chèvre et à la confiture de pastèque',
  'Verrine de concombre au Nutella et graines de pavot',
  'Tartare de thon au caramel beurre salé et ciboulette',
  'Soupe de châtaignes au lait Ricoré et lardons grillés',
  'Cromesquis de camembert à la confiture de piment',
  'Salade de poulpe aux fraises et balsamique blanc',
  'Velouté de potimarron au pralin et curry vert',
  'Tatin de tomates cerises au miel de châtaignier et anchois',
  'Œuf parfait sur fondue de poireaux au caramel salé',
];

const menusPlats = [
  'Magret de canard sauce beurre de cacahuète',
  'Poulet rôti aux bonbons Haribo',
  'Spaghetti bolognaise au Nutella',
  'Brandade de morue au caramel beurre salé',
  'Côtelettes marinées au Coca-Cola',
  'Gratin dauphinois à la sauce soja',
  'Osso-buco aux chamallows grillés',
  'Tajine de poisson aux Dragibus',
  'Blanquette de veau au lait Ricoré',
  'Filet mignon laqué à la confiture de fraises',
  'Rôti de porc sauce Orangina',
  'Lasagnes au Nutella et à la mortadelle',
  'Bœuf bourguignon au lait concentré sucré',
  'Quiche lorraine aux fraises Tagada',
  'Cabillaud rôti sauce caramel beurre salé et cornichons',
  'Poulet basquaise au sirop de grenadine',
  'Croque-monsieur au chocolat blanc et jambon fumé',
  'Wok de nouilles sautées à la limonade et aux lardons',
  'Tarte flambée au Nutella et oignons caramélisés',
  "Daurade royale laquée au sirop d'érable et moutarde violette",
  'Hachis parmentier à la banane et au curry doux',
  'Escalope milanaise sauce framboise et câpres',
  "Risotto à l'encre de seiche et aux chamallows",
  'Burger au foie gras et au Kinder Bueno fondu',
  'Sauté de veau aux pralines roses et aux olives vertes',
  'Pizza quatre fromages à la confiture de lait et au basilic',
  'Joue de bœuf confite au jus de pomme et réglisse',
  'Dos de cabillaud en croûte de céréales du matin',
  'Lapin à la moutarde et au lait de coco épicé',
  'Filet de canard laqué au sirop de violette et poivre long',
  'Gratin de coquillettes au Kiri et aux lardons caramélisés',
  'Spaghetti carbonara au chocolat noir 70%',
  "Mijotée de lentilles corail au lait d'amande et merguez",
  'Parmentier de canard confit à la patate douce et miel',
  'Pavé de saumon rôti sauce passion et câpres frites',
  'Tarte flambée à la banane, lard fumé et sirop d'érable',
  'Côte de porc laquée au Coca Zero et cinq épices',
  'Moules marinières à la bière framboise et estragon',
];

const menusDessets = [
  'Tarte Tatin à la choucroute',
  'Mousse au chocolat pimentée à la harissa',
  'Île flottante au bouillon de poule',
  'Crème brûlée aux cornichons',
  'Sorbet au fromage de brebis',
  'Fondant au chocolat fourré sardines',
  'Tiramisu au vinaigre balsamique et chips',
  'Panna cotta au Petit Lu émietté',
  'Tarte aux poireaux façon dessert',
  'Fondant au chocolat blanc et au thon',
  'Crumble de pommes de terre au sucre roux',
  'Glace à la vanille servie chaude',
  'Financiers au roquefort et confiture de cerises noires',
  'Tarte Bourdaloue à la moutarde de Meaux',
  'Soufflé glacé au citron vert et poivre de Sichuan',
  'Cannelés bordelais fourrés au foie gras et gelée de sauternes',
  'Crème catalane au curry doux et zeste d'orange amère',
  'Opéra revisité à la sardine et ganache café',
  'Palmiers feuilletés au camembert et confiture de coings',
  'Paris-Brest fourré à la brandade et crème de marrons',
  "Charlotte aux framboises et à la moutarde à l'ancienne",
  'Baba au rhum fourré au maquereau',
  'Mille-feuille au ketchup et crème pâtissière',
  'Clafoutis aux olives noires et cerises confites',
  'Brownie au camembert et noix de cajou',
  'Éclair au chocolat fourré à la brandade de morue',
  'Tarte au citron meringuée au vinaigre de framboise',
  'Profiteroles au boudin blanc et sauce caramel',
  'Riz au lait à la truffe et aux céréales soufflées',
  'Moelleux au chocolat noir farci au hareng fumé',
];

const regimeRepliques = [
  // Originaux
  (n) => `${n}, t'inquiète pas pour le régime, la cuisine c'est fait pour être mangé. Et rebondi c'est plus sympa.`,
  (n) => `${n} : d'après mes calculs très sérieux, une part supplémentaire ne changera RIEN. Mange.`,
  (n) => `${n}, le régime c'est pour janvier. On est pas en janvier. Sers-toi.`,
  (n) => `Selon mes sources (inexistantes), les calories cuisinées avec amour ne comptent pas. Bon appétit ${n} !`,
  (n) => `${n}, j'ai analysé ta situation : tu mérites une deuxième part. C'est scientifique.`,
  // Nouveaux
  (n) => `${n}, j'ai consulté un nutritionniste imaginaire. Il dit : mange.`,
  (n) => `Le régime de demain remercie le repas d'aujourd'hui de ne pas exister, ${n}.`,
  (n) => `${n}, d'après mes recherches approfondies, les calories du dimanche ne comptent pas. C'est prouvé.`,
  (n) => `${n}, tu cuisines, tu goûtes, puis tu manges avant même de servir. C'est humain.`,
  (n) => `Un jour tu seras vieux ${n} et tu regretteras de ne pas avoir mangé ce gratin. Mange le gratin.`,
  (n) => `Les études montrent que les gens heureux mangent mieux ${n}. Sois heureux. Reprends-en.`,
  (n) => `Régime ? Connais pas ${n}. Demande à quelqu'un d'autre.`,
];

const selRepliques = [
  // Originaux
  (n) => `${n} : j'ai analysé ta recette… T'as mis BEAUCOUP trop de sel. La mer du Nord est moins salée.`,
  (n) => `${n} : pas assez de sel ! C'est fade, ça manque de caractère. N'aie pas peur de la salière !`,
  (n) => `${n} : le sel est parfait. Absolument parfait. Bravo, c'est rare.`,
  (n) => `${n} : honnêtement ? Je sais pas trop. T'as goûté toi-même ?`,
  // Nouveaux
  (n) => `${n}, t'as salé l'eau de cuisson au moins ? Non ? Voilà le problème.`,
  (n) => `Trop de sel, pas assez de sel ${n}… à ce stade c'est une question philosophique.`,
  (n) => `Le sel c'est comme l'amour ${n} : trop peu et c'est fade, trop et c'est insupportable.`,
  (n) => `Impeccable ${n}. Je suis bluffé. T'as un don pour le sel.`,
  (n) => `J'ai goûté ${n}. C'est salé. Très salé. Océan Atlantique niveau salé.`,
  (n) => `Aucun sel détecté ${n}. C'est courageux. C'est très courageux.`,
];

const brulerRepliques = [
  // Originaux
  (n) => `💨 Une légère fumée s'échappe de la cuisine de ${n}… puis une autre… *l'alarme retentit* 🔔 C'EST CALCINÉ.`,
  (n) => `🔥 ${n} a décidé que "bien cuit" était une suggestion. Le résultat ? Du charbon de bois gastronomique.`,
  (n) => `😱 Les pompiers signalent une odeur suspecte venant du #cuisine de ${n}. Tout va bien. Probablement.`,
  (n) => `🍳 ${n} a pourtant suivi la recette… mais avait oublié de surveiller la casserole. RIP. Elle est en charbon maintenant.`,
  (n) => `*le détecteur de fumée de ${n} hurle* 📢 C'est pas grave, c'est "caramélisé façon rustique".`,
  // Nouveaux
  (n) => `Les voisins de ${n} ont appelé. Ils demandent si tout va bien. Et si t'as une recette de fumée à partager.`,
  (n) => `Techniquement ${n}, c'est encore comestible. Techniquement.`,
  (n) => `C'est pas brûlé ${n}, c'est une croûte. Une croûte très… très prononcée.`,
  (n) => `Le four a dit non ${n}. La casserole a dit non. Même la spatule a démissionné.`,
  (n) => `On appelle ça de la cuisine fusion ${n} : entre le comestible et le charbon.`,
  (n) => `La bonne nouvelle ${n} : t'as pas besoin de faire du barbecue ce soir, t'en as déjà un dans ta poêle.`,
  (n) => `C'est cuit ${n}. C'est même très cuit. C'est philosophiquement au-delà de cuit.`,
];

const duelCommentaires = [
  // Originaux
  (g,p) => `⚔️ Duel entre les deux candidats : après dégustation à l'aveugle… ${g} l'emporte ! ${p} peut ranger ses couteaux.`,
  (g,p) => `🥊 Combat acharné ! Le jury tranche : victoire de ${g} par K.O. culinaire !`,
  (g,p) => `🍳 Duel épique ! ${p} a bien essayé, mais ${g} a su sublimer les saveurs. Bravo ${g} !`,
  (g,p) => `🏆 ${g} gagne par une très légère avance. ${p} promet sa revanche.`,
  // Nouveaux
  (g,p) => `Jury divisé, ambiance tendue… mais au final un seul peut gagner. Et c'est ${g}. Désolé ${p}.`,
  (g,p) => `Les deux candidats ont donné tout ce qu'ils avaient. ${g} avait un peu plus à donner que ${p}.`,
  (g,p) => `Une larme dans le jury, trois étoiles dans les yeux de ${g}. ${p} garde la tête haute.`,
  (g,p) => `${p} a été très fair-play. ${g} un peu moins. Mais c'est ${g} le gagnant.`,
];

// ─── Initialisation bot ───────────────────────────────────────────────────────
const client = new IRC.Client();

client.connect({
  host: CONFIG.host, port: CONFIG.port,
  nick: CONFIG.nick, username: CONFIG.username, realname: CONFIG.realname,
  account: { account: CONFIG.account, password: CONFIG.password },
  ssl: CONFIG.ssl
});

client.on('registered', () => {
  console.log(`[BOTteDePersil] Connecté en tant que ${CONFIG.nick}`);
  // L'authentification SASL est gérée automatiquement à la connexion
  client.join(CONFIG.channel);
});

// ─── Réponses ChanServ ────────────────────────────────────────────────────────
client.on('notice', (event) => {
  const msg = event.message;
  for (const [key, entry] of pendingAccessChecks.entries()) {
    const { resolve, nick, channel } = entry;
    // Format EuropNet : "5 9999 Thaliane" (index niveau pseudo)
  const mA = msg.match(/^\d+\s+(\d+)\s+(\S+)$/);
    if (mA && mA[2].toLowerCase() === nick.toLowerCase()) {
      pendingAccessChecks.delete(key); resolve(parseInt(mA[1]) >= CONFIG.founderLevel); return;
    }
    // Réponse négative : pas d'entrée trouvée
    const mN = msg.match(/^(\S+)\s+(does not have|has no|n'a pas)\s+access/i);
    if (mN && mN[1].toLowerCase() === nick.toLowerCase()) {
      pendingAccessChecks.delete(key); resolve(false); return;
    }
  }
});

// ─── Rappels automatiques ─────────────────────────────────────────────────────
function envoyerRappel() {
  const data = loadData();
  if (!data.defi || data.defi.clos) return;
  const diffDays = Math.round((dateOnly(data.defi.dateEcheance) - today()) / 86400000);
  if (diffDays === 2)
    client.say(CONFIG.channel, `⏰ Rappel : il reste 2 jours pour soumettre votre participation au défi "${data.defi.theme}" ! Date limite : ${fmtDate(data.defi.dateEcheance)}. Utilisez !participation [lien optionnel].`);
  else if (diffDays === 1)
    client.say(CONFIG.channel, `⚠️ Dernier rappel ! Plus qu'un jour pour participer au défi "${data.defi.theme}". Rendez-vous le ${fmtDate(data.defi.dateVoteDebut)} pour voter.`);
}

cron.schedule('0 10 * * *', envoyerRappel); // Rappel à 10h
cron.schedule('0 18 * * *', envoyerRappel); // Rappel à 18h

// ─── Commandes IRC ────────────────────────────────────────────────────────────
client.on('message', async (event) => {
  if (event.target !== CONFIG.channel) return;
  const nick = event.nick;
  const msg  = event.message.trim();
  const say  = (txt) => client.say(CONFIG.channel, txt);
  const pm   = (txt) => client.say(nick, txt);

  // ══════════════════════════════════════════════════════
  // DÉFIS
  // ══════════════════════════════════════════════════════

  if (msg.startsWith('!defi')) {
    const args = msg.slice(5).trim();
    if (!args) {
      const data = loadData();
      if (!data.defi) { say('Aucun défi en cours. Un founder peut en lancer un avec : !defi <thème> | <YYYY-MM-DD>'); return; }
      const d = data.defi;
      say(`🍽️  Défi en cours : "${d.theme}"`);
      say(`   Proposé par    : ${d.proposePar}`);
      say(`   Rendu avant    : ${fmtDate(d.dateEcheance)}`);
      say(`   Votes          : du ${fmtDate(d.dateVoteDebut)} au ${fmtDate(d.dateVoteFin)}`);
      say(`   Classement     : à partir du ${fmtDate(d.dateClassement)}`);
      return;
    }
    const isFounder = await checkFounder(client, nick, CONFIG.channel);
    if (!isFounder) { say(`${nick} : seul un founder du salon peut lancer un défi.`); return; }
    const parts = args.split('|');
    if (parts.length < 2) { say(`${nick} : format attendu → !defi <thème> | <YYYY-MM-DD>`); return; }
    const theme    = parts[0].trim();
    const echeance = new Date(parts[1].trim());
    if (isNaN(echeance)) { say(`${nick} : date invalide. Format : YYYY-MM-DD`); return; }
    echeance.setHours(23,59,59,0);
    const voteDebut  = new Date(echeance); voteDebut.setDate(voteDebut.getDate()+1);   voteDebut.setHours(0,0,0,0);
    const voteFin    = new Date(echeance); voteFin.setDate(voteFin.getDate()+2);        voteFin.setHours(23,59,59,0);
    const classement = new Date(echeance); classement.setDate(classement.getDate()+3); classement.setHours(0,0,0,0);
    const data = loadData();
    if (data.defi) data.historique.push({ ...data.defi, clos: true });
    let proposePar = nick;
    if (data.historique.length > 0 && data.historique[data.historique.length-1].gagnant)
      proposePar = data.historique[data.historique.length-1].gagnant;
    data.defi = {
      theme, proposePar,
      dateEcheance:  echeance.toISOString(),
      dateVoteDebut: voteDebut.toISOString(),
      dateVoteFin:   voteFin.toISOString(),
      dateClassement:classement.toISOString(),
      inscrits: [], participations: {}, votes: {}, gagnant: null, clos: false,
    };
    saveData(data);
    say(`🎉 Nouveau défi lancé par ${nick} !`);
    say(`   Thème    : "${theme}"`);
    say(`   Rendu    : avant le ${fmtDate(echeance.toISOString())}`);
    say(`   Votes    : du ${fmtDate(voteDebut.toISOString())} au ${fmtDate(voteFin.toISOString())}`);
    say(`   Résultat : le ${fmtDate(classement.toISOString())}`);
    say(`   Inscrivez-vous avec : !inscription`);
    return;
  }

  if (msg === '!inscription') {
    const data = loadData();
    if (!data.defi || data.defi.clos) { say(`${nick} : aucun défi en cours.`); return; }
    if (dateOnly(data.defi.dateEcheance) < today()) { say(`${nick} : les inscriptions sont closes depuis le ${fmtDate(data.defi.dateEcheance)}.`); return; }
    if (data.defi.inscrits.includes(nick)) { say(`${nick} : tu es déjà inscrit(e) au défi "${data.defi.theme}" !`); return; }
    data.defi.inscrits.push(nick);
    saveData(data);
    say(`✅ ${nick} s'est inscrit(e) au défi "${data.defi.theme}" ! Bonne cuisine !`);
    pm(`Tu es bien inscrit(e) au défi "${data.defi.theme}". Soumets ta participation avant le ${fmtDate(data.defi.dateEcheance)} avec : !participation [lien optionnel]`);
    return;
  }

  if (msg === '!liste') {
    const data = loadData();
    if (!data.defi) { say('Aucun défi en cours.'); return; }
    const { inscrits, participations, theme } = data.defi;
    if (inscrits.length === 0) { say(`Aucun participant inscrit au défi "${theme}" pour l'instant.`); return; }
    say(`Participants au défi "${theme}" (${inscrits.length}) : ${inscrits.map(n => `${participations[n]?'✓':'…'} ${n}`).join('  |  ')}`);
    say('Légende : ✓ = participation soumise  |  … = en attente');
    return;
  }

  if (msg.startsWith('!participation')) {
    const data = loadData();
    if (!data.defi || data.defi.clos) { say(`${nick} : aucun défi en cours.`); return; }
    if (!data.defi.inscrits.includes(nick)) { say(`${nick} : tu n'es pas inscrit(e). Utilise d'abord !inscription`); return; }
    if (today() > dateOnly(data.defi.dateEcheance)) { say(`${nick} : la date de rendu est dépassée (${fmtDate(data.defi.dateEcheance)}).`); return; }
    const deja = data.defi.participations[nick];
    data.defi.participations[nick] = { soumisLe: new Date().toISOString() };
    saveData(data);
    say(`📸 ${nick} a signalé sa participation au défi "${data.defi.theme}" !`);
    if (data.photosUrl) {
      pm(`Ta participation est bien enregistrée. Envoie ta photo sur la galerie du défi : ${data.photosUrl}`);
      pm(`Les photos de tous les participants sont visibles à la même adresse.`);
    } else {
      pm(`Ta participation est bien enregistrée. Le lien de la galerie photos n'est pas encore disponible, il te sera communiqué dès que possible.`);
    }
    if (deja) say(`(Participation mise à jour pour ${nick})`);
    return;
  }

  if (msg === '!maparticipation') {
    const data = loadData();
    if (!data.defi) { say(`${nick} : aucun défi en cours.`); return; }
    const p = data.defi.participations[nick];
    if (!p) {
      pm(`Tu n'as pas encore signalé de participation au défi "${data.defi.theme}".`);
      pm(`Utilise !participation pour t'enregistrer.`);
      if (data.photosUrl) pm(`Galerie photos du défi : ${data.photosUrl}`);
      return;
    }
    pm(`Ta participation au défi "${data.defi.theme}" :`);
    pm(`   Enregistrée le : ${fmtDate(p.soumisLe)}`);
    if (data.photosUrl) pm(`   Galerie photos  : ${data.photosUrl}`);
    else pm(`   Galerie photos  : pas encore disponible.`);
    pm(`Tu peux mettre à jour ta participation avec !participation avant le ${fmtDate(data.defi.dateEcheance)}.`);
    return;
  }

  if (msg.startsWith('!vote ')) {
    const cible = msg.slice(6).trim();
    const data  = loadData();
    if (!data.defi || data.defi.clos) { say(`${nick} : aucun défi en cours.`); return; }
    const now = today(), voteDebut = dateOnly(data.defi.dateVoteDebut), voteFin = dateOnly(data.defi.dateVoteFin);
    if (now < voteDebut) {
      const nRendu = Object.keys(data.defi.participations).length;
      if (nRendu < data.defi.inscrits.length)
        say(`${nick} : tous les concurrents n'ont pas encore rendu leur production. Revenez le ${fmtDate(data.defi.dateVoteDebut)} pour voter.`);
      else
        say(`${nick} : la période de vote n'est pas encore ouverte. Revenez le ${fmtDate(data.defi.dateVoteDebut)}.`);
      return;
    }
    if (now > voteFin) { say(`${nick} : la période de vote est terminée depuis le ${fmtDate(data.defi.dateVoteFin)}.`); return; }
    if (!data.defi.inscrits.includes(cible)) { say(`${nick} : "${cible}" n'est pas inscrit(e) à ce défi.`); return; }
    if (cible.toLowerCase() === nick.toLowerCase()) { say(`${nick} : tu ne peux pas voter pour toi-même !`); return; }
    const dejaVote = data.defi.votes[nick];
    data.defi.votes[nick] = cible;
    saveData(data);
    say(dejaVote ? `${nick} : ton vote a été modifié (${dejaVote} → ${cible}).` : `✅ ${nick} a voté pour ${cible} !`);
    return;
  }

  if (msg === '!classement') {
    const data = loadData();
    if (!data.defi) { say('Aucun défi en cours.'); return; }
    if (today() < dateOnly(data.defi.dateClassement)) {
      say(`Les votes ne sont pas encore clos. Revenez le ${fmtDate(data.defi.dateClassement)} pour voir le classement final.`);
      return;
    }
    const compteur = {};
    for (const v in data.defi.votes) { const c = data.defi.votes[v]; compteur[c] = (compteur[c]||0)+1; }
    if (Object.keys(compteur).length === 0) { say(`Aucun vote enregistré pour le défi "${data.defi.theme}".`); return; }
    const sorted  = Object.entries(compteur).sort((a,b) => b[1]-a[1]);
    const gagnant = sorted[0][0];
    const theme   = data.defi.theme;
    say(`🏆 Classement final du défi "${theme}" :`);
    say(sorted.map(([p,v],i) => `${i+1}. ${p} (${v} vote${v>1?'s':''})`).join('  |  '));
    say(`🥇 Félicitations à ${gagnant} ! C'est lui/elle qui proposera le prochain thème.`);
    if (!data.defi.gagnant) {
      data.defi.gagnant = gagnant; data.defi.clos = true;
      data.historique.push({...data.defi}); data.defi = null; saveData(data);
    }
    return;
  }

  if (msg.startsWith('!stats')) {
    const cible = msg.slice(6).trim() || nick;
    const hist  = loadData().historique;
    say(`📊 Stats de ${cible} : ${hist.filter(d=>d.gagnant===cible).length} victoire(s), ${hist.filter(d=>d.inscrits.includes(cible)).length} participation(s), ${hist.reduce((a,d)=>a+Object.values(d.votes||{}).filter(v=>v===cible).length,0)} vote(s) reçu(s).`);
    return;
  }

  if (msg === '!thematiques') {
    const data = loadData();
    if (data.historique.length === 0) { say('Aucun défi passé pour le moment.'); return; }
    say(`📜 Historique des défis (${data.historique.length}) :`);
    data.historique.slice(-8).forEach((d,i) => say(`   ${i+1}. "${d.theme}" — Gagnant : ${d.gagnant||'?'} (rendu le ${fmtDate(d.dateEcheance)})`));
    return;
  }

  if (msg === '!rappel') {
    const data = loadData();
    if (!data.defi || data.defi.clos) { say('Aucun défi en cours.'); return; }
    say(`📅 Rappel — "${data.defi.theme}" : rendu avant le ${fmtDate(data.defi.dateEcheance)}, votes du ${fmtDate(data.defi.dateVoteDebut)} au ${fmtDate(data.defi.dateVoteFin)}, résultat le ${fmtDate(data.defi.dateClassement)}.`);
    return;
  }

  if (msg === '!clore') {
    const isFounder = await checkFounder(client, nick, CONFIG.channel);
    if (!isFounder) { say(`${nick} : commande réservée au founder.`); return; }
    const data = loadData();
    if (!data.defi) { say('Aucun défi en cours.'); return; }
    data.defi.dateEcheance = new Date().toISOString();
    saveData(data);
    say(`${nick} a clôturé manuellement les participations au défi "${data.defi.theme}".`);
    return;
  }

  if (msg.startsWith('!annuler')) {
    const isFounder = await checkFounder(client, nick, CONFIG.channel);
    if (!isFounder) { say(`${nick} : commande réservée au founder.`); return; }
    const raison = msg.slice(8).trim();
    const data   = loadData();
    if (!data.defi) { say('Aucun défi en cours.'); return; }
    const theme = data.defi.theme; data.defi = null; saveData(data);
    say(`⚠️ Le défi "${theme}" a été annulé par ${nick}.${raison?' Raison : '+raison:''}`);
    return;
  }

  // ── !liendefi <url> ───────────────────────────────────────────────────────
  if (msg.startsWith('!liendefi ')) {
    const url = msg.slice(10).trim();
    // Vérifier que l'expéditeur est Electr0nLibre ou un founder
    const isFounder = await checkFounder(client, nick, CONFIG.channel);
    const isElectr0n = nick.toLowerCase() === 'electr0nlibre';
    if (!isFounder && !isElectr0n) {
      say(`${nick} : commande réservée à Electr0nLibre et aux founders du salon.`);
      return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
      say(`${nick} : lien invalide. Format attendu → !liendefi https://...`);
      return;
    }
    const data = loadData();
    if (!data.defi || data.defi.clos) {
      say(`${nick} : aucun défi en cours. Lance d'abord un défi avec !defi`);
      return;
    }
    data.photosUrl = url;
    saveData(data);
    say(`📸 Lien de la galerie photos mis à jour par ${nick} !`);
    say(`   Galerie : ${url}`);
    say(`   Ce lien restera accessible jusqu'à ce qu'un nouveau lien soit défini.`);
    return;
  }

  // ══════════════════════════════════════════════════════
  // FANTAISIE
  // ══════════════════════════════════════════════════════

  if (msg.startsWith('!philippe')) {
    const cible = msg.slice(9).trim() || nick;
    say(pick(philippeRepliques)(cible));
    return;
  }

  if (msg.startsWith('!michelin')) {
    const cible = msg.slice(9).trim() || nick;
    const r     = pick(michelinResultats);
    const label = r.etoiles === 0 ? 'Aucune étoile 🍽️' : `${r.etoiles} étoile${r.etoiles>1?'s':''} ${r.icone}`;
    say(`🔴 Guide Michelin — ${cible} : ${label}`);
    say(`   "${r.commentaire}"`);
    return;
  }

  if (msg === '!frigo') {
    const pool  = [...frigoIngredients];
    const trois = [0,1,2].map(() => { const i = Math.floor(Math.random()*pool.length); return pool.splice(i,1)[0]; });
    say(`🧊 ${nick} ouvre son frigo et trouve : ${trois.join(', ')}.`);
    say(`   Alors ${nick}, qu'est-ce que tu nous concoctes avec ça ? 👀`);
    return;
  }

  if (msg === '!menu') {
    say(`🍽️ Menu du jour spécial BOTteDePersil :`);
    say(`   Entrée  : ${pick(menusEntrees)}`);
    say(`   Plat    : ${pick(menusPlats)}`);
    say(`   Dessert : ${pick(menusDessets)}`);
    say(`   Bon appétit… ou bonne chance. 😬`);
    return;
  }

  if (msg === '!regime') {
    say(pick(regimeRepliques)(nick));
    return;
  }

  if (msg === '!sel') {
    say(pick(selRepliques)(nick));
    return;
  }

  if (msg === '!bruler') {
    say(pick(brulerRepliques)(nick));
    return;
  }

  if (msg.startsWith('!duel ')) {
    const adversaire = msg.slice(6).trim();
    if (adversaire.toLowerCase() === nick.toLowerCase()) {
      say(`${nick} : tu ne peux pas te défier toi-même… ou alors t'as un problème existentiel. 🤔`);
      return;
    }
    const gagnant = Math.random() < 0.5 ? nick : adversaire;
    const perdant = gagnant === nick ? adversaire : nick;
    say(pick(duelCommentaires)(gagnant, perdant));
    return;
  }

  if (msg.startsWith('!note ')) {
    const cible = msg.slice(6).trim();
    const note  = Math.floor(Math.random() * 11);
    const verdict =
      note <= 2  ? '😱 Catastrophique. On a connu mieux dans un avion low-cost.' :
      note <= 4  ? "😕 Moyen. Mangeable, mais on n'en redemandera pas." :
      note <= 6  ? '😐 Correct. Sans prétention mais sans faute majeure.' :
      note <= 8  ? '😊 Bien ! Une belle assiette avec de vraies qualités.' :
      note === 9 ? '🤩 Excellent ! Coup de cœur du jury.' :
                   '🌟 Note parfaite ! Un chef vient de naître.';
    say(`⭐ Note attribuée à ${cible} : ${note}/10 — ${verdict}`);
    return;
  }

  if (msg === '!chapeau') {
    const ingredient = pick(frigoIngredients);
    say(`🎩 ${nick} pioche dans le chapeau et tire : "${ingredient}" !`);
    say(`   Défi surprise : incorpore cet ingrédient dans ta prochaine recette. Bonne chance… 😅`);
    return;
  }

  if (msg === '!inspiration') {
    const idees = [
      "Et si tu revisitais un classique de ta région ?",
      "Essaie d'incorporer une épice que tu n'utilises jamais !",
      "Une recette de grand-mère revisitée en version moderne ?",
      "Pense végétal : un plat 100% légumes peut être spectaculaire.",
      "Et si le thème t'inspirait une recette sucrée-salée ?",
      "Mise sur la présentation : un beau dressage fait toute la différence.",
      "Utilise des restes pour créer quelque chose d'original !",
      "Et si tu cuisinais en t'inspirant d'un pays que tu rêves de visiter ?",
      "Tente une cuisson que tu n'as jamais essayée : vapeur, basse température, plancha…",
      "Et si tu demandais à un proche son plat préféré pour le recréer à ta façon ?",
      "Un ingrédient de saison que tu n'as jamais cuisiné, ça pourrait être le point de départ.",
      "Pense à l'enfance : y a-t-il un goût que tu voudrais retrouver ?",
    ];
    say(`💡 ${nick} : ${pick(idees)}`);
    return;
  }

  // ── !aide ─────────────────────────────────────────────────────────────────
  if (msg === '!aide') {
    pm('━━ BOTteDePersil — Toutes les commandes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    pm('— DÉFIS —');
    pm('!defi                  → Voir le défi en cours');
    pm('!defi <thème> | <date> → Lancer un défi [founder — date : YYYY-MM-DD]');
    pm('!inscription           → S\'inscrire au défi');
    pm('!liste                 → Voir les participants et leur état');
    pm('!participation [lien]  → Soumettre sa participation (lien optionnel)');
    pm('!maparticipation       → Voir / modifier sa participation');
    pm('!vote <pseudo>         → Voter (pendant la période de vote uniquement)');
    pm('!classement            → Classement final (après clôture des votes)');
    pm('!thematiques           → Historique des défis passés');
    pm('!stats [pseudo]        → Victoires, participations, votes reçus');
    pm('!rappel                → Rappel des dates du défi en cours');
    pm('!clore                 → Clôturer les participations [founder]');
    pm('!annuler [raison]      → Annuler le défi en cours [founder]');
    pm('!liendefi <url>        → Définir la galerie photos du défi [founder / Electr0nLibre]');
    pm('— FANTAISIE —');
    pm('!philippe [pseudo]     → Philippe Etchebest donne son avis (sans filtre)');
    pm('!michelin [pseudo]     → Le Guide Michelin attribue ses étoiles');
    pm('!frigo                 → Ouvrir le frigo et trouver 3 ingrédients mystère');
    pm('!menu                  → Générer un menu du jour… original');
    pm('!regime                → Le bot te dit si tu devrais te retenir (spoiler : non)');
    pm('!sel                   → Le bot analyse ton dosage en sel');
    pm('!bruler                → Quand la recette part en fumée');
    pm('!duel <pseudo>         → Défier quelqu\'un à un combat de cuisine');
    pm('!note <pseudo>         → Attribuer une note à quelqu\'un');
    pm('!chapeau               → Tirer un ingrédient surprise');
    pm('!inspiration           → Une idée pour ta prochaine recette');
    pm('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return;
  }
});

client.on('close', () => console.log('[BOTteDePersil] Déconnecté.'));
