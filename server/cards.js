'use strict';
// Dati delle carte di ESCALATION. Tutti i contenuti sono originali.
// Copie tarate per tavoli fino a 6: filler più numerosi, minacce uniche 1×.

const TITLES = ['', 'guest', 'stagista', 'utente', 'power user', 'helpdesk', 'tecnico', 'senior', 'domain admin', 'enterprise admin', 'root'];
const SLOTS = { hw: 'Hardware', sw: 'Software', cr: 'Credenziali', gd: 'Gadget' };
const ROLES = {
  red: { name: 'Red Teamer', text: 'Vinci anche i pareggi in combattimento.' },
  sys: { name: 'Sysadmin', text: 'La fuga riesce con 4 o più invece che con 5.' },
  blue: { name: 'Blue Teamer', text: 'La prima Sfiga che ti colpisce in ogni giro viene bloccata.' },
  social: { name: 'Ingegnere sociale', text: 'I tuoi sabotaggi non aumentano l\'Esposizione.' }
};

const THREATS = [
  { n: 'Popup «riavvia per aggiornare»', l: 1, tr: 1, lv: 1, bad: [{ k: 'penalty', n: 2 }], d: 'Rimandato 47 volte. Oggi parte da solo, durante la demo al cliente.' },
  { n: 'Password su un post-it', l: 1, tr: 1, lv: 1, bad: [{ k: 'hand', n: 2 }], d: 'Angolo in basso a sinistra del monitor. Come sempre.' },
  { n: 'Banner cookie infinito', l: 1, tr: 1, lv: 1, bad: [{ k: 'hand', n: 1 }], d: '«Accetta tutti.» Non c\'è «rifiuta». C\'è solo «gestisci» che riporta ad «accetta».' },
  { n: 'Stagista con privilegi admin', l: 2, tr: 1, lv: 1, bad: [{ k: 'slot', s: 'gd' }], d: 'Gliel\'hanno dati «per fare prima».' },
  { n: 'Certificato SSL scaduto', l: 2, tr: 1, lv: 1, bad: [{ k: 'slot', s: 'sw' }], d: 'Scaduto ieri. Il promemoria arrivava a chi si è dimesso.' },
  { n: 'Stampante di rete senziente', l: 2, tr: 1, lv: 1, bad: [{ k: 'slot', s: 'hw' }], d: 'Ha un IP pubblico e un conto in sospeso con te.' },
  { n: 'Shared mailbox orfana', l: 2, tr: 1, lv: 1, bad: [{ k: 'hand', n: 1 }], d: 'Nessun owner. Ventimila unread. Qualcuno risponde ancora «cordiali saluti».' },
  { n: 'Wi-Fi ospiti senza password', l: 3, tr: 1, lv: 1, bad: [{ k: 'hand', n: 1 }], d: 'SSID: «Azienda_Guest». Password: nessuna. Banda: tutta.' },
  { n: 'Riunione che poteva essere una mail', l: 3, tr: 1, lv: 1, bad: [{ k: 'lvl', n: 1 }], d: 'Novanta minuti, nessun ordine del giorno, tre «ci aggiorniamo».', flee: 1 },
  { n: 'Macro Excel del 2003', l: 3, tr: 1, lv: 1, bad: [{ k: 'slot', s: 'cr' }], d: 'Il file si chiama FINALE_def_v7_usaquesta_NONTOCCARE.xls.' },
  { n: '@channel alle 18:01', l: 3, tr: 1, lv: 1, bad: [{ k: 'penalty', n: 2 }], d: '«Scusate il disturbo.» Disturbo accettato da 400 persone.' },
  { n: 'Fax ancora collegato in rete', l: 4, tr: 2, lv: 1, bad: [{ k: 'slot', s: 'hw' }], d: 'Nessuno lo usa dal 2009. È ancora acceso.' },
  { n: 'Utente che clicca tutto', l: 4, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }], d: 'Ha vinto un telefono. Per la terza volta questa settimana.', vs: { role: 'blue', n: 3 } },
  { n: 'Bug che sparisce in debug', l: 4, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }], d: 'Se lo guardi non c\'è. Se vai in ferie sì.', flee: -1 },
  { n: 'Condivisione schermo col tab sbagliato', l: 4, tr: 2, lv: 1, bad: [{ k: 'role' }], d: 'La slide era pronta. La chat privata no.' },
  { n: 'Captcha infinito', l: 5, tr: 2, lv: 1, bad: [{ k: 'hand', n: 99 }], d: 'Seleziona tutti i semafori. E ancora. E ancora.' },
  { n: 'VPN che cade solo a te', l: 5, tr: 2, lv: 1, bad: [{ k: 'slot', s: 'gd' }], d: 'Agli altri funziona. Al supporto «non riusciamo a riprodurre».' },
  { n: 'Ticket in Waiting for customer dal 2022', l: 5, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }], d: 'Il customer sei tu. Non lo sapevi.' },
  { n: 'Cryptominer nel tostapane', l: 6, tr: 2, lv: 1, bad: [{ k: 'slot', s: 'hw' }, { k: 'slot', s: 'sw' }], d: 'Il pane resta freddo, la bolletta no.' },
  { n: 'Shadow IT del Marketing', l: 6, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 2 }], d: 'Sette SaaS, una carta aziendale, zero DPA. Lo scoprirete dal Garante.' },
  { n: 'LLM che allucina in produzione', l: 6, tr: 2, lv: 1, bad: [{ k: 'hand', n: 2 }], d: 'Ha inventato una policy. Ora è ufficiale. È anche sbagliata.' },
  { n: 'Excel di dati personali in «Rispondi a tutti»', l: 7, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }, { k: 'slot', s: 'cr' }], d: 'Hai 72 ore per notificare. Ne sono già passate 71.' },
  { n: 'Consulente del «è un attimo»', l: 7, tr: 2, lv: 1, bad: [{ k: 'best' }], d: 'Fattura a ore. Gli attimi sono tanti.' },
  { n: 'Repo pubblico con il .env', l: 7, tr: 2, lv: 1, bad: [{ k: 'slot', s: 'cr' }, { k: 'lvl', n: 1 }], d: 'Star: 2. Fork: 1. Secrets: tutti. Commit: «fix typo».' },
  { n: 'Botnet di frigoriferi', l: 8, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }, { k: 'hand', n: 2 }], d: 'Ventimila frigoriferi smart, tutti contro di te.' },
  { n: 'Backup mai testato', l: 8, tr: 3, lv: 1, bad: [{ k: 'gearAll' }], d: 'Esiste. Funziona? Lo scopri adesso. Ultimo restore riuscito: mai.', vs: { role: 'sys', n: 3 } },
  { n: 'Cluster Kubernetes senza owner', l: 8, tr: 3, lv: 1, bad: [{ k: 'slot', s: 'sw' }, { k: 'lvl', n: 1 }], d: 'Gira da tre anni. Il YAML è firmato «tmp».', vs: { role: 'sys', n: 2 } },
  { n: 'Rilascio in produzione di venerdì', l: 9, tr: 3, lv: 1, bad: [{ k: 'best' }], d: '«È una modifica piccola.» Firmato: nessuno. Rollback: non previsto.' },
  { n: 'Fornitore unico «certificato»', l: 9, tr: 3, lv: 1, bad: [{ k: 'lvl', n: 2 }], d: 'Il certificato è un PDF del 2017. Lo scope è la macchinetta del caffè.' },
  { n: 'Email «URGENTE» senza priorità', l: 9, tr: 3, lv: 1, bad: [{ k: 'penalty', n: 3 }], d: 'Oggetto in maiuscolo. Corpo: «quando puoi». Allegato: 40 MB.' },
  { n: 'Auditor a fine trimestre', l: 10, tr: 3, lv: 1, bad: [{ k: 'role' }, { k: 'lvl', n: 1 }], d: 'Vuole tutte le evidenze. Entro domani. In PDF firmato digitalmente.', vs: { role: 'social', n: 4 } },
  { n: 'Richiesta GDPR del lunedì mattina', l: 10, tr: 3, lv: 1, bad: [{ k: 'hand', n: 99 }], d: 'Vuole «tutti i suoi dati». Entro 30 giorni. Sono le 9:12.' },
  { n: 'Ransomware con assistenza clienti', l: 11, tr: 3, lv: 2, bad: [{ k: 'lvl', n: 2 }, { k: 'slot', s: 'cr' }], d: 'Chat h24, FAQ chiare, sconto se paghi entro 48 ore.' },
  { n: 'Mainframe COBOL immortale', l: 12, tr: 3, lv: 2, bad: [{ k: 'lvl', n: 2 }], d: 'È più vecchio del tuo capo e gli sopravviverà.', flee: 1 },
  { n: 'Phishing che ha fregato il CFO', l: 13, tr: 4, lv: 2, bad: [{ k: 'best' }, { k: 'lvl', n: 1 }], d: 'Il bonifico è partito. La mail era quasi perfetta. Il CFO «aveva fretta».' },
  { n: 'Insider con badge e rancore', l: 14, tr: 4, lv: 2, bad: [{ k: 'gearAll' }], d: 'Conosce le password. Le ha scelte lui.' },
  { n: 'APT finanziata da uno Stato', l: 15, tr: 4, lv: 2, bad: [{ k: 'lvl', n: 3 }], d: 'Paziente, ben pagata, nella tua rete dal 2019. Ha anche il badge mensa.' },
  { n: 'Zero-day del venerdì alle 17:59', l: 18, tr: 5, lv: 2, bad: [{ k: 'wipe' }], d: 'Formattazione completa. Buon weekend.' }
];

