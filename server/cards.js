'use strict';
// Dati delle carte di ESCALATION. Tutti i contenuti sono originali.
// Copie tarate per tavoli fino a 6: filler più numerosi, minacce uniche 1×.
// Aprendo un ticket solo le Minacce si affrontano subito: ogni altra carta, Sfighe comprese, va in mano.
// Ogni ruolo ha un punto debole (vs: la minaccia è più forte contro quel ruolo); Red Teamer e Sysadmin hanno anche un asset che con loro vale di più.

const TITLES = ['', 'guest', 'stagista', 'utente', 'power user', 'helpdesk', 'tecnico', 'senior', 'domain admin', 'enterprise admin', 'root'];
const SLOTS = { hw: 'Hardware', sw: 'Software', cr: 'Credenziali', gd: 'Gadget' };
const ROLES = {
  red: { name: 'Red Teamer', text: 'Vinci anche i pareggi in combattimento.' },
  sys: { name: 'Sysadmin', text: 'La fuga riesce con 3 o più invece che con 5.' },
  blue: { name: 'Blue Teamer', text: 'La prima Sfiga che un avversario ti gioca in ogni giro viene bloccata.' },
  social: { name: 'Ingegnere sociale', text: 'I tuoi sabotaggi non aumentano l\'Esposizione.' }
};

