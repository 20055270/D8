// Importa i moduli
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session');

// Inizializza Express
const app = express();
const PORT = process.env.PORT || 3000;

// Percorsi robusti quando il file è in /src
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DB_PATH = path.join(__dirname, '..', 'social_stats.db');

//indirizza direttamente alla cartella public
app.use(express.static(PUBLIC_DIR));

// Middleware per leggere JSON
app.use(express.json());

//log mi serve per capire quale db sta aprendo
console.log("DB path:", DB_PATH);

// Connessione al database SQLite
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Errore di connessione al DB:', err.message);
  } else {
    console.log('Connesso al database SQLite.');
  }
});

// Avvio server
app.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
});

//configurazione della sessione
app.use(session({
  secret: 'supersegreto', // cambia con una stringa sicura in produzione
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Restituisce i dati della sessione utente
app.get('/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

//-------- da qui in poi ci sono le richieste che mi servon all'interno delle pagine ------//

// Rotta per ottenere tutte le statistiche
app.get('/stats', (req, res) => {
  db.all('SELECT * FROM stats', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ stats: rows });
  });
});

// Rotta per leggere tutti gli utenti
app.get('/users', (req, res) => {
  db.all('SELECT * FROM users', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ users: rows });
  });
});

//----------------------- gestione dei punti e livello per ogni utente ---------------------//

const BASE = 50;

function getLevelFromPoints(points) {
  const raw = Math.floor(Math.sqrt(points / BASE)) + 1;
  return Math.min(Math.max(raw, 1), 999);
}

function getThresholdForLevel(level) {
  return BASE * (level ** 2);
}

app.post('/users/:id/addPoints', (req, res) => {
  const userId = req.params.id;
  const { points } = req.body;

  db.run(
    `UPDATE users SET points = points + ? WHERE id = ?`,[points, userId],function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      db.get(`SELECT points FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }

        const newLevel = getLevelFromPoints(row.points);

        db.run(
          `UPDATE users SET level = ? WHERE id = ?`,[newLevel, userId],function (err) {
            if (err) {
              res.status(500).json({ error: err.message });
              return;
            }
            res.json({ message: "Punti aggiornati", points: row.points, level: newLevel });
          }
        );
      });
    }
  );
});

const ACTION_POINTS = {
  like: 5,
  new_stat: 20,
  comment: 10,
  share: 15
};

app.post('/users/:id/addAction', (req, res) => {
  const userId = req.params.id;
  const { action } = req.body;

  if (!action || !ACTION_POINTS[action]) {
    return res.status(400).json({ error: 'Azione non valida' });
  }

  const pointsToAdd = ACTION_POINTS[action];

  db.run(
  `INSERT INTO actions (user_id, action, points) VALUES (?, ?, ?)`,
  [userId, action, pointsToAdd]
);


  db.run(
    `UPDATE users SET points = points + ? WHERE id = ?`,
    [pointsToAdd, userId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Utente non trovato' });

      db.get(`SELECT points FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        const newLevel = getLevelFromPoints(row.points);

        db.run(
          `UPDATE users SET level = ? WHERE id = ?`,
          [newLevel, userId],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });

            res.json({
              message: `Azione "${action}" registrata: +${pointsToAdd} punti`,
              totalPoints: row.points,
              level: newLevel
            });
          }
        );
      });
    }
  );
});

app.get('/leaderboard/top3', (req, res) => {
  db.all(
    'SELECT username, level FROM users ORDER BY points DESC LIMIT 3',
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ top3: rows });
    }
  );
});

const bcrypt = require('bcrypt');
const saltRounds = 10;

app.post('/signup', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Tutti i campi sono obbligatori' });
  }

  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) return res.status(500).json({ error: 'Errore hashing password' });

    db.run(
      `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')`,
      [username, email, hash],
      function (err) {
        if (err) {
          console.error("Errore DB:", err.message);
          res.status(400).json({ error: err.message });
        } else {
          res.json({ 
            message: 'Registrazione completata',
            userId: this.lastID,
            redirect:'profile.html'
          });
        }
      }
    );
  });
});

app.post('/login', (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Inserisci username/email e password' });
  }

  db.get(
    `SELECT * FROM users WHERE username = ? OR email = ?`,
    [identifier, identifier],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Errore DB' });
      if (!row) return res.status(401).json({ error: 'Utente non trovato' });
      
      bcrypt.compare(password, row.password, (err, result) => {
        if (result) {
          req.session.user = {
                              id: row.id,
                              username: row.username,
                              role: row.role
                            };

          res.json({
                    message: 'Login effettuato',
                    redirect: 'profile.html',
                    user: req.session.user
                  });

        } else {
          res.status(401).json({ error: 'Password errata' });
        }
      });
    }
  );
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logout effettuato' });
  });
});

app.get('/users/:id/actions', (req, res) => {
  const userId = req.params.id;
  db.all(
    `SELECT action, points, date FROM actions WHERE user_id = ? ORDER BY date DESC LIMIT 10`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ actions: rows });
    }
  );
});