const CURSES = [
  { n: 'Reset password obbligatorio', bad: [{ k: 'lvl', n: 1 }], d: 'Dodici caratteri, un simbolo, nessuna delle ultime 24. Diventa «Estate2025!!».', c: 3 },
  { n: 'Laptop ritirato dall\'IT', bad: [{ k: 'slot', s: 'hw' }], d: '«Te lo ridiamo martedì.» Non dicono quale.', c: 2 },
  { n: 'Licenza scaduta', bad: [{ k: 'slot', s: 'sw' }], d: 'Il rinnovo era in approvazione dal CFO. Dal 2023.', c: 2 },
  { n: 'Credenziali in un data leak', bad: [{ k: 'slot', s: 'cr' }], d: 'Ora le conosce mezzo internet.', c: 2 },
  { n: 'Riorganizzazione aziendale', bad: [{ k: 'role' }], d: 'Il tuo ruolo non esiste più. Nemmeno il tuo ufficio.', c: 2 },
  { n: 'In copia su 140 mail', bad: [{ k: 'hand', n: 2 }], d: 'Tutte con «URGENTE» nell\'oggetto.', c: 3 },
  { n: 'Corso obbligatorio di sicurezza', bad: [{ k: 'penalty', n: 2 }], d: 'Quarantacinque minuti di video. Il quiz finale si passa tirando a caso.', c: 3 },
  { n: 'Migrazione al nuovo gestionale', bad: [{ k: 'slot', s: 'sw' }], d: 'Tutto come prima, ma con il triplo dei clic.', c: 2 },
  { n: 'Revisione degli accessi', bad: [{ k: 'best' }], d: 'Qualcuno ha finalmente letto i log.', c: 2 },
  { n: 'Policy di gruppo restrittiva', bad: [{ k: 'penalty', n: 3 }], d: 'Non puoi installare niente. Nemmeno il buonumore.', c: 2 },
  { n: 'MFA sul telefono vecchio', bad: [{ k: 'slot', s: 'gd' }], d: 'L\'SMS arriva su un Nokia in un cassetto. In un altro ufficio.', c: 3 },
  { n: 'Hot desk senza monitor', bad: [{ k: 'penalty', n: 2 }], d: 'Hai un posto. Teoricamente. Il monitor no.', c: 3 }
];