const THREATS = [
  { n: 'Popup «riavvia per aggiornare»', l: 1, tr: 1, lv: 1, bad: [{ k: 'penalty', n: 2 }], d: 'Rimandato 47 volte. Oggi parte da solo, durante la demo al cliente.' },
  { n: 'Password su un post-it', l: 1, tr: 1, lv: 1, bad: [{ k: 'give', s: 'cr' }, { k: 'hand', n: 1 }], d: 'Angolo in basso a sinistra del monitor. Come sempre.' },
  { n: 'Banner cookie infinito', l: 1, tr: 1, lv: 1, bad: [{ k: 'hand', n: 1 }], d: '«Accetta tutti.» Non c\'è «rifiuta». C\'è solo «gestisci» che riporta ad «accetta».' },
  { n: 'Stagista con privilegi admin', l: 2, tr: 1, lv: 1, bad: [{ k: 'give' }], d: 'Gliel\'hanno dati «per fare prima».' },
  { n: 'Certificato SSL scaduto', l: 2, tr: 1, lv: 1, bad: [{ k: 'slot', s: 'sw' }], d: 'Scaduto ieri. Il promemoria arrivava a chi si è dimesso.' },
  { n: 'Stampante di rete senziente', l: 2, tr: 1, lv: 1, bad: [{ k: 'slot', s: 'hw' }], d: 'Ha un IP pubblico e un conto in sospeso con te.' },
  { n: 'Shared mailbox orfana', l: 2, tr: 1, lv: 1, bad: [{ k: 'hand', n: 1 }], d: 'Nessun owner. Ventimila unread. Qualcuno risponde ancora «cordiali saluti».' },
  { n: 'Wi-Fi ospiti senza password', l: 3, tr: 1, lv: 1, bad: [{ k: 'robbed', n: 1 }], d: 'SSID: «Azienda_Guest». Password: nessuna. Banda: tutta.' },
  { n: 'Riunione che poteva essere una mail', l: 3, tr: 1, lv: 1, bad: [{ k: 'skip' }], d: 'Novanta minuti, nessun ordine del giorno, tre «ci aggiorniamo».', flee: 1 },
  { n: 'Macro Excel del 2003', l: 3, tr: 1, lv: 1, bad: [{ k: 'slot', s: 'cr' }], d: 'Il file si chiama FINALE_def_v7_usaquesta_NONTOCCARE.xls.' },
  { n: '@channel alle 18:01', l: 3, tr: 1, lv: 1, bad: [{ k: 'all', n: 1 }], d: '«Scusate il disturbo.» Disturbo accettato da 400 persone.' },
  { n: 'Fax ancora collegato in rete', l: 4, tr: 2, lv: 1, bad: [{ k: 'slot', s: 'hw' }], d: 'Nessuno lo usa dal 2009. È ancora acceso.' },
  { n: 'Utente che clicca tutto', l: 4, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }], d: 'Ha vinto un telefono. Per la terza volta questa settimana.', vs: { role: 'blue', n: 3 } },
  { n: 'Bug che sparisce in debug', l: 4, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }], d: 'Se lo guardi non c\'è. Se vai in ferie sì.', flee: -1 },
  { n: 'Condivisione schermo col tab sbagliato', l: 4, tr: 2, lv: 1, bad: [{ k: 'esp', n: 2 }], d: 'La slide era pronta. La chat privata no.' },
  { n: 'Captcha infinito', l: 5, tr: 2, lv: 1, bad: [{ k: 'hand', n: 3 }], d: 'Seleziona tutti i semafori. E ancora. E ancora.' },
  { n: 'VPN che cade solo a te', l: 5, tr: 2, lv: 1, bad: [{ k: 'slot', s: 'gd' }], d: 'Agli altri funziona. Al supporto «non riusciamo a riprodurre».' },
  { n: 'Ticket in Waiting for customer dal 2022', l: 5, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }], d: 'Il customer sei tu. Non lo sapevi.' },
  { n: 'Cryptominer nel tostapane', l: 6, tr: 2, lv: 1, bad: [{ k: 'slot', s: 'hw' }, { k: 'credit' }], d: 'Il pane resta freddo, la bolletta no.' },
  { n: 'Shadow IT del Marketing', l: 6, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }, { k: 'esp', n: 1 }], d: 'Sette SaaS, una carta aziendale, zero DPA. Lo scoprirete dal Garante.' },
  { n: 'LLM che allucina in produzione', l: 6, tr: 2, lv: 1, bad: [{ k: 'swapHand' }], d: 'Ha inventato una policy. Ora è ufficiale. È anche sbagliata.' },
  { n: 'Excel di dati personali in «Rispondi a tutti»', l: 7, tr: 2, lv: 1, bad: [{ k: 'esp', n: 2 }, { k: 'slot', s: 'cr' }], d: 'Hai 72 ore per notificare. Ne sono già passate 71.' },
  { n: 'Consulente del «è un attimo»', l: 7, tr: 2, lv: 1, bad: [{ k: 'credit' }, { k: 'best' }], d: 'Fattura a ore. Gli attimi sono tanti.' },
  { n: 'Repo pubblico con il .env', l: 7, tr: 2, lv: 1, bad: [{ k: 'give', s: 'cr' }, { k: 'lvl', n: 1 }], d: 'Star: 2. Fork: 1. Secrets: tutti. Commit: «fix typo».' },
  { n: 'Botnet di frigoriferi', l: 8, tr: 3, lv: 1, bad: [{ k: 'lvl', n: 1 }, { k: 'hand', n: 2 }], d: 'Ventimila frigoriferi smart, tutti contro di te.' },
  { n: 'Backup mai testato', l: 8, tr: 3, lv: 1, bad: [{ k: 'gearAll' }], d: 'Esiste. Funziona? Lo scopri adesso. Ultimo restore riuscito: mai.', vs: { role: 'sys', n: 2 } },
  { n: 'Cluster Kubernetes senza owner', l: 8, tr: 3, lv: 1, bad: [{ k: 'slot', s: 'sw' }, { k: 'lvl', n: 1 }], d: 'Gira da tre anni. Il YAML è firmato «tmp».' },
  { n: 'Rilascio in produzione di venerdì', l: 9, tr: 3, lv: 1, bad: [{ k: 'best' }, { k: 'skip' }], d: '«È una modifica piccola.» Firmato: nessuno. Rollback: non previsto.' },
  { n: 'Fornitore unico «certificato»', l: 9, tr: 3, lv: 1, bad: [{ k: 'lvl', n: 2 }], d: 'Il certificato è un PDF del 2017. Lo scope è la macchinetta del caffè.' },
  { n: 'Email «URGENTE» senza priorità', l: 9, tr: 3, lv: 1, bad: [{ k: 'penalty', n: 3 }], d: 'Oggetto in maiuscolo. Corpo: «quando puoi». Allegato: 40 MB.' },
  { n: 'Auditor a fine trimestre', l: 10, tr: 3, lv: 1, bad: [{ k: 'esp', n: 2 }, { k: 'role' }], d: 'Vuole tutte le evidenze. Entro domani. In PDF firmato digitalmente.', vs: { role: 'social', n: 4 } },
  { n: 'Richiesta GDPR del lunedì mattina', l: 10, tr: 3, lv: 1, bad: [{ k: 'hand', n: 99 }], d: 'Vuole «tutti i suoi dati». Entro 30 giorni. Sono le 9:12.' },
  { n: 'Ransomware con assistenza clienti', l: 11, tr: 3, lv: 2, bad: [{ k: 'lvl', n: 2 }, { k: 'slot', s: 'cr' }], d: 'Chat h24, FAQ chiare, sconto se paghi entro 48 ore.' },
  { n: 'Mainframe COBOL immortale', l: 12, tr: 3, lv: 2, bad: [{ k: 'lvl', n: 2 }], d: 'È più vecchio del tuo capo e gli sopravviverà.', flee: 1 },
  { n: 'Phishing che ha fregato il CFO', l: 13, tr: 4, lv: 2, bad: [{ k: 'best' }, { k: 'lvl', n: 1 }], d: 'Il bonifico è partito. La mail era quasi perfetta. Il CFO «aveva fretta».' },
  { n: 'Insider con badge e rancore', l: 14, tr: 4, lv: 2, bad: [{ k: 'give', s: 'best' }, { k: 'gearAll' }], d: 'Conosce le password. Le ha scelte lui.' },
  { n: 'APT finanziata da uno Stato', l: 15, tr: 4, lv: 2, bad: [{ k: 'lvl', n: 3 }], d: 'Paziente, ben pagata, nella tua rete dal 2019. Ha anche il badge mensa.' },
  { n: 'Zero-day del venerdì alle 17:59', l: 18, tr: 5, lv: 2, bad: [{ k: 'wipe' }], d: 'Formattazione completa. Buon weekend.' }
];

