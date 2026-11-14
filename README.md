# ESCALATION online

Card game multiplayer di sabotaggi e privilege escalation per gente di IT. Si ispira alle meccaniche di Munchkin (porte/ticket, combattimento a somma di bonus, aiuto a pagamento, interferenze), ma tutti i contenuti sono originali.
Ogni giocatore usa il browser del proprio telefono o PC; il server tiene lo stato e decide tutto.

- da 3 a 6 giocatori per stanza, con bot opzionali per riempire i posti
- stanze con codice di 5 caratteri e link d'invito
- riconnessione automatica (15 secondi di tolleranza, poi le mosse diventano automatiche finché non torni)

## Avvio in locale

```bash
npm install
npm start          # http://localhost:3000
```

Per provarlo da solo apri tre schede (anche in finestre anonime, perché la sessione è salvata nel browser), crea una stanza nella prima ed entra con il codice nelle altre.

## Deploy

Il server è **un solo processo Node** che serve sia il client sia il WebSocket (`/ws`) sulla stessa porta. Legge la porta da `PORT`, come si aspettano Railway, Render e simili.

**GitHub Pages + Supabase non bastano per questo codice così com’è.** Pages hosta solo file statici (niente Node, niente `/ws` persistente). Supabase può dare DB/Realtime, ma il motore di gioco è autoritativo in-process: andrebbe riscritto. Per serate di gioco: Railway / Render / Fly / un VPS con Docker. Opzionale in futuro: client statico su Pages e solo il backend su Railway (due URL, CORS/WS da sistemare).

### Railway

1. Carica questa cartella in un repository GitHub (privato va bene).
2. Su Railway: *New Project* → *Deploy from GitHub repo* → scegli il repository. Railway trova il `Dockerfile` e lo usa.
3. Nelle impostazioni del servizio: *Networking* → *Generate Domain*. Quello è il link da girare ai colleghi.
4. Healthcheck facoltativo: path `/health`.

Non servono variabili d'ambiente.

### Render

*New* → *Web Service* → repository → runtime Docker (oppure Node con build `npm ci` e start `npm start`). Sui piani gratuiti il servizio può andare in sospensione quando è inattivo: la prima connessione ci mette qualche secondo, e le partite in corso al momento della sospensione si perdono. Verifica le condizioni del piano che scegli.

### Docker ovunque

```bash
docker build -t escalation .
docker run -d -p 3000:3000 --restart unless-stopped escalation
```

Dietro un reverse proxy, inoltra anche l'upgrade WebSocket sul path `/ws`.

## Vincoli da conoscere prima del deploy

- **Una sola istanza.** Le stanze vivono in memoria: non scalare a più repliche, altrimenti i giocatori della stessa stanza finiscono su processi diversi.
- **Un riavvio cancella le partite.** Redeploy, crash o sospensione del piano gratuito chiudono le stanze aperte. Per serate di gioco va bene; per tornei lunghi servirebbe la persistenza (es. Redis), che non c'è.
- **Nessun account.** Chiunque abbia il link del sito può creare stanze; per entrare in una stanza serve il codice. Se lo esponi su internet e vuoi limitarne l'uso, mettilo dietro un accesso (es. Cloudflare Access, Tailscale, basic auth sul proxy).

## Variabili d'ambiente (tutte facoltative)

| Variabile | Default | Uso |
|---|---|---|
| `PORT` | 3000 | Porta HTTP e WebSocket |
| `BOT_DELAY` | 900 | Millisecondi tra una mossa e l'altra dei bot |
| `TIMEOUT_SCALE` | 1 | Moltiplicatore dei tempi massimi (0.5 = partite più rapide) |
| `DISCONNECT_GRACE_MS` | 15000 | Tolleranza prima che le mosse di un disconnesso diventino automatiche |
| `MAX_ROOMS` | 200 | Numero massimo di stanze contemporanee |
| `ROOM_MAX_MS` | 14400000 | Età massima stanza (4 h), anche con tab AFK |
| `MAX_CREATES_PER_SOCKET` | 5 | Cap create per connessione WebSocket |
| `MAX_CREATES_PER_IP` | 20 | Cap create per IP / ora |
| `ADMIN_TOKEN` | _(vuoto)_ | Abilita `/admin.html` e `/admin/api/*`. Vuoto = admin spento |