const BOOSTS = [
  { n: 'Patch mai applicata', amt: 5, tr: 1, c: 2, d: 'In coda dal 2021.' },
  { n: 'Zero-day fresco', amt: 10, tr: 2, c: 2, d: 'Appena uscito da un forum che non nomineremo.' },
  { n: 'Versione beta', amt: -5, tr: -1, c: 2, d: 'Si pianta da sola. Più debole, ma rende meno.' }
];

// [slot, nome, bonus, valore, testo, copie, roleBonus?]
const GEAR = [
  ['hw', 'Laptop pieno di adesivi', 1, 200, 'Uno dice «I ♥ sudo».', 3],
  ['hw', 'Raspberry Pi nel controsoffitto', 2, 300, 'Nessuno sa chi l\'ha messo lì.', 2],
  ['hw', 'Workstation con GPU da mutuo', 3, 600, 'D\'inverno scalda l\'ufficio.', 2],
  ['hw', 'Chiavetta USB trovata nel parcheggio', 2, 100, 'Cosa potrebbe andare storto?', 3],
  ['sw', 'Script Bash non commentato', 1, 100, 'Funziona. Nessuno sa perché.', 3],
  ['sw', 'Regex che capisci solo tu', 2, 300, 'Scritta da te, letta da nessuno.', 2],
  ['sw', 'Firewall configurato a mano', 2, 400, 'Ottocento regole, tre in conflitto.', 2],
  ['sw', 'EDR in modalità paranoia', 3, 600, 'Blocca anche te. Soprattutto te.', 2],
  ['cr', 'Password «Estate2024!»', 1, 100, 'Valida fino alla prossima estate.', 3],
  ['cr', 'Token di servizio mai ruotato', 2, 400, 'L\'ha creato il tuo predecessore.', 2],
  ['cr', 'Domain admin dimenticato', 3, 700, 'Ultimo accesso: mai. Ultimo audit: mai.', 2],
  ['gd', 'Tazza «Sulla mia macchina va»', 1, 200, 'Prova inconfutabile.', 3],
  ['gd', 'Cuffie antirumore', 2, 300, 'Il segnale universale per «non ora».', 2],
  ['gd', 'Badge clonato', 2, 400, 'Apre anche la sala server.', 2],
  ['gd', 'Felpa col cappuccio d\'ordinanza', 1, 200, 'Per un Red Teamer vale +2 in più.', 2, { role: 'red', n: 2 }],
  ['gd', 'Tastiera meccanica da open space', 1, 200, 'Ogni tasto è un annuncio pubblico.', 3],
  ['gd', 'Torre di post-it «TODO»', 1, 100, 'Il debito tecnico in forma cartacea.', 3]
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
  ['Certificazione appena presa', 'È costata quanto un monolocale.', 2],
  ['Hai sistemato la stampante del CEO', 'Ora ti chiamano «il genio».', 2],
  ['Promozione per anzianità', 'Nessuno sa cosa fai, ma lo fai da tanto.', 2]
];

