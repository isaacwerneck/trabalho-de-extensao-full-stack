import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './database.js';
import { createSessionToken, hashPassword, hashToken, verifyPassword } from './auth.js';
import { getConfig } from './config.js';
import {
  ValidationError, adoptionPayload, animalPayload, donationPayload, email,
  enumeration, integer, needPayload, number, passwordPayload, text
} from './validation.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const loginAttempts = new Map();

const animalStatuses = ['disponivel', 'em_processo', 'adotado'];
const adoptionStatuses = ['recebida', 'em_analise', 'aprovada', 'recusada'];
const donationStatuses = ['registrada', 'confirmada', 'cancelada'];

function imageExtension(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

const mapAnimal = row => row && ({
  id: row.id, name: row.name, species: row.species, sex: row.sex,
  ageYears: row.age_years, size: row.size, description: row.description,
  photoUrl: row.photo_url, vaccinationStatus: row.vaccination_status,
  neutered: Boolean(row.neutered), dewormed: Boolean(row.dewormed),
  specialNeeds: row.special_needs, healthNotes: row.health_notes,
  archivedAt: row.archived_at, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
});

const mapNeed = row => row && ({
  id: row.id, title: row.title, description: row.description, priority: row.priority,
  targetQuantity: row.target_quantity, currentQuantity: row.current_quantity,
  unit: row.unit, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at
  , archivedAt: row.archived_at
});

const mapAdoption = row => row && ({
  id: row.id, animalId: row.animal_id, animalName: row.animal_name,
  applicantName: row.applicant_name, email: row.email, phone: row.phone,
  housingType: row.housing_type, hasOtherPets: Boolean(row.has_other_pets),
  reason: row.reason, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
});

const mapAdoptionHistory = row => ({
  id: row.id, previousStatus: row.previous_status, newStatus: row.new_status, changedAt: row.changed_at
});

const mapDonation = row => row && ({
  id: row.id, donorName: row.donor_name, email: row.email, type: row.type,
  amount: row.amount, itemDescription: row.item_description, status: row.status,
  createdAt: row.created_at, updatedAt: row.updated_at
});

function notFound(entity = 'Registro') {
  const error = new Error(`${entity} não encontrado.`);
  error.status = 404;
  return error;
}

function readId(value) {
  return integer(value, 'Identificador', { min: 1 });
}

export function createApp(overrides = {}) {
  const config = getConfig(overrides);
  const db = createDatabase(config);
  const app = express();
  fs.mkdirSync(config.uploadDir, { recursive: true });

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    });
    next();
  });
  app.use(express.json({ limit: '50kb' }));

  function requireAdmin(req, res, next) {
    const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
    const session = db.prepare(`SELECT users.id, users.name, users.email, users.role
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND datetime(sessions.expires_at) > datetime('now')`).get(hashToken(token));
    if (!session) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    req.user = session;
    req.tokenHash = hashToken(token);
    next();
  }

  app.post('/api/uploads/images', requireAdmin, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ValidationError('Selecione uma imagem válida.');
    const extension = imageExtension(req.body);
    if (!extension) throw new ValidationError('O conteúdo do arquivo não corresponde a JPEG, PNG ou WebP.');
    const fileName = `${randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(config.uploadDir, fileName), req.body, { flag: 'wx' });
    res.status(201).json({ url: `/uploads/${fileName}` });
  });

  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'patas-na-rua' }));

  app.get('/api/stats', (req, res) => {
    const animals = db.prepare("SELECT COUNT(*) total FROM animals WHERE status = 'disponivel'").get().total;
    const adoptions = db.prepare("SELECT COUNT(*) total FROM adoption_applications WHERE status = 'aprovada'").get().total;
    const needs = db.prepare('SELECT COUNT(*) total FROM needs WHERE active = 1').get().total;
    const donations = db.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE type = 'financeira' AND status = 'confirmada'").get().total;
    res.json({ availableAnimals: animals, completedAdoptions: adoptions, activeNeeds: needs, confirmedDonations: donations });
  });

  app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
    const animalRows = db.prepare('SELECT status, COUNT(*) total FROM animals WHERE archived_at IS NULL GROUP BY status').all();
    const adoptionRows = db.prepare('SELECT status, COUNT(*) total FROM adoption_applications GROUP BY status').all();
    const animals = Object.fromEntries(animalStatuses.map(status => [status, 0]));
    const adoptions = Object.fromEntries(adoptionStatuses.map(status => [status, 0]));
    animalRows.forEach(row => { animals[row.status] = row.total; });
    adoptionRows.forEach(row => { adoptions[row.status] = row.total; });
    const donation = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='financeira' AND status='confirmada' THEN amount ELSE 0 END),0) confirmed_amount,
      COALESCE(SUM(CASE WHEN type='item' AND status='confirmada' THEN 1 ELSE 0 END),0) confirmed_items,
      COALESCE(SUM(CASE WHEN status='registrada' THEN 1 ELSE 0 END),0) pending FROM donations`).get();
    const needs = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN active=1 AND archived_at IS NULL THEN 1 ELSE 0 END) active,
      COALESCE(AVG(CASE WHEN active=1 AND archived_at IS NULL THEN MIN(current_quantity / target_quantity, 1) * 100 END),0) average_progress
      FROM needs`).get();
    res.json({
      animals: { ...animals, total: Object.values(animals).reduce((sum, value) => sum + value, 0) },
      adoptions: { ...adoptions, total: Object.values(adoptions).reduce((sum, value) => sum + value, 0) },
      donations: { confirmedAmount: donation.confirmed_amount, confirmedItems: donation.confirmed_items, pending: donation.pending },
      needs: { total: needs.total, active: needs.active, averageProgress: Math.round(needs.average_progress) }
    });
  });

  app.get('/api/animals', (req, res) => {
    const clauses = ['archived_at IS NULL'];
    const params = [];
    if (req.query.status) {
      clauses.push('status = ?');
      params.push(enumeration(req.query.status, 'Status', animalStatuses));
    }
    if (req.query.species) {
      clauses.push('species = ?');
      params.push(enumeration(req.query.species, 'Espécie', ['cao', 'gato', 'outro']));
    }
    if (req.query.sex) {
      clauses.push('sex = ?');
      params.push(enumeration(req.query.sex, 'Sexo', ['macho', 'femea', 'nao_informado']));
    }
    if (req.query.size) {
      clauses.push('size = ?');
      params.push(enumeration(req.query.size, 'Porte', ['pequeno', 'medio', 'grande']));
    }
    if (req.query.minAge !== undefined) {
      clauses.push('age_years >= ?');
      params.push(number(req.query.minAge, 'Idade mínima', { min: 0, max: 40 }));
    }
    if (req.query.maxAge !== undefined) {
      clauses.push('age_years <= ?');
      params.push(number(req.query.maxAge, 'Idade máxima', { min: 0, max: 40 }));
    }
    if (req.query.q) {
      const search = `%${text(req.query.q, 'Busca', { max: 80 })}%`;
      clauses.push('(name LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)');
      params.push(search, search);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const order = "ORDER BY CASE status WHEN 'disponivel' THEN 0 WHEN 'em_processo' THEN 1 ELSE 2 END, id DESC";
    if (req.query.page !== undefined || req.query.limit !== undefined) {
      const page = integer(req.query.page ?? 1, 'Página', { min: 1, max: 100000 });
      const limit = integer(req.query.limit ?? 8, 'Limite', { min: 1, max: 50 });
      const total = db.prepare(`SELECT COUNT(*) total FROM animals ${where}`).get(...params).total;
      const rows = db.prepare(`SELECT * FROM animals ${where} ${order} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
      return res.json({ items: rows.map(mapAnimal), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
    }
    const rows = db.prepare(`SELECT * FROM animals ${where} ${order}`).all(...params);
    res.json(rows.map(mapAnimal));
  });

  app.get('/api/admin/animals', requireAdmin, (req, res) => {
    const rows = db.prepare(`SELECT * FROM animals
      ORDER BY archived_at IS NOT NULL, CASE status WHEN 'disponivel' THEN 0 WHEN 'em_processo' THEN 1 ELSE 2 END, id DESC`).all();
    res.json(rows.map(mapAnimal));
  });

  app.get('/api/animals/:id', (req, res) => {
    const animal = mapAnimal(db.prepare('SELECT * FROM animals WHERE id = ? AND archived_at IS NULL').get(readId(req.params.id)));
    if (!animal) throw notFound('Animal');
    res.json(animal);
  });

  app.post('/api/animals', requireAdmin, (req, res) => {
    const a = animalPayload(req.body);
    const result = db.prepare(`INSERT INTO animals
      (name,species,sex,age_years,size,description,photo_url,vaccination_status,neutered,dewormed,special_needs,health_notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.name, a.species, a.sex, a.ageYears, a.size, a.description, a.photoUrl,
        a.vaccinationStatus, a.neutered, a.dewormed, a.specialNeeds, a.healthNotes, a.status);
    res.status(201).json(mapAnimal(db.prepare('SELECT * FROM animals WHERE id = ?').get(result.lastInsertRowid)));
  });

  app.put('/api/animals/:id', requireAdmin, (req, res) => {
    const id = readId(req.params.id);
    const a = animalPayload(req.body);
    const result = db.prepare(`UPDATE animals SET name=?,species=?,sex=?,age_years=?,size=?,description=?,photo_url=?,vaccination_status=?,neutered=?,dewormed=?,special_needs=?,health_notes=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(a.name, a.species, a.sex, a.ageYears, a.size, a.description, a.photoUrl, a.vaccinationStatus, a.neutered, a.dewormed, a.specialNeeds, a.healthNotes, a.status, id);
    if (!result.changes) throw notFound('Animal');
    res.json(mapAnimal(db.prepare('SELECT * FROM animals WHERE id = ?').get(id)));
  });

  app.delete('/api/animals/:id', requireAdmin, (req, res) => {
    const id = readId(req.params.id);
    const result = db.prepare('UPDATE animals SET archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND archived_at IS NULL').run(id);
    if (!result.changes) throw notFound('Animal');
    res.status(204).end();
  });

  app.patch('/api/animals/:id/restore', requireAdmin, (req, res) => {
    const id = readId(req.params.id);
    const result = db.prepare('UPDATE animals SET archived_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND archived_at IS NOT NULL').run(id);
    if (!result.changes) throw notFound('Animal arquivado');
    res.json(mapAnimal(db.prepare('SELECT * FROM animals WHERE id=?').get(id)));
  });

  app.post('/api/adoptions', (req, res) => {
    const a = adoptionPayload(req.body);
    const animal = db.prepare('SELECT id,status FROM animals WHERE id = ?').get(a.animalId);
    if (!animal) throw notFound('Animal');
    if (animal.status !== 'disponivel') {
      const error = new Error('Este animal não está disponível para novas solicitações.');
      error.status = 409;
      throw error;
    }
    const duplicate = db.prepare(`SELECT 1 FROM adoption_applications
      WHERE animal_id=? AND email=? COLLATE NOCASE AND status IN ('recebida','em_analise') LIMIT 1`).get(a.animalId, a.email);
    if (duplicate) {
      const error = new Error('Já existe uma solicitação ativa deste e-mail para o animal.');
      error.status = 409;
      throw error;
    }
    db.exec('BEGIN');
    let result;
    try {
      result = db.prepare(`INSERT INTO adoption_applications
        (animal_id,applicant_name,email,phone,housing_type,has_other_pets,reason) VALUES (?,?,?,?,?,?,?)`)
        .run(a.animalId, a.applicantName, a.email, a.phone, a.housingType, a.hasOtherPets, a.reason);
      db.prepare('INSERT INTO adoption_status_history (adoption_id,previous_status,new_status) VALUES (?,NULL,?)')
        .run(result.lastInsertRowid, 'recebida');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ id: Number(result.lastInsertRowid), status: 'recebida', message: 'Solicitação recebida. Entraremos em contato após a análise.' });
  });

  app.get('/api/adoptions', requireAdmin, (req, res) => {
    const status = req.query.status ? enumeration(req.query.status, 'Status', adoptionStatuses) : null;
    const sql = `SELECT a.*, animals.name animal_name FROM adoption_applications a
      JOIN animals ON animals.id = a.animal_id ${status ? 'WHERE a.status = ?' : ''} ORDER BY a.id DESC`;
    const rows = status ? db.prepare(sql).all(status) : db.prepare(sql).all();
    const history = db.prepare('SELECT * FROM adoption_status_history WHERE adoption_id=? ORDER BY id');
    res.json(rows.map(row => ({ ...mapAdoption(row), history: history.all(row.id).map(mapAdoptionHistory) })));
  });

  app.patch('/api/adoptions/:id/status', requireAdmin, (req, res) => {
    const id = readId(req.params.id);
    const status = enumeration(req.body.status, 'Status', adoptionStatuses);
    const adoption = db.prepare('SELECT * FROM adoption_applications WHERE id = ?').get(id);
    if (!adoption) throw notFound('Solicitação');
    if (adoption.status === status) {
      const row = db.prepare(`SELECT a.*, animals.name animal_name FROM adoption_applications a JOIN animals ON animals.id=a.animal_id WHERE a.id=?`).get(id);
      return res.json({ ...mapAdoption(row), history: db.prepare('SELECT * FROM adoption_status_history WHERE adoption_id=? ORDER BY id').all(id).map(mapAdoptionHistory) });
    }
    const transitions = { recebida: ['em_analise', 'recusada'], em_analise: ['aprovada', 'recusada'], aprovada: [], recusada: [] };
    if (!transitions[adoption.status].includes(status)) {
      const error = new Error(`Não é possível alterar uma solicitação ${adoption.status} para ${status}.`);
      error.status = 409;
      throw error;
    }
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE adoption_applications SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
      db.prepare('INSERT INTO adoption_status_history (adoption_id,previous_status,new_status) VALUES (?,?,?)').run(id, adoption.status, status);
      if (status === 'aprovada') {
        db.prepare("UPDATE animals SET status='adotado',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(adoption.animal_id);
        db.prepare("UPDATE adoption_applications SET status='recusada',updated_at=CURRENT_TIMESTAMP WHERE animal_id=? AND id<>? AND status IN ('recebida','em_analise')")
          .run(adoption.animal_id, id);
      } else if (status === 'em_analise') {
        db.prepare("UPDATE animals SET status='em_processo',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='disponivel'").run(adoption.animal_id);
      } else if (status === 'recusada') {
        const pending = db.prepare("SELECT 1 FROM adoption_applications WHERE animal_id=? AND id<>? AND status IN ('em_analise','aprovada') LIMIT 1").get(adoption.animal_id, id);
        if (!pending) db.prepare("UPDATE animals SET status='disponivel',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='em_processo'").run(adoption.animal_id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const row = db.prepare(`SELECT a.*, animals.name animal_name FROM adoption_applications a JOIN animals ON animals.id=a.animal_id WHERE a.id=?`).get(id);
    res.json({ ...mapAdoption(row), history: db.prepare('SELECT * FROM adoption_status_history WHERE adoption_id=? ORDER BY id').all(id).map(mapAdoptionHistory) });
  });

  app.get('/api/needs', (req, res) => {
    const rows = db.prepare('SELECT * FROM needs WHERE active=1 AND archived_at IS NULL ORDER BY CASE priority WHEN \'alta\' THEN 0 WHEN \'media\' THEN 1 ELSE 2 END, id DESC').all();
    res.json(rows.map(mapNeed));
  });

  app.get('/api/admin/needs', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM needs ORDER BY id DESC').all().map(mapNeed)));

  app.post('/api/needs', requireAdmin, (req, res) => {
    const n = needPayload(req.body);
    const result = db.prepare(`INSERT INTO needs (title,description,priority,target_quantity,current_quantity,unit,active) VALUES (?,?,?,?,?,?,?)`)
      .run(n.title, n.description, n.priority, n.targetQuantity, n.currentQuantity, n.unit, n.active);
    res.status(201).json(mapNeed(db.prepare('SELECT * FROM needs WHERE id=?').get(result.lastInsertRowid)));
  });

  app.put('/api/needs/:id', requireAdmin, (req, res) => {
    const id = readId(req.params.id);
    const n = needPayload(req.body);
    const result = db.prepare(`UPDATE needs SET title=?,description=?,priority=?,target_quantity=?,current_quantity=?,unit=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(n.title, n.description, n.priority, n.targetQuantity, n.currentQuantity, n.unit, n.active, id);
    if (!result.changes) throw notFound('Necessidade');
    res.json(mapNeed(db.prepare('SELECT * FROM needs WHERE id=?').get(id)));
  });

  app.delete('/api/needs/:id', requireAdmin, (req, res) => {
    const result = db.prepare('UPDATE needs SET archived_at=CURRENT_TIMESTAMP,active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND archived_at IS NULL').run(readId(req.params.id));
    if (!result.changes) throw notFound('Necessidade');
    res.status(204).end();
  });

  app.patch('/api/needs/:id/restore', requireAdmin, (req, res) => {
    const id = readId(req.params.id);
    const result = db.prepare('UPDATE needs SET archived_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND archived_at IS NOT NULL').run(id);
    if (!result.changes) throw notFound('Necessidade arquivada');
    res.json(mapNeed(db.prepare('SELECT * FROM needs WHERE id=?').get(id)));
  });

  app.post('/api/donations', (req, res) => {
    const d = donationPayload(req.body);
    const result = db.prepare(`INSERT INTO donations (donor_name,email,type,amount,item_description) VALUES (?,?,?,?,?)`)
      .run(d.donorName, d.email, d.type, d.amount, d.itemDescription);
    res.status(201).json({ id: Number(result.lastInsertRowid), status: 'registrada', message: 'Doação registrada. Nossa equipe entrará em contato para confirmar.' });
  });

  app.get('/api/donations', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM donations ORDER BY id DESC').all().map(mapDonation)));

  app.patch('/api/donations/:id/status', requireAdmin, (req, res) => {
    const id = readId(req.params.id);
    const status = enumeration(req.body.status, 'Status', donationStatuses);
    const result = db.prepare('UPDATE donations SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
    if (!result.changes) throw notFound('Doação');
    res.json(mapDonation(db.prepare('SELECT * FROM donations WHERE id=?').get(id)));
  });

  app.post('/api/auth/login', (req, res) => {
    const key = req.ip;
    const attempt = loginAttempts.get(key) ?? { count: 0, resetAt: Date.now() + 15 * 60_000 };
    if (Date.now() > attempt.resetAt) Object.assign(attempt, { count: 0, resetAt: Date.now() + 15 * 60_000 });
    if (attempt.count >= 10) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const loginEmail = email(req.body.email);
    const password = text(req.body.password, 'Senha', { min: 8, max: 200 });
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(loginEmail);
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      attempt.count += 1;
      loginAttempts.set(key, attempt);
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }
    loginAttempts.delete(key);
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + config.sessionHours * 3_600_000).toISOString();
    db.prepare('INSERT INTO sessions (user_id,token_hash,expires_at) VALUES (?,?,?)').run(user.id, hashToken(token), expiresAt);
    res.json({ token, expiresAt, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  app.get('/api/auth/me', requireAdmin, (req, res) => res.json({ user: req.user }));
  app.patch('/api/auth/password', requireAdmin, (req, res) => {
    const passwords = passwordPayload(req.body);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!verifyPassword(passwords.currentPassword, user.password_salt, user.password_hash)) {
      const error = new Error('Senha atual incorreta.');
      error.status = 401;
      throw error;
    }
    const password = hashPassword(passwords.newPassword);
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(password.hash, password.salt, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(204).end();
  });
  app.post('/api/auth/logout', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.tokenHash);
    res.status(204).end();
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', immutable: true }));
  app.use(express.static(publicDir, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\.(?:woff2|jpg|jpeg|png|webp)$/i.test(filePath)) res.set('Cache-Control', 'public, max-age=2592000, immutable');
      else if (/\.html$/i.test(filePath)) res.set('Cache-Control', 'no-cache');
      else res.set('Cache-Control', 'public, max-age=86400');
    }
  }));
  app.get('*path', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'JSON inválido.' });
    const status = error.status ?? (error instanceof ValidationError ? 400 : 500);
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? 'Erro interno do servidor.' : error.message });
  });

  return { app, db, config };
}