const CURSES = [
  { n: 'Reset password obbligatorio', bad: [{ k: 'lvl', n: 1 }], d: 'Dodici caratteri, un simbolo, nessuna delle ultime 24. Diventa «Estate2025!!».', c: 2 },
  { n: 'Laptop ritirato dall\'IT', bad: [{ k: 'slot', s: 'hw' }], d: '«Te lo ridiamo martedì.» Non dicono quale.', c: 1 },
  { n: 'Licenza scaduta', bad: [{ k: 'slot', s: 'sw' }], d: 'Il rinnovo era in approvazione dal CFO. Dal 2023.', c: 1 },
  { n: 'Credenziali in un data leak', bad: [{ k: 'slot', s: 'cr' }], d: 'Ora le conosce mezzo internet.', c: 1 },
  { n: 'Riorganizzazione aziendale', bad: [{ k: 'swapRole' }], d: 'Il tuo ruolo non esiste più. Nemmeno il tuo ufficio.', c: 1 },
  { n: 'In copia su 140 mail', bad: [{ k: 'hand', n: 2 }], d: 'Tutte con «URGENTE» nell\'oggetto.', c: 2 },
  { n: 'Corso obbligatorio di sicurezza', bad: [{ k: 'skip' }], d: 'Quarantacinque minuti di video. Il quiz finale si passa tirando a caso.', c: 1 },
  { n: 'Migrazione al nuovo gestionale', bad: [{ k: 'penalty', n: 2 }], d: 'Tutto come prima, ma con il triplo dei clic.', c: 1 },
  { n: 'Revisione degli accessi', bad: [{ k: 'best' }], d: 'Qualcuno ha finalmente letto i log.', c: 1 },
  { n: 'Policy di gruppo restrittiva', bad: [{ k: 'penalty', n: 3 }], d: 'Non puoi installare niente. Nemmeno il buonumore.', c: 1 },
  { n: 'MFA sul telefono vecchio', bad: [{ k: 'slot', s: 'gd' }], d: 'L\'SMS arriva su un Nokia in un cassetto. In un altro ufficio.', c: 1 },
  { n: 'Hot desk senza monitor', bad: [{ k: 'unequip' }], d: 'Hai un posto. Teoricamente. Il monitor no.', c: 2 },
  { n: 'Shoulder surfing', bad: [{ k: 'steal', n: 1 }], d: 'In treno, schermo a luminosità massima. Il vicino ringrazia.', c: 2 },
  { n: 'Passaggio di consegne', bad: [{ k: 'handover' }], d: '«Ti lascio tutto in ordine.» Un file di testo. Vuoto.', c: 1 }
];

const BOOSTS = [
  { n: 'Patch mai applicata', amt: 5, tr: 1, c: 2, d: 'In coda dal 2021.' },
  { n: 'Zero-day fresco', amt: 10, tr: 2, c: 2, d: 'Appena uscito da un forum che non nomineremo.' },
  { n: 'Versione beta', amt: -5, tr: -1, c: 2, d: 'Si pianta da sola. Più debole, ma rende meno.' },
  { n: 'Priorità dal CEO', amt: 4, tr: 1, lv: 1, c: 2, d: 'Oggetto: «URGENTISSIMO». Testo: «vedi sopra». Sopra non c\'è niente.' }
];

