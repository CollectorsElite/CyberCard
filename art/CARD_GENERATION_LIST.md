# Lista arte carte — ESCALATION

Template visuale (foto ref): cornice nera · area immagine comics in alto · 1–5 stelle · barra nome colorata · box testo sotto.

**Colori tipo (proposta):**
| Colore | Tipi |
|--------|------|
| rosso | Minaccia (`threat`) |
| viola | Sfiga (`curse`), Movimento laterale |
| blu | Ruolo (`role`), Uso singolo (`oneshot`) |
| oro | Asset (`gear`), Livello (`levelup`), Boost |

**Stelle:** scala 1–5 da potenza/importanza (non dal livello di gioco 1–10).

**Formato riga:** `slug` · stelle · **Nome** · testo UI · *brief comics*

Totale **~82 asset unici** da generare (le copie in mazzo riusano la stessa arte).
Mazzo attuale: **T 83 / A 81** (vedi `server/cards.js`).

### Nuove carte (v3 mazzo) — illustrazioni PROVVISORIE da sostituire

Queste 13 carte hanno un'illustrazione provvisoria composta in automatico: stesso telaio delle altre (cornice nera, stelle, barra del nome, riquadro del testo), ma al posto del disegno a fumetti ci sono pittogrammi [OpenMoji](https://openmoji.org) (licenza CC BY-SA 4.0). Per la versione definitiva basta generare l'immagine con il prompt base in fondo a questo file e salvarla in `art/cards/<slug>.jpg` con lo stesso nome, poi rilanciare `python3 art/build-frames.py`.

| slug | colore | ★ | Nome | Testo sulla carta | Brief per il disegno |
|------|--------|---|------|-------------------|----------------------|
| `trick-hai-un-minuto` | viola | 3 | «Hai un minuto?» | Non era un minuto. Non lo è mai. | Collega che si affaccia alla scrivania con il dito alzato, l'altro guarda disperato l'orologio. |
| `trick-change-freeze` | viola | 3 | Change freeze | Fino a lunedì non si tocca niente. Nemmeno quello che è rotto. | Sala server dentro un blocco di ghiaccio, cartello «NON TOCCARE», tecnico con le mani alzate. |
| `trick-honeypot` | viola | 3 | Honeypot | Sembrava un server dimenticato. Aveva i log accesi. | Vasetto di miele a forma di server, attaccante con la mano incollata dentro, telecamera che riprende. |
| `trick-falso-positivo` | viola | 3 | Falso positivo | Il SOC chiude il ticket: non era niente. Forse. | Analista che spegne una sirena con un timbro «CHIUSO», dietro di lui qualcosa fuma. |
| `boost-priorita-dal-ceo` | oro | 3 | Priorità dal CEO | Oggetto: «URGENTISSIMO». Testo: «vedi sopra». Sopra non c'è niente. | Mail gigante con corona e punto esclamativo rosso che piomba su una scrivania. |
| `curse-shoulder-surfing` | viola | 2 | Shoulder surfing | In treno, schermo a luminosità massima. Il vicino ringrazia. | Treno, portatile luminosissimo, vicino di posto che prende appunti. |
| `curse-passaggio-di-consegne` | viola | 3 | Passaggio di consegne | «Ti lascio tutto in ordine.» Un file di testo. Vuoto. | Collega che scappa con lo scatolone lasciando un post-it «in bocca al lupo» su una scrivania in fiamme. |
| `trick-turno-di-reperibilita` | blu | 3 | Turno di reperibilità | Era nel contratto. Pagina 14, corpo 6. | Tecnico in pigiama svegliato alle 3 da un cercapersone che vibra sul comodino. |
| `trick-capro-espiatorio` | blu | 3 | Capro espiatorio | Nel post-mortem c'è un solo nome. Non è il tuo. | Riunione di post-mortem, tutti indicano una capra con il badge da stagista. |
| `trick-risposta-automatica` | blu | 3 | Risposta automatica | «Sono fuori ufficio. Per urgenze, rivolgersi al mittente.» | Sdraio in spiaggia, portatile chiuso, buste che rimbalzano indietro contro un ombrellone. |
| `trick-chiedo-all-ia` | blu | 3 | Chiedo all'IA | Risponde subito e con grande sicurezza. È questo che preoccupa. | Robot sorridente che porge un dado a un tecnico perplesso, fumetto con una risposta lunghissima. |
| `trick-spegni-e-riaccendi` | blu | 3 | Spegni e riaccendi | Il rimedio più antico del mestiere. Funziona ancora. | Mano che stacca la spina di un intero datacenter, tutti trattengono il fiato. |
| `trick-riassegnazione-del-ticket` | blu | 3 | Riassegnazione del ticket | «Non è di mia competenza.» Ora è della tua. | Ticket in fiamme passato come una patata bollente da una scrivania all'altra. |