app.get('/users/:id/classifications', (req, res) => {
  const userId = req.params.id;

  db.all(
    `SELECT c.id, c.name
     FROM classifications c
     JOIN user_classifications uc ON c.id = uc.classification_id
     WHERE uc.user_id = ?`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.json({ classifications: [] });

      const results = [];
      let processed = 0;

      rows.forEach(row => {
        db.all(
          `SELECT user_id, SUM(value) as totalValue
           FROM stats
           WHERE classification_id = ?
           GROUP BY user_id
           ORDER BY totalValue DESC`,
          [row.id],
          (err, ranking) => {
            if (err) return res.status(500).json({ error: err.message });

            const position = ranking.findIndex(r => r.user_id == userId) + 1;
            const userValue = ranking.find(r => r.user_id == userId)?.totalValue || 0;

            results.push({
              classification: row.name,
              value: userValue,
              position: position || null,
              totalUsers: ranking.length
            });

            processed++;
            if (processed === rows.length) {
              res.json({ classifications: results });
            }
          }
        );
      });
    }
  );
});

app.post('/users/:id/role', (req, res) => {
  const userId = req.params.id;
  const { role } = req.body;

  if (!role || !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Ruolo non valido' });
  }

  db.run(
    `UPDATE users SET role = ? WHERE id = ?`,
    [role, userId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Utente non trovato' });
      }
      res.json({ message: `Ruolo aggiornato a ${role} per utente con id ${userId}` });
    }
  );
});

app.delete('/users/:id', (req, res) => {
  const userId = req.params.id;

  db.run(
    `DELETE FROM users WHERE id = ?`,
    [userId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Utente non trovato' });
      }
      res.json({ message: `Utente con id ${userId} eliminato` });
    }
  );
});

app.get('/users/:id/profile', (req, res) => {
  const userId = req.params.id;

  db.get(
    `
    SELECT 
      u.username,
      u.email,
      (SELECT COUNT(*) FROM actions a WHERE a.user_id = u.id) AS totalActions,
      (SELECT MIN(date) FROM actions a WHERE a.user_id = u.id) AS firstActionDate,
      (SELECT COUNT(*) FROM user_classifications uc WHERE uc.user_id = u.id) AS totalClassifications
    FROM users u
    WHERE u.id = ?
    `,
    [userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Utente non trovato" });
      res.json({ profile: row });
    }
  );
});

app.post('/users/:id/stats', (req, res) => {
  const userId = req.params.id;
  const { classification, title, value, category } = req.body;
  const now = new Date().toISOString();

  db.get(`SELECT id FROM classifications WHERE name = ?`, [classification], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(400).json({ error: "Classifica non trovata" });

    const classificationId = row.id;

    db.run(
      `INSERT INTO stats (user_id, classification_id, title, value, category, date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, classificationId, title, value, category, now],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });

        const actionPoints = 20;
        db.run(
          `INSERT INTO actions (user_id, classification_id, action, points, date)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, classificationId, 'new_stat', actionPoints, now],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });

            db.run(
              `UPDATE users SET points = points + ? WHERE id = ?`,
              [actionPoints, userId],
              function(err) {
                if (err) return res.status(500).json({ error: err.message });

                db.get(`SELECT points FROM users WHERE id = ?`, [userId], (err, row) => {
                  if (err) return res.status(500).json({ error: err.message });

                  const newLevel = getLevelFromPoints(row.points);
                  db.run(
                    `UPDATE users SET level = ? WHERE id = ?`,
                    [newLevel, userId],
                    function(err) {
                      if (err) return res.status(500).json({ error: err.message });
                      res.json({
                        message: "Statistica e azione salvate con successo!",
                        points: row.points,
                        level: newLevel
                      });
                    }
                  );
                });
              }
            );
          }
        );
      }
    );
  });
});

app.get('/classifications/:userId', (req, res) => {
  const userId = req.params.userId;

  db.all(
    `SELECT c.id, c.name,
            (SELECT u.username 
             FROM stats s 
             JOIN users u ON s.user_id = u.id
             WHERE s.classification_id = c.id
             GROUP BY s.user_id
             ORDER BY SUM(s.value) DESC
             LIMIT 1) AS topUser,
            (SELECT COUNT(DISTINCT user_id) 
             FROM user_classifications uc 
             WHERE uc.classification_id = c.id) AS subscribers
     FROM classifications c
     ORDER BY subscribers DESC
     LIMIT 10`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ classifications: rows });
    }
  );
});

app.get('/classifications/:id/details', (req, res) => {
  const classificaId = req.params.id;

  db.get(`SELECT name FROM classifications WHERE id = ?`, [classificaId], (err, classifica) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!classifica) return res.status(404).json({ error: "Classifica non trovata" });

    db.get(
    `SELECT name, description FROM classifications WHERE id = ?`,
    [classificaId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Classifica non trovata" });

    db.all(
      `SELECT u.username, SUM(s.value) AS total
       FROM stats s
       JOIN users u ON s.user_id = u.id
       WHERE s.classification_id = ?
       GROUP BY s.user_id
       ORDER BY total DESC
       LIMIT 10`,
      [classificaId],
      (err, ranking) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json({
          name: classifica.name,
          description: classifica.description,
          ranking
        });
      }
    );
    });
  });
});

app.post('/users/:id/subscribe', (req, res) => {
  const userId = req.params.id;
  const { classification_id } = req.body;

  db.get(
    `SELECT id FROM user_classifications WHERE user_id = ? AND classification_id = ?`,
    [userId, classification_id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      if (row) {
        return res.status(400).json({ message: "Sei già iscritto a questa classifica." });
      }

      db.run(
        `INSERT INTO user_classifications (user_id, classification_id)
         VALUES (?, ?)`,
        [userId, classification_id],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Iscrizione completata con successo!" });
        }
      );
    }
  );
});

// Fine iscrizione classifica