// Carte speciali: ognuna ha una regola sua (fx), applicata da game.js in t_<fx>.
// Mazzo Ticket, Interferenze: [fx, nome, copie, testo]
const TRICKS_T = [
  ['poach', '«Hai un minuto?»', 2, 'Non era un minuto. Non lo è mai.'],
  ['freeze', 'Change freeze', 2, 'Fino a lunedì non si tocca niente. Nemmeno quello che è rotto.'],
  ['honeypot', 'Honeypot', 2, 'Sembrava un server dimenticato. Aveva i log accesi.'],
  ['falsepos', 'Falso positivo', 2, 'Il SOC chiude il ticket: non era niente. Forse.'],
  // ispirate alle carte di Munchkin che cambiano un combattimento (meccaniche, testi originali)
  ['mate', 'Il malware era nel backup', 2, 'Ripristino completato. Anche lui.'],
  ['double', 'Pair programming', 2, 'Due tastiere, un cervello solo. Stavolta basta.'],
  ['standoff', 'Escalation al management', 1, 'Sentite le parti, il management decide di non decidere.'],
  ['lunch', 'Pausa pranzo', 2, 'È l\'una. Anche gli attaccanti mangiano.'],
  ['cascade', 'Alert a cascata', 2, 'Un alert ne apre un altro. Che ne apre un altro.']
];
// Mazzo Asset, Uso singolo: [fx, nome, copie, valore, testo]
const TRICKS_A = [
  ['oncall', 'Turno di reperibilità', 2, 300, 'Era nel contratto. Pagina 14, corpo 6.'],
  ['scapegoat', 'Capro espiatorio', 2, 300, 'Nel post-mortem c\'è un solo nome. Non è il tuo.'],
  ['ooo', 'Risposta automatica', 2, 200, '«Sono fuori ufficio. Per urgenze, rivolgersi al mittente.»'],
  ['ai', 'Chiedo all\'IA', 3, 200, 'Risponde subito e con grande sicurezza. È questo che preoccupa.'],
  ['reboot', 'Spegni e riaccendi', 2, 200, 'Il rimedio più antico del mestiere. Funziona ancora.'],
  ['reassign', 'Riassegnazione del ticket', 2, 400, '«Non è di mia competenza.» Ora è della tua.']
];
// Cosa fa ogni carta speciale, in una riga: la leggono scheda, wiki e registro.
const TRICK_TEXT = {
  poach: 'In un combattimento: l\'aiutante se ne va e non incassa niente. È un sabotaggio: +1 Esposizione.',
  freeze: 'A finestra aperta: da questo momento nessuno gioca più carte, Sfighe o richieste di aiuto. Si può solo passare. Non vale se chi combatte sta per arrivare a root.',
  honeypot: 'In un combattimento: annulla l\'ultimo sabotaggio. Chi l\'aveva giocato prende +1 Esposizione in più.',
  falsepos: 'Annulla il combattimento in corso: nessun premio e nessuna penalità. Se toglie una vittoria a un altro è un sabotaggio, e non ferma chi sta per arrivare a root.',
  oncall: 'Quando combatti: un giocatore a tua scelta ti aiuta gratis, senza poter rifiutare.',
  scapegoat: 'Quando devi fuggire: tiri il dado, ma se ti prendono la penalità la paga un giocatore a tua scelta. +1 Esposizione.',
  ooo: 'In qualsiasi momento: fino al tuo prossimo turno, la prima Sfiga che ti giocano torna a chi l\'ha mandata.',
  ai: 'In un combattimento, a una delle due parti: tira un dado. 1: −3 (allucinazione). Da 2 a 5: + il numero uscito. 6: +8.',
  reboot: 'In un combattimento: azzera tutti i bonus e le interferenze giocati finora, da entrambe le parti.',
  reassign: 'Appena inizi un combattimento: lo passi a un altro giocatore, che lo affronta al posto tuo con premi e penalità. +1 Esposizione.',
  mate: 'In un combattimento: l\'ultima Minaccia entrata si duplica, con le sue interferenze. Forza, livelli e tesori raddoppiano. Sul combattimento di un altro è un sabotaggio.',
  double: 'In un combattimento: la forza di chi combatte (livello e asset, senza bonus né aiutante) conta doppio. Una sola volta per combattimento.',
  standoff: 'A finestra aperta: la Minaccia prende esattamente la forza di chi combatte. Il pareggio lo vince la Minaccia. Vale anche contro chi sta per arrivare a root.',
  lunch: 'In un combattimento: la Minaccia va a pranzo. Chi combatte incassa i tesori ma non i livelli. Se la gioca un altro è un sabotaggio, e non ferma chi sta per arrivare a root.',
  cascade: 'In un combattimento: si scoprono carte dal mazzo Ticket finché esce una Minaccia, che entra nello scontro. Le altre vanno negli scarti. Sul combattimento di un altro è un sabotaggio.'
};
const SLOT_NAMES = { hw: 'Hardware', sw: 'Software', cr: 'Credenziali', gd: 'Gadget' };
const plur = (n, a, b) => (n === 1 ? a : b);
// Testo delle penalità: unica fonte per server e client (ogni carta lo porta con sé in `bt`).
function badText(effects) {
  return effects.map(e => {
    switch (e.k) {
      case 'lvl': return `perdi ${e.n} ${plur(e.n, 'livello', 'livelli')}`;
      case 'slot': return `perdi l'asset ${SLOT_NAMES[e.s]}`;
      case 'hand': return e.n >= 99 ? 'scarti tutta la mano' : `scarti ${e.n} ${plur(e.n, 'carta', 'carte')} a caso`;
      case 'gearAll': return 'perdi tutto l\'equipaggiamento';
      case 'role': return 'perdi il ruolo';
      case 'best': return 'perdi l\'asset con il bonus più alto';
      case 'penalty': return `−${e.n} al prossimo combattimento`;
      case 'wipe': return 'perdi equipaggiamento, ruolo e mano';
      case 'skip': return 'salti il prossimo turno';
      case 'esp': return `+${e.n} Esposizione`;
      case 'credit': return 'perdi tutto il credito';
      case 'robbed': return `un avversario a caso ti prende ${e.n} ${plur(e.n, 'carta', 'carte')}`;
      case 'give': return e.s === 'best' ? 'il tuo asset migliore passa a un avversario a caso' : e.s ? `l'asset ${SLOT_NAMES[e.s]} passa a un avversario a caso` : 'un tuo asset a caso passa a un avversario a caso';
      case 'all': return `tutti i giocatori scartano ${e.n} ${plur(e.n, 'carta', 'carte')}, tu compreso`;
      case 'swapHand': return 'scambi la mano con un avversario a caso';
      case 'unequip': return 'il tuo asset migliore torna in mano';
      case 'steal': return `chi la gioca ti prende ${e.n} ${plur(e.n, 'carta', 'carte')} a caso`;
      case 'swapRole': return 'scambi il ruolo con chi la gioca';
      case 'handover': return 'scambi la mano con chi la gioca';
    }
    return '';
  }).join(', ');
}