### Nuove carte (v2 mazzo) — da aggiungere in coda ai batch

**Minacce nuove:** Shared mailbox orfana · @channel alle 18:01 · VPN che cade solo a te · Ticket Waiting for customer dal 2022 · LLM che allucina in produzione · Cluster Kubernetes senza owner · Richiesta GDPR del lunedì · Phishing che ha fregato il CFO · Banner cookie infinito · Condivisione schermo col tab sbagliato · Repo pubblico con il .env · Email URGENTE senza priorità

**Sfighe nuove:** MFA sul telefono vecchio · Hot desk senza monitor

**Asset nuovi:** Tastiera meccanica da open space · Torre di post-it TODO

**Oneshot nuovo:** Screenshot come documentazione

---

## 1. Minacce — rosso (26)

1. `threat-popup-riavvia` · ★☆☆☆☆ · **Popup «riavvia per aggiornare»** · Forza 1 · *PC con popup gigante e un dito che preme «Più tardi» per la 47ª volta mentre parte la demo.*
2. `threat-password-postit` · ★☆☆☆☆ · **Password su un post-it** · Forza 1 · *Monitor con post-it giallo «P@ssw0rd» nell’angolo, collega che finge di non vederlo.*
3. `threat-stagista-admin` · ★★☆☆☆ · **Stagista con privilegi admin** · Forza 2 · *Ragazzo con badge «STAGE» e corona da root, ufficio in fiamme allegre dietro.*
4. `threat-ssl-scaduto` · ★★☆☆☆ · **Certificato SSL scaduto** · Forza 2 · *Lucchetto spezzato con calendario «scaduto ieri» e mail bounce che piovono.*
5. `threat-stampante-senziente` · ★★☆☆☆ · **Stampante di rete senziente** · Forza 2 · *Stampante con occhi maligni che sputa fogli «ERRORE 0xYOU».*
6. `threat-wifi-ospiti` · ★★☆☆☆ · **Wi-Fi ospiti senza password** · Forza 3 · *Router con cartello «Guest OPEN» e folla di laptop sconosciuti in festa.*
7. `threat-riunione-mail` · ★★☆☆☆ · **Riunione che poteva essere una mail** · Forza 3 · *Sala meeting con slide vuote e bocche che dicono «ci aggiorniamo» in loop.*
8. `threat-macro-excel` · ★★☆☆☆ · **Macro Excel del 2003** · Forza 3 · *File `.xls` mostro con nome lunghissimo e VBA che esce da un’icona Excel.*
9. `threat-fax-rete` · ★★★☆☆ · **Fax ancora collegato in rete** · Forza 4 · *Fax anni ’90 ancora acceso, cavo ethernet, ragnatele e LED verdi.*
10. `threat-utente-clicca` · ★★★☆☆ · **Utente che clicca tutto** · Forza 4 · *Impiegato felice che clicca «Hai vinto un iPhone» mentre antivirus piange.*
11. `threat-bug-debug` · ★★★☆☆ · **Bug che sparisce in debug** · Forza 4 · *Insetto pixel che diventa invisibile sotto la lente del debugger.*
12. `threat-captcha` · ★★★☆☆ · **Captcha infinito** · Forza 5 · *Griglia di semafori infinita, giocatore con occhi a spirale.*
13. `threat-miner-tostapane` · ★★★☆☆ · **Cryptominer nel tostapane** · Forza 6 · *Tostapane che mina crypto, pane crudo, bolletta elettrica in fiamme.*
14. `threat-shadow-it` · ★★★☆☆ · **Shadow IT del Marketing** · Forza 6 · *Marketer con 7 loghi SaaS in mano e carta di credito aziendale.*
15. `threat-excel-replyall` · ★★★★☆ · **Excel di dati personali in «Rispondi a tutti»** · Forza 7 · *Mail «Reply All» con foglio Excel che esplode in faccia a 200 colleghi.*
16. `threat-consulente-attimo` · ★★★★☆ · **Consulente del «è un attimo»** · Forza 7 · *Consulente con orologio a sabbia e fattura che cresce a vista d’occhio.*
17. `threat-botnet-frigo` · ★★★★☆ · **Botnet di frigoriferi** · Forza 8 · *Esercito di frigoriferi smart con occhi rossi in formazione.*
18. `threat-backup-mai` · ★★★★☆ · **Backup mai testato** · Forza 8 · *Nastro/backup con etichetta «FUNZIONA?» e dito che trema sul restore.*
19. `threat-rilascio-venerdi` · ★★★★☆ · **Rilascio in produzione di venerdì** · Forza 9 · *Bottone rosso «DEPLOY» premuto alle 17:55, calendario venerdì.*
20. `threat-fornitore-cert` · ★★★★☆ · **Fornitore unico «certificato»** · Forza 9 · *Certificato PDF polveroso e macchinetta del caffè come «scope».*
21. `threat-auditor` · ★★★★★ · **Auditor a fine trimestre** · Forza 10 · *Auditor con checklist infinita e occhiali che brillano «PDF firmato».*
22. `threat-ransomware-chat` · ★★★★★ · **Ransomware con assistenza clienti** · Forza 11 · *Chat bubble «Come posso aiutarti a pagare?» con smiley e countdown.*
23. `threat-cobol` · ★★★★★ · **Mainframe COBOL immortale** · Forza 12 · *Mainframe anziano con occhiali da sole, più vivo del capo.*
24. `threat-insider` · ★★★★★ · **Insider con badge e rancore** · Forza 14 · *Dipendente sorridente-inquietante con badge e chiavi di tutto.*
25. `threat-apt` · ★★★★★ · **APT finanziata da uno Stato** · Forza 15 · *Spia in giacca con badge mensa e laptop che brilla dal 2019.*
26. `threat-zeroday-1759` · ★★★★★ · **Zero-day del venerdì alle 17:59** · Forza 18 · *Orologio 17:59, schermo BSOD a forma di «BUON WEEKEND».*