Tempi massimi di default: 90 s per le azioni del proprio turno, 60 s per prepararsi al combattimento, 45 s per la finestra di interferenza (si azzera a ogni carta giocata), 25 s per rispondere a una richiesta di aiuto o a una controproposta, 30 s per la fuga.

## Anti-cheat e sicurezza

Il pubblico è fatto di gente di IT: il client va considerato ostile.

- **Server autoritativo**: il client manda solo intenzioni (`{type:'play', card: 123, side:'m'}`); il server le valida contro lo stato e respinge tutto il resto.
- **Viste filtrate**: ogni giocatore riceve solo la propria mano. Mazzi, mani altrui e carte pescate dagli altri non lasciano mai il server.
- **Casualità lato server** con `crypto.randomInt` (mescolata e dadi).
- Token di sessione casuali (144 bit), confronto a tempo costante.
- WebSocket: payload massimo 4 KB, rate limit di 10 messaggi al secondo per connessione, limite ai tentativi di ingresso, verifica dell'`Origin` (niente connessioni da altri siti), heartbeat per chiudere le connessioni morte.
- HTTP: solo i file del client in whitelist (niente path traversal), CSP restrittiva senza script né stili inline, font servito in locale, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`.
- I nomi dei giocatori vengono ripuliti lato server e tutto il testo è sottoposto a escape lato client.

## Regole in breve

- **Obiettivo**: primo a livello 10 (*root*). L'ultimo livello si prende solo vincendo un combattimento.
- **Turno**: finché sei a livello 1, a inizio turno peschi un Asset (dotazione). Poi apri un ticket (carta scoperta). Minaccia → la combatti subito; qualsiasi altra carta, Sfighe comprese → in mano. Se non hai combattuto puoi *cercare guai* (affronti una Minaccia dalla mano) o *analizzare i log* (peschi coperto). A fine turno massimo 5 carte in mano: scegli tu cosa scartare.
- **Combattimento**: forza = livello + asset + carte a uso singolo. Dopo la preparazione si apre la **finestra di interferenza**: tutti, compreso chi combatte, devono dichiarare «passo». Ogni carta giocata riapre il giro, comprese le Sfighe su chi combatte o su chi lo aiuta. Poi: se sei in vantaggio vinci livelli e tesori, altrimenti tiri il dado per fuggire (5+, Sysadmin 3+).
- **Aiuto**: chi combatte offre a un avversario una quota dei tesori. L'altro può accettare, rifiutare o rilanciare con un'altra cifra; a quel punto risponde chi combatte, e così via fino a tre controproposte. Chi aiuta somma la sua forza e pesca per primo la sua quota. Non guadagna livelli.
- **Sabotaggi ed Esposizione**: potenziare la minaccia altrui, aggiungerne una con *Movimento laterale* o giocare una Sfiga su qualcuno (in qualsiasi momento) costa 1 punto di Esposizione. A 4 scatta l'**audit del SOC**: −1 livello e si riparte da zero. L'*Ingegnere sociale* non lascia tracce.
- **Carte speciali**: alcune Interferenze (mazzo Ticket) e carte a uso singolo (mazzo Asset) hanno una regola propria, scritta sulla scheda e nella wiki: *«Hai un minuto?»* porta via l'aiutante, *Honeypot* annulla l'ultimo sabotaggio, *Change freeze* blocca ogni altra carta, *Falso positivo* annulla il combattimento, *Turno di reperibilità* obbliga un giocatore ad aiutare gratis, *Capro espiatorio* fa pagare a un altro la fuga fallita, *Risposta automatica* rimanda al mittente la prossima Sfiga, *Chiedo all'IA* è un bonus a dado, *Spegni e riaccendi* azzera bonus e interferenze, *Riassegnazione del ticket* passa il combattimento a un altro. Ispirate a Munchkin: *Il malware era nel backup* duplica l'ultima Minaccia (forza, livelli e tesori), *Pair programming* raddoppia la forza base di chi combatte, *Escalation al management* porta la Minaccia al pareggio (vale anche a match point, non contro il Red Teamer), *Pausa pranzo* chiude lo scontro con i tesori ma senza livelli, *Alert a cascata* fa entrare la prossima Minaccia del mazzo. *Change freeze* e *Falso positivo* non fermano chi sta per arrivare a root. Alcune penalità fanno saltare il turno successivo.
- **Asset**: uno slot per tipo (Hardware, Software, Credenziali, Gadget). Ci si equipaggia, si cambia ruolo e si vende in qualsiasi momento, mai durante un combattimento. 1000 di credito = +1 livello (fino al 9).
- **Passo automatico** (attivo di default, si cambia da *Regole*): se non hai carte da combattimento il client passa da solo dopo un ritardo casuale, così il tempo di risposta non rivela la tua mano.

## Struttura

```
server/
  cards.js   dati delle carte
  game.js    motore di gioco (macchina a stati, validazione, viste per giocatore, timeout)
  bots.js    decisioni dei bot, una azione alla volta
  index.js   HTTP statico + WebSocket, stanze, riconnessione, scheduler di bot e timeout