// [slot, nome, bonus, valore, testo, copie, roleBonus?]
const GEAR = [
  ['hw', 'Laptop pieno di adesivi', 1, 200, 'Uno dice «I ♥ sudo».', 2],
  ['hw', 'Raspberry Pi nel controsoffitto', 2, 300, 'Nessuno sa chi l\'ha messo lì.', 2],
  ['hw', 'Workstation con GPU da mutuo', 3, 600, 'D\'inverno scalda l\'ufficio.', 2],
  ['hw', 'Chiavetta USB trovata nel parcheggio', 2, 100, 'Cosa potrebbe andare storto?', 2],
  ['sw', 'Script Bash non commentato', 1, 100, 'Funziona. Nessuno sa perché.', 2, { role: 'sys', n: 2 }],
  ['sw', 'Regex che capisci solo tu', 2, 300, 'Scritta da te, letta da nessuno.', 2],
  ['sw', 'Firewall configurato a mano', 2, 400, 'Ottocento regole, tre in conflitto.', 2],
  ['sw', 'EDR in modalità paranoia', 3, 600, 'Blocca anche te. Soprattutto te.', 2],
  ['cr', 'Password «Estate2024!»', 1, 100, 'Valida fino alla prossima estate.', 3],
  ['cr', 'Token di servizio mai ruotato', 2, 400, 'L\'ha creato il tuo predecessore.', 2],
  ['cr', 'Domain admin dimenticato', 3, 700, 'Ultimo accesso: mai. Ultimo audit: mai.', 2],
  ['gd', 'Tazza «Sulla mia macchina va»', 1, 200, 'Prova inconfutabile.', 2],
  ['gd', 'Cuffie antirumore', 2, 300, 'Il segnale universale per «non ora».', 1],
  ['gd', 'Badge clonato', 2, 400, 'Apre anche la sala server.', 2],
  ['gd', 'Felpa col cappuccio d\'ordinanza', 1, 200, 'Il cappuccio si alza quando parte lo scan.', 2, { role: 'red', n: 2 }],
  ['gd', 'Tastiera meccanica da open space', 1, 200, 'Ogni tasto è un annuncio pubblico.', 2],
  ['gd', 'Torre di post-it «TODO»', 1, 100, 'Il debito tecnico in forma cartacea.', 1]
];

// [nome, bonus, valore, copie, testo]
const ONESHOTS = [
  ['Caffè della macchinetta', 2, 100, 3, 'Sa di plastica e di speranza.'],
  ['Energy drink alle 3 di notte', 3, 200, 3, 'Il cuore ringrazia. Più tardi.'],
  ['Risposta copiata da un forum', 3, 300, 2, 'Accettata nel 2012, ancora valida.'],
  ['Prompt scritto bene', 4, 300, 2, 'Contesto, vincoli, esempi. Funziona.'],
  ['Chiamata al supporto del vendor', 5, 400, 2, 'Dopo 40 minuti di musica d\'attesa.'],
  ['Screenshot come documentazione', 2, 100, 3, 'Pixelati, tagliati, perfetti. Per chi c\'era.']
];

const LEVELUPS = [
  ['Certificazione appena presa', 'È costata quanto un monolocale.', 3],
  ['Hai sistemato la stampante del CEO', 'Ora ti chiamano «il genio».', 3],
  ['Promozione per anzianità', 'Nessuno sa cosa fai, ma lo fai da tanto.', 3]
];