---

## 2. Sfighe — viola (10)

1. `curse-reset-password` · ★★☆☆☆ · **Reset password obbligatorio** · *Schermo login con regole password e utente che digita «Estate2025!!».*
2. `curse-laptop-ritirato` · ★★☆☆☆ · **Laptop ritirato dall'IT** · *Tecnico IT che porta via il laptop con sorriso «martedì».*
3. `curse-licenza-scaduta` · ★★☆☆☆ · **Licenza scaduta** · *Software con lucchetto e timbro «in approvazione CFO dal 2023».*
4. `curse-data-leak` · ★★★☆☆ · **Credenziali in un data leak** · *Password che volano su internet come farfalle.*
5. `curse-riorganizzazione` · ★★★☆☆ · **Riorganizzazione aziendale** · *Ufficio che sparisce, cartello «ruolo deprecato».*
6. `curse-cc-140` · ★★☆☆☆ · **In copia su 140 mail** · *Inbox che esplode di «URGENTE» in CC.*
7. `curse-corso-security` · ★★☆☆☆ · **Corso obbligatorio di sicurezza** · *Video formativo noioso e quiz a crocette a caso.*
8. `curse-migrazione` · ★★☆☆☆ · **Migrazione al nuovo gestionale** · *Stessa UI ma con 3× click, cursore esausto.*
9. `curse-revisione-accessi` · ★★★☆☆ · **Revisione degli accessi** · *Occhio gigante sui log che punta il giocatore.*
10. `curse-gpo` · ★★★☆☆ · **Policy di gruppo restrittiva** · *GPO che blocca tutto, anche un emoji sorridente.*

---

## 3. Ruoli — blu (4)

1. `role-red` · ★★★★☆ · **Red Teamer** · Vinci i pareggi · *Hacker etico col cappuccio, laptop, sorrisetto «pareggio = vittoria».*
2. `role-sys` · ★★★★☆ · **Sysadmin** · Fuga più facile · *Sysadmin con caffè e tasti che dicono «uptime».*
3. `role-blue` · ★★★★☆ · **Blue Teamer** · Blocca 1ª sfiga/giro · *Difensore con scudo SIEM e alert verdi.*
4. `role-social` · ★★★★☆ · **Ingegnere sociale** · Sabotaggi senza esposizione · *Collega affabile che apre porte con un sorriso (e un badge altrui).*

---

## 4. Boost — oro (3)

1. `boost-patch-mai` · ★★★☆☆ · **Patch mai applicata** · +5 minaccia · *Coda di patch dal 2021, ragnatele sul ticket.*
2. `boost-zeroday` · ★★★★☆ · **Zero-day fresco** · +10 minaccia · *Exploit scintillante uscito da un forum oscuro.*
3. `boost-beta` · ★★☆☆☆ · **Versione beta** · −5 minaccia · *App beta che si pianta da sola, bug carini.*

---

## 5. Laterale — viola (1)

1. `lateral-movimento` · ★★★☆☆ · **Movimento laterale** · Aggiunge minaccia dalla mano · *Attaccante che scivola lateralmente da un server all’altro come cartoon.*

---

## 6. Asset (gear) — oro (15)