// Battute del narratore: una a caso per evento.
const QUIPS = {
  fleeOk: [
    'Si disconnette prima che qualcuno apra un ticket a suo nome.',
    'Ufficialmente era in ferie.',
    'Chiude il portatile e dice «a me funziona».',
    'Riassegna il ticket a un collega. Classico.',
    'La VPN cade al momento giusto, per una volta.',
    'Esce dalla porta antincendio, l\'unica senza lettore badge.'
  ],
  fleeKo: [
    'Il ticket torna indietro con la nota «non risolto».',
    'Lo raggiungono in pausa caffè.',
    'Era in videochiamata con la webcam accesa.',
    'Escalation al responsabile. Il suo.',
    'Il CAB ha detto no.',
    'Ha provato a spegnere e riaccendere. Ma non era il computer il problema.'
  ],
  win: [
    'Ticket chiuso con causa principale «errore utente».',
    'Nessuno saprà mai come. Nemmeno chi l\'ha risolto.',
    'Documentazione prodotta: «sistemato».',
    'Risolto alle 18:02. Lo scrive anche nella mail di recap.',
    'Ha funzionato al primo colpo. Molto sospetto.',
    'Chiuso con la nota «non si riproduce più».'
  ],
  audit: [
    'Il SOC ha trovato i log. Tutti.',
    'Convocato per un «caffè veloce» con l\'Internal Audit.',
    'Ha lasciato impronte ovunque nel SIEM.',
    'L\'alert era rosso e portava il suo nome.'
  ],
  sabotage: [
    'Non è un sabotaggio, è un test di resilienza.',
    'Lo chiama «feedback costruttivo».',
    'Tecnicamente rientra nel perimetro del change.',
    'Lo mette a verbale come «collaborazione tra team».',
    'Ha agito per il bene dell\'azienda. Il suo.'
  ],
  helpYes: [
    'Spirito di squadra, a pagamento.',
    'Collabora volentieri. La fattura arriva dopo.',
    'Lo fa per il team. E per i tesori.'
  ],
  helpNo: [
    'Risposta: «non è di mia competenza».',
    'Ha aperto un ticket per valutare la richiesta.',
    'È in riunione. Da tre giorni.',
    'Dice che ci guarda lunedì.'
  ],
  block: [
    'Bloccata, documentata e citata in riunione.',
    'L\'aveva messa in blacklist il giorno prima.',
    'Il Blue Team l\'aveva vista arrivare dal primo pacchetto.'
  ],
  loot: [
    'Tra 40.000 warning trova qualcosa di utile.',
    'Fa grep sui log e qualcosa salta fuori.',
    'Legge i log. Nessuno lo fa mai, per questo funziona.'
  ],
  rollback: [
    'Ripristino da snapshot: quasi tutto è tornato com\'era.',
    'Ctrl+Z a livello aziendale.'
  ],
  gameover: [
    'Ora ha accesso a tutto e nessuno sa come revocarglielo.',
    'Primo comando da root: cancellare i log di questa partita.',
    'Promosso amministratore di tutto. Auguri per la reperibilità.'
  ]
};