// Battute dei fumetti. Il fumetto le attribuisce a chi ha appena agito, quindi sono in prima persona
// (tranne audit, che esce senza mittente). Il motore le pesca da un sacchetto: tutte le battute di un
// tipo escono una volta prima che una si ripeta, quindi i tipi più frequenti (win, loot) ne hanno di più.
// 'evento:chiave' vince sul generico: chiave = nome carta (sabotage) o primo effetto della minaccia (fleeKo).
// Non iniziare con « né finire con »: il client li toglie.
const QUIPS = {
  fleeOk: [
    'Riassegno al secondo livello e chiudo la chat.',
    'Chiudo come «non riproducibile» e cambio piano.',
    'Mi è caduta la VPN. Per una volta, al momento giusto.',
    'Esco dalla porta antincendio: l\'unica senza lettore badge.',
    'Ufficialmente sono in ferie. C\'è anche la risposta automatica.',
    'Webcam spenta, microfono muto: io qui non ci sono mai stato.',
    'Giro la chiamata a un collega e mi metto su «occupato».',
    'Lo escalo al vendor. Ticket loro, problema loro.'
  ],
  fleeKo: [
    'Mi hanno trovato in pausa caffè. Con la webcam accesa.',
    'Il CAB ha respinto la mia fuga: mancava il change.'
  ],
  'fleeKo:lvl': [
    'Declassato. Torno a chiedere all\'helpdesk come si stampa.',
    'Privilegi revocati. Almeno il badge mensa funziona ancora.',
    'Retrocesso. Il mio accesso admin ora è un PDF in sola lettura.',
    'Mi hanno tolto un livello e assegnato un corso obbligatorio.'
  ],
  'fleeKo:hw': [
    'Mi ritirano l\'hardware. Mi lasciano l\'alimentatore, per ricordo.',
    'Portatile sequestrato. Lavoro dal telefono, come i commerciali.',
    'Hardware requisito. In cambio un muletto del 2014, senza la «E».'
  ],
  'fleeKo:sw': [
    'Software disinstallato da remoto. Senza preavviso, come da tradizione.',
    'Licenza revocata. Torno a lavorare in Blocco note.',
    'Mi hanno tolto il software. Resta l\'icona sul desktop, per nostalgia.'
  ],
  'fleeKo:cr': [
    'Credenziali bruciate. La nuova è la vecchia con un «1» in fondo.',
    'Password compromessa. Ristampo il post-it.',
    'Account bloccato. Per sbloccarlo serve un ticket. Per il ticket serve l\'account.'
  ],
  'fleeKo:gd': [
    'Gadget confiscato. Ora la scrivania sembra quella di un consulente.',
    'Gadget requisito. Motivo ufficiale: «non conforme alla policy».'
  ],
  'fleeKo:hand': [
    'Si è chiuso tutto senza salvare.',
    'Il browser si è riavviato da solo. Addio quaranta schede.',
    'Sessione scaduta. Era tutto in un form non salvato.'
  ],
  'fleeKo:gearAll': [
    'Postazione ripristinata da immagine. La mia roba, nell\'immagine, non c\'era.',
    'Mi hanno riportato alle impostazioni di fabbrica.'
  ],
  'fleeKo:role': [
    'Il mio ruolo è stato «ridefinito». Nessuno sa in cosa.',
    'Nell\'organigramma ora risulto «da definire».'
  ],
  'fleeKo:best': [
    'Si sono presi il pezzo migliore. Il resto, dicono, è debito tecnico.',
    'Hanno buon occhio: era l\'unico asset che funzionava.'
  ],
  'fleeKo:penalty': [
    'Da oggi lavoro in modalità provvisoria.',
    'Mi hanno messo in rate limit. Anche sui pensieri.',
    'Mi porto dietro gli strascichi, come dopo ogni migrazione.'
  ],
  'fleeKo:skip': [
    'Bloccato in call. Il prossimo turno lo seguo «in ascolto».',
    'Mi hanno messo un invito ricorrente. Ci vediamo tra un giro.',
    'Salto un turno: risulto «in allineamento».'
  ],
  'fleeKo:esp': [
    'Ora nei log c\'è il mio nome. In grassetto.',
    'Ho lasciato tracce ovunque. Anche nella chat sbagliata.',
    'Il SOC mi segue. E non sui social.'
  ],
  'fleeKo:credit': [
    'Budget azzerato. Mi restano i buoni pasto.',
    'È arrivata la fattura. Era intestata a me.'
  ],
  'fleeKo:robbed': [
    'Qualcuno si è servito. Senza aprire un ticket.',
    'Mi hanno alleggerito la mano. Lo chiamano «riuso».'
  ],
  'fleeKo:give': [
    'Il mio asset ha cambiato proprietario. Senza change request.',
    'Riassegnato a un collega. L\'asset, non il problema.',
    'Era mio. Ora è «patrimonio condiviso».'
  ],
  'fleeKo:all': [
    'Scusate tutti. Davvero. Era «rispondi a tutti».',
    'Ho disturbato l\'intero tavolo. In un colpo solo.'
  ],
  'fleeKo:swapHand': [
    'Queste carte non sono le mie. Il modello giura di sì.',
    'Mi ha scambiato i dati con quelli di un altro. Con sicurezza.'
  ],
  'fleeKo:wipe': [
    'Formattato. Il backup? Era sullo stesso disco.',
    'Ripartito da zero. Mi chiedono se sono il nuovo stagista.'
  ],
  win: [
    'Ticket chiuso. Causa principale: errore utente. Come sempre.',
    'Ho spento e riacceso. Il resto è leggenda.',
    'Funziona e non so perché. Nessuno tocchi più niente.',
    'Risolto. Documentazione: «sistemato».',
    'Chiuso alle 18:02. Lo scrivo in grassetto nella mail di recap.',
    'Chiuso con nota «non si riproduce più». Incrociamo le dita.',
    'Era il DNS. È sempre il DNS.',
    'Risolto in produzione, testato mai. Come da roadmap.',
    'Fix di una riga. Le altre trecento del commit sono indentazione.',
    'Workaround applicato. Da oggi si chiama «soluzione definitiva».',
    'Sistemato. Ho anche aggiornato la wiki. Scherzo.',
    'Chiuso prima dello SLA. Segnatevi la data.',
    'Bastava leggere il messaggio di errore. L\'ho letto io.',
    'Chiuso. Soddisfazione del cliente: «non ha risposto al sondaggio».',
    'L\'ho risolto in call, col microfono muto. Non lo saprà mai nessuno.',
    'Chiuso. Il post-mortem lo scrive chi arriva ultimo in riunione.'
  ],
  audit: [
    'Il SOC ha letto i log. Tutti. Anche quelli cancellati.',
    'Convocazione per un «caffè veloce» con l\'Internal Audit.',
    'Nel SIEM c\'è una dashboard con il suo nome.',
    'Alert critico: assegnatario e causa sono la stessa persona.',
    'Il report dell\'audit ha un capitolo dedicato. Con gli screenshot.',
    'Accessi alle 3 di notte da tre continenti. «Ero in VPN» non ha convinto nessuno.',
    'La regola di correlazione è scattata. Per una volta funzionava.'
  ],
  sabotage: [
    'Non è un sabotaggio, è un penetration test non concordato.',
    'Lo metto a verbale come «collaborazione tra team».'
  ],
  'sabotage:Patch mai applicata': [
    'La patch? In coda dal 2021, come da procedura.',
    'La patch c\'era. Ho preferito non disturbare la produzione.',
    'Ho rimandato io l\'aggiornamento. Per il tuo bene.'
  ],
  'sabotage:Zero-day fresco': [
    'Appena sfornato. Il vendor lo scoprirà dal tuo post-mortem.',
    'Zero-day di giornata. Il CVE lo intitolano a te.',
    'Nessuna firma, nessuna patch, nessuna pietà.'
  ],
  'sabotage:Movimento laterale': [
    'Pivot sul tuo host. Niente di personale.',
    'Era nella mia rete. Ora è nella tua: si chiama condivisione.',
    'Le ho passato le tue credenziali. Così facciamo prima.'
  ],
  'sabotage:Caffè della macchinetta': [
    'Offro io il caffè. Alla minaccia.',
    'Un caffè anche per lei: deve restare sveglia fino al tuo rollback.'
  ],
  'sabotage:Energy drink alle 3 di notte': [
    'Energy drink alla minaccia: stanotte non dormite in due.',
    'Una lattina anche a lei. Ora lavora di notte, a differenza tua.'
  ],
  'sabotage:Risposta copiata da un forum': [
    'Ho postato la soluzione sul forum. L\'ha letta prima lei.',
    'La risposta accettata sul forum era la mia. Ed era per lei.'
  ],
  'sabotage:Prompt scritto bene': [
    'Ho scritto un prompt perfetto. Per la minaccia.',
    'Prompt con contesto, vincoli ed esempi. L\'esempio eri tu.'
  ],
  'sabotage:Chiamata al supporto del vendor': [
    'Il vendor ha risposto al primo squillo. Alla minaccia.',
    'Ho aperto una chiamata al vendor a nome tuo. Per conto della minaccia.'
  ],
  'sabotage:Screenshot come documentazione': [
    'Ho girato alla minaccia lo screenshot della tua configurazione.',
    'Le ho mandato uno screenshot. Si leggeva la tua password.'
  ],
  'sabotage:Priorità dal CEO': [
    'Ho messo il CEO in copia. Adesso è una priorità.',
    'L\'ho segnalato ai piani alti. Per darti visibilità.'
  ],
  // carte speciali: la battuta è di chi le gioca
  'trick:poach': [
    'Te lo rubo un attimo. Torna quando hai finito di perdere.',
    'Hai un minuto? Ecco, per te non ce l\'ha più.'
  ],
  'trick:freeze': [
    'Change freeze. Da ora si guarda e basta.',
    'Congelato tutto. Le lamentele al CAB, giovedì.'
  ],
  'trick:honeypot': [
    'Bel sabotaggio. Peccato fosse il mio honeypot.',
    'Grazie del tentativo: è tutto nei log.'
  ],
  'trick:falsepos': [
    'Falso positivo. Chiudo e andiamo tutti a pranzo.',
    'Non era una minaccia. Era una feature.'
  ],
  'trick:oncall': [
    'Sei reperibile. L\'ho deciso io, adesso.',
    'Ti ho messo in turno. Gratis, come da contratto.'
  ],
  'trick:scapegoat': [
    'È stato lui. Ho gli screenshot.',
    'Nel post-mortem ho scritto il tuo nome. Con affetto.'
  ],
  'trick:ooo': [
    'Fuori ufficio. Le Sfighe tornano al mittente.',
    'Risposta automatica attivata. Arrangiatevi.'
  ],
  'trick:ai': [
    'L\'ho chiesto all\'IA. Per una volta ha ragione.',
    'Prompt riuscito. Non chiedetemi di rifarlo.'
  ],
  'trick:aiKo': [
    'Ha citato una funzione che non esiste. Con il link.',
    'Allucinazione. Ma detta benissimo.'
  ],
  'trick:reboot': [
    'Hai provato a spegnere e riaccendere? Io sì.',
    'Riavvio. Tutto quello che avevate fatto: perso.'
  ],
  'trick:mate': [
    'Ripristinato dal backup. Lui e il suo gemello.',
    'Bel ripristino. Peccato fosse infetto.'
  ],
  'trick:double': [
    'Pair programming: uno scrive, l\'altro giudica.',
    'In due si sbaglia il doppio più in fretta. Oggi no.'
  ],
  'trick:standoff': [
    'Ho portato la questione al management. Pari e patta.',
    'Il manager ha deciso: si rimanda. Tu intanto perdi.'
  ],
  'trick:lunch': [
    'Pausa pranzo. Il problema aspetta, il buono pasto no.',
    'Si riprende alle due. Forse alle tre.'
  ],
  'trick:cascade': [
    'Un alert tira l\'altro. Buon divertimento.',
    'Il monitoraggio funziona benissimo. Purtroppo.'
  ],
  'trick:reassign': [
    'Non è di mia competenza. Te lo riassegno.',
    'Ticket girato. Buona fortuna, collega.'
  ],
  // la Risposta automatica rimanda indietro una Sfiga: parla chi era fuori ufficio
  bounce: [
    'Sono fuori ufficio. Questa te la tieni tu.',
    'Messaggio non recapitato. Rimandato al mittente.'
  ],
  // chi salta il turno
  skipped: [
    'Salto il turno: sono «in formazione obbligatoria».',
    'Non ci sono. C\'è il mio stato «occupato».',
    'Sono in riunione. Proseguite pure senza di me.'
  ],
  helpYes: [
    'Arrivo. Il mio tempo te lo fatturo in tesori.',
    'Ti aiuto, ma nella mail di ringraziamento voglio essere in copia.',
    'Condivido io lo schermo. Tu non toccare niente.',
    'Va bene, ma il ticket lo intestiamo a me.',
    'Ti do una mano. La reperibilità di sabato però è tua.',
    'Entro in call. Tu intanto prepara i tesori.',
    'Affare fatto. Lo considero un progetto cross-team.',
    'Ci sto. Ma al prossimo audit io non ti conosco.'
  ],
  helpNo: [
    'Non è di mia competenza. Apri un ticket.',
    'Hai provato a spegnere e riaccendere?',
    'Ci guardo lunedì. Non ho detto quale.',
    'Sono in una riunione che poteva essere una mail.',
    'Mandami una mail, così la ignoro con calma.',
    'Volentieri, ma ho la giornata piena di «allineamenti».',
    'Sono fuori ufficio. Mentalmente, da marzo.',
    'Per quel budget ti mando il link alla documentazione.',
    'Ti metto in backlog. Priorità: «bella idea».'
  ],
  // chi combatte rifiuta il prezzo chiesto da chi lo aiuterebbe
  counterNo: [
    'A quel prezzo mi arrangio da solo.',
    'Per quella cifra chiamo un consulente. Almeno fattura.',
    'Troppo caro. Giro la richiesta all\'ufficio acquisti.',
    'Fuori budget. Ne riparliamo il prossimo trimestre.'
  ],
  block: [
    'Bloccata. L\'avevo in blacklist da ieri.',
    'Vista arrivare dal primo pacchetto. Regola già scritta.',
    'Bloccata, loggata e citata nel report trimestrale.',
    'Respinta al perimetro. Al mittente arriva un bounce.',
    'Era nel playbook. Pagina uno.'
  ],
  loot: [
    'Quarantamila warning e una riga utile. Me la tengo.',
    'Leggo i log. Nessuno lo fa mai, per questo funziona.',
    'Nei log c\'è tutto. Anche una password in chiaro.',
    'Un grep ben fatto vale più di un SIEM da sei cifre.',
    'Livello di log: DEBUG. In produzione. Da tre anni.',
    'C\'è un errore che si ripete dal 2019. Nessuno ha mai chiesto niente.',
    'Trovato qualcosa alla riga duecentomila. Valeva lo scroll.',
    'I log ruotano ogni sette giorni. Oggi è il sesto: che fortuna.',
    'Timestamp in tre fusi orari diversi. Mi oriento con le stelle.',
    'Qualcuno ha loggato «qui non dovrebbe mai arrivare». Ci arriva.',
    'Cerco «error» e trovo «errror». Ecco perché l\'alert non scattava.',
    'Stack trace di ottanta righe. Quella utile è l\'ottantunesima.',
    'Il log dice «tutto ok» quattro volte al secondo. Sospetto.',
    'Apro il file con il Blocco note. Ci rivediamo tra dieci minuti.'
  ],
  rollback: [
    'Ctrl+Z a livello aziendale.',
    'Ripristino dallo snapshot di ieri. Oggi non è mai successo.',
    'Rollback riuscito. Quasi tutto è tornato com\'era.',
    'Snapshot ripristinato. Il combattimento risulta «mai avvenuto».',
    'Torno a ieri sera. Ieri sera andava tutto.'
  ],
  gameover: [
    'Primo comando da root: cancellare i log di questa partita.',
    'Root, finalmente. Ah, quindi adesso la reperibilità è mia?',
    'Ho accesso a tutto e nessuno sa come revocarmelo.',
    'whoami: root. Da domani le richieste di accesso passano da me.',
    'Sono root. Il primo che apre un ticket finisce in sola lettura.',
    'Permessi massimi, responsabilità pure. A una delle due rinuncio.'
  ]
};