public/      client (HTML, CSS, JS senza dipendenze)
  cards.css  ritaglio di ogni illustrazione sulla propria cornice (generato, vedi sotto)
  fonts/     Archivo variabile (licenza OFL inclusa)
art/
  cards/, board/     carte finite (JPG), dorsi e texture del tavolo
  recolor-cards.py   porta nel gioco le carte originali (PNG viola) ricolorate per famiglia
  build-frames.py    rigenera public/cards.css quando cambiano le carte
test/
  sim.js     partite simulate + fuzzing con azioni ostili, controllo di conservazione delle carte
  ws.js      integrazione: server reale, 3 client WebSocket + 2 bot fino a fine partita
```

```bash
npm test
```

Per misurare il bilanciamento dopo una modifica a carte o regole c'è `node test/balance.js [partite] [giocatori] [--cards]`: gioca partite tra bot con seme fisso e riporta durata, vantaggio di posto, esiti dei combattimenti per minaccia, fonti di livelli guadagnati e persi, ruoli e turni di stallo. Non fa parte di `npm test`.

## Interfaccia

Il tavolo è una scrivania vista dall'alto: gli avversari sono badge aziendali in alto, il tappetino al centro ospita mazzi, ticket scoperto e combattimento, in basso ci sono la tua postazione, la mano a ventaglio e le azioni con il timer. Su schermo largo sta tutto in una sola vista; su telefono mano e azioni restano fisse in basso e il resto scorre sopra.

- Il giallo segna sempre «tocca a te»: turno attivo, carte giocabili in questo momento, mazzo da cui pescare.
- Il mazzo Ticket è cliccabile nel tuo turno (apre un ticket o analizza i log), oltre al pulsante.
- Il tiro di fuga compare come dado al centro del tavolo.
- Ogni zona della partita si ridisegna solo quando cambia: una mossa altrui non tocca la tua mano.

Le carte in `art/cards/` vengono dall'archivio «Carte Cybersecurity PNG» (98 carte, regole stampate), ricolorate per famiglia: rosso Minacce, viola Sfighe, verde Interferenze, blu Ruoli e carte a uso singolo, oro Asset e carte livello. Per rifarle: `python3 art/recolor-cards.py <cartella dei PNG>` (abbina i file per nome; il colore viene da `art/cards-manifest.json`). Le regole sono stampate sulle carte: se cambia il bilanciamento in `server/cards.js`, le carte toccate vanno rigenerate.

Poi `art/build-frames.py` (Python con Pillow e numpy) misura la cornice nera di ogni immagine e scrive in `public/cards.css` le percentuali con cui il CSS la fa combaciare con il bordo della carta. Va rilanciato quando si aggiungono o cambiano illustrazioni; `npm test` segnala le carte senza ritaglio.

## Limiti noti

- I bot sono semplici: sabotano soprattutto chi è in testa e accettano l'aiuto solo se il compenso è sufficiente; se è troppo basso rilanciano con la cifra che vogliono.
- Niente chat in partita: le trattative si fanno a voce o sulla chat che usate già.
- Il bilanciamento è tarato su simulazioni tra bot: mediana 12-13 giri a ogni dimensione del tavolo (da 35 turni giocati in 3 a circa 70 in 6), nove partite su dieci entro 15-17 giri. Con persone vere che si coalizzano contro chi è in testa il finale si allunga. I valori si cambiano in `server/cards.js`.