function buildDecks(nextId, shuffle) {
  const T = [], A = [];
  const add = (arr, o, c = 1) => { for (let i = 0; i < c; i++) arr.push({ ...o, uid: nextId() }); };
  THREATS.forEach(t => add(T, { deck: 'T', type: 'threat', name: t.n, l: t.l, tr: t.tr, lv: t.lv, bad: t.bad, d: t.d, vs: t.vs || null, flee: t.flee || 0 }));
  CURSES.forEach(t => add(T, { deck: 'T', type: 'curse', name: t.n, bad: t.bad, d: t.d }, t.c || 2));
  Object.keys(ROLES).forEach(r => add(T, { deck: 'T', type: 'role', role: r, name: ROLES[r].name, d: ROLES[r].text }, 2));
  BOOSTS.forEach(b => add(T, { deck: 'T', type: 'boost', name: b.n, amt: b.amt, tr: b.tr, d: b.d }, b.c));
  add(T, { deck: 'T', type: 'lateral', name: 'Movimento laterale', d: 'L\'attaccante si sposta. Su di te.' }, 3);
  GEAR.forEach(g => add(A, {
    deck: 'A', type: 'gear', slot: g[0], name: g[1], bonus: g[2], value: g[3], d: g[4],
    roleBonus: g[6] || null
  }, g[5] || 2));
  ONESHOTS.forEach(o => add(A, { deck: 'A', type: 'oneshot', name: o[0], bonus: o[1], value: o[2], d: o[4] }, o[3]));
  add(A, { deck: 'A', type: 'oneshot', escape: true, bonus: 0, name: 'Rollback', value: 300, d: 'Torni allo stato di prima. Quasi.' }, 3);
  LEVELUPS.forEach(l => add(A, { deck: 'A', type: 'levelup', name: l[0], d: l[1] }, l[2]));
  return { T: shuffle(T), A: shuffle(A) };
}

module.exports = { TITLES, SLOTS, ROLES, QUIPS, buildDecks, THREATS, CURSES, GEAR, ONESHOTS, LEVELUPS, BOOSTS };