function buildDecks(nextId, shuffle) {
  const T = [], A = [];
  const add = (arr, o, c = 1) => { for (let i = 0; i < c; i++) arr.push({ ...o, uid: nextId() }); };
  THREATS.forEach(t => add(T, { deck: 'T', type: 'threat', name: t.n, l: t.l, tr: t.tr, lv: t.lv, bad: t.bad, bt: badText(t.bad), d: t.d, vs: t.vs || null, flee: t.flee || 0 }));
  CURSES.forEach(t => add(T, { deck: 'T', type: 'curse', name: t.n, bad: t.bad, bt: badText(t.bad), d: t.d }, t.c || 2));
  Object.keys(ROLES).forEach(r => add(T, { deck: 'T', type: 'role', role: r, name: ROLES[r].name, d: ROLES[r].text }, 2));
  BOOSTS.forEach(b => add(T, { deck: 'T', type: 'boost', name: b.n, amt: b.amt, tr: b.tr, lv: b.lv || 0, d: b.d }, b.c));
  TRICKS_T.forEach(t => add(T, { deck: 'T', type: 'trick', fx: t[0], name: t[1], text: TRICK_TEXT[t[0]], d: t[3] }, t[2]));
  add(T, { deck: 'T', type: 'lateral', name: 'Movimento laterale', d: 'L\'attaccante si sposta. Su di te.' }, 3);
  GEAR.forEach(g => add(A, {
    deck: 'A', type: 'gear', slot: g[0], name: g[1], bonus: g[2], value: g[3], d: g[4],
    roleBonus: g[6] || null
  }, g[5] || 2));
  ONESHOTS.forEach(o => add(A, { deck: 'A', type: 'oneshot', name: o[0], bonus: o[1], value: o[2], d: o[4] }, o[3]));
  add(A, { deck: 'A', type: 'oneshot', escape: true, bonus: 0, name: 'Rollback', value: 300, d: 'Torni allo stato di prima. Quasi.' }, 3);
  TRICKS_A.forEach(t => add(A, { deck: 'A', type: 'trick', fx: t[0], name: t[1], value: t[3], text: TRICK_TEXT[t[0]], d: t[4] }, t[2]));
  LEVELUPS.forEach(l => add(A, { deck: 'A', type: 'levelup', name: l[0], d: l[1] }, l[2]));
  return { T: shuffle(T), A: shuffle(A) };
}

module.exports = { TITLES, SLOTS, ROLES, QUIPS, buildDecks, badText, THREATS, CURSES, GEAR, ONESHOTS, LEVELUPS, BOOSTS, TRICKS_T, TRICKS_A, TRICK_TEXT };
