# social-stats

Semplice progetto Node.js + Express che serve una interfaccia statica in `public/` e usa SQLite per i dati.

Struttura consigliata:

- src/ - codice server (entrypoint `src/index.js`)
- public/ - file statici (HTML/CSS/JS)
- social_stats.db - database SQLite (escluso da git via .gitignore)

Script utili:

- `npm start` - avvia il server (Node)
- `npm run dev` - avvia il server in sviluppo con `nodemon`

Installazione:

```bash
npm install
```

Avvio:

```bash
npm start
```

Note:
- Configura un secret sicuro per le sessioni in produzione e usa HTTPS per i cookie `secure`.
- Valuta di spostare le query DB in moduli separati (models) e mettere le rotte in `routes/` per scalabilità.