1. `gear-hw-laptop-stickers` · ★☆☆☆☆ · **Laptop pieno di adesivi** · HW +1 · *Laptop coperto di sticker «I ♥ sudo».*
2. `gear-hw-rpi-soffitto` · ★★☆☆☆ · **Raspberry Pi nel controsoffitto** · HW +2 · *Pi nascosto tra le tegole del controsoffitto, LED che lampeggia.*
3. `gear-hw-workstation-gpu` · ★★★☆☆ · **Workstation con GPU da mutuo** · HW +3 · *Torre con GPU enorme che scalda l’ufficio d’inverno.*
4. `gear-hw-usb-parcheggio` · ★★☆☆☆ · **Chiavetta USB trovata nel parcheggio** · HW +2 · *USB a terra nel parking con aura sospetta.*
5. `gear-sw-bash` · ★☆☆☆☆ · **Script Bash non commentato** · SW +1 · *Terminale con script illeggibile che «funziona e basta».*
6. `gear-sw-regex` · ★★☆☆☆ · **Regex che capisci solo tu** · SW +2 · *Regex mostruosa e un solo cervello che la capisce.*
7. `gear-sw-firewall` · ★★☆☆☆ · **Firewall configurato a mano** · SW +2 · *Muro di regole firewall, tre in conflitto che litiano.*
8. `gear-sw-edr` · ★★★☆☆ · **EDR in modalità paranoia** · SW +3 · *EDR che ammanetta anche l’admin.*
9. `gear-cr-estate2024` · ★☆☆☆☆ · **Password «Estate2024!»** · CR +1 · *Post-it / password stagionale con palm tree.*
10. `gear-cr-token-servizio` · ★★☆☆☆ · **Token di servizio mai ruotato** · CR +2 · *Token antico con ragnatele, creato dal predecessore.*
11. `gear-cr-domain-admin` · ★★★☆☆ · **Domain admin dimenticato** · CR +3 · *Account DA polveroso «ultimo accesso: mai».*
12. `gear-gd-tazza` · ★☆☆☆☆ · **Tazza «Sulla mia macchina va»** · GD +1 · *Mug classica da developer.*
13. `gear-gd-cuffie` · ★★☆☆☆ · **Cuffie antirumore** · GD +2 · *Cuffie come segnale «non ora».*
14. `gear-gd-badge` · ★★☆☆☆ · **Badge clonato** · GD +2 · *Badge che apre anche la sala server, occhiolino.*
15. `gear-gd-felpa` · ★★☆☆☆ · **Felpa col cappuccio d'ordinanza** · GD +1 (+2 Red) · *Felpa da Red Team da manifesto.*

---

## 7. Uso singolo — blu (6)

1. `oneshot-caffe` · ★☆☆☆☆ · **Caffè della macchinetta** · +2 · *Bicchierino di plastica, vapore di speranza.*
2. `oneshot-energy` · ★★☆☆☆ · **Energy drink alle 3 di notte** · +3 · *Lattina alle 03:00, cuore a zigzag.*
3. `oneshot-forum` · ★★☆☆☆ · **Risposta copiata da un forum** · +3 · *Thread 2012 con «Accepted answer» polveroso.*
4. `oneshot-prompt` · ★★★☆☆ · **Prompt scritto bene** · +4 · *Chat AI con prompt perfetto e checkmark.*
5. `oneshot-vendor` · ★★★☆☆ · **Chiamata al supporto del vendor** · +5 · *Cuffia + musica d’attesa da 40 minuti.*
6. `oneshot-rollback` · ★★★☆☆ · **Rollback** · fuga garantita · *Ctrl+Z gigante su datacenter, tutto torna indietro.*

---

## 8. Livello — oro (3)

1. `level-certificazione` · ★★★☆☆ · **Certificazione appena presa** · +1 liv · *Diploma costoso quanto un monolocale, selfie con badge.*
2. `level-stampante-ceo` · ★★☆☆☆ · **Hai sistemato la stampante del CEO** · +1 liv · *Eroe con stampante e CEO che applaude «il genio».*
3. `level-anzianita` · ★★☆☆☆ · **Promozione per anzianità** · +1 liv · *Torta «anni di servizio» e nessuno sa cosa fa.*

---

## Riepilogo batch generazione

| Batch | Qty | Colore | Priorità |
|-------|-----|--------|----------|
| A Minacce | 26 | rosso | alta (cuore del gioco) |
| B Sfighe | 10 | viola | alta |
| C Ruoli | 4 | blu | alta |
| D Gear | 15 | oro | media |
| E Oneshot + Rollback | 6 | blu | media |
| F Boost + Laterale | 4 | oro/viola | media |
| G Level-up | 3 | oro | bassa |
| **Totale** | **68** | | |

**Prompt base consigliato (tutte):**  
*«Comic book panel, funny IT office satire, bold ink outlines, flat colors, no text in image, centered subject, white/light background for card art frame, square-ish composition»* + brief specifico sopra.

**Output file suggerito:** `art/cards/<slug>.png` (es. 1024×1024), poi ritaglio nell’area bianca del template.
