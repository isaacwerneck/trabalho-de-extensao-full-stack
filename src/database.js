import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.js';

const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE TABLE IF NOT EXISTS animals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    species TEXT NOT NULL CHECK(species IN ('cao','gato','outro')),
    sex TEXT NOT NULL CHECK(sex IN ('macho','femea','nao_informado')),
    age_years REAL NOT NULL CHECK(age_years >= 0),
    size TEXT NOT NULL CHECK(size IN ('pequeno','medio','grande')),
    description TEXT NOT NULL,
    photo_url TEXT,
    vaccination_status TEXT NOT NULL DEFAULT 'nao_informado' CHECK(vaccination_status IN ('nao_informado','em_dia','parcial','pendente')),
    neutered INTEGER NOT NULL DEFAULT 0 CHECK(neutered IN (0,1)),
    dewormed INTEGER NOT NULL DEFAULT 0 CHECK(dewormed IN (0,1)),
    special_needs TEXT,
    health_notes TEXT,
    status TEXT NOT NULL DEFAULT 'disponivel' CHECK(status IN ('disponivel','em_processo','adotado')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE TABLE IF NOT EXISTS adoption_applications (
    id INTEGER PRIMARY KEY,
    animal_id INTEGER NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    applicant_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    housing_type TEXT NOT NULL CHECK(housing_type IN ('casa','apartamento','outro')),
    has_other_pets INTEGER NOT NULL DEFAULT 0 CHECK(has_other_pets IN (0,1)),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'recebida' CHECK(status IN ('recebida','em_analise','aprovada','recusada')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE TABLE IF NOT EXISTS adoption_status_history (
    id INTEGER PRIMARY KEY,
    adoption_id INTEGER NOT NULL REFERENCES adoption_applications(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL CHECK(new_status IN ('recebida','em_analise','aprovada','recusada')),
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE TABLE IF NOT EXISTS needs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('alta','media','baixa')),
    target_quantity REAL NOT NULL CHECK(target_quantity > 0),
    current_quantity REAL NOT NULL DEFAULT 0 CHECK(current_quantity >= 0),
    unit TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY,
    donor_name TEXT NOT NULL,
    email TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('financeira','item')),
    amount REAL,
    item_description TEXT,
    status TEXT NOT NULL DEFAULT 'registrada' CHECK(status IN ('registrada','confirmada','cancelada')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK((type = 'financeira' AND amount > 0) OR (type = 'item' AND item_description IS NOT NULL))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_animals_status ON animals(status);
  CREATE INDEX IF NOT EXISTS idx_adoptions_status ON adoption_applications(status);
  CREATE INDEX IF NOT EXISTS idx_adoption_history ON adoption_status_history(adoption_id, id);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
`;

export function createDatabase(config) {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(schema);
  migrate(db);
  seed(db, config);
  return db;
}

function migrate(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(animals)').all().map(column => column.name));
  const migrations = [
    ['vaccination_status', "TEXT NOT NULL DEFAULT 'nao_informado' CHECK(vaccination_status IN ('nao_informado','em_dia','parcial','pendente'))"],
    ['neutered', 'INTEGER NOT NULL DEFAULT 0 CHECK(neutered IN (0,1))'],
    ['dewormed', 'INTEGER NOT NULL DEFAULT 0 CHECK(dewormed IN (0,1))'],
    ['special_needs', 'TEXT'],
    ['health_notes', 'TEXT']
  ];
  for (const [name, definition] of migrations) {
    if (!columns.has(name)) db.exec(`ALTER TABLE animals ADD COLUMN ${name} ${definition}`);
  }
}

function seed(db, config) {
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const password = hashPassword(config.adminPassword);
    db.prepare('INSERT INTO users (name,email,password_hash,password_salt) VALUES (?,?,?,?)')
      .run(config.adminName, config.adminEmail, password.hash, password.salt);
  }
  seedAnimalCatalog(db);
  if (!db.prepare('SELECT 1 FROM needs LIMIT 1').get()) {
    const insert = db.prepare(`INSERT INTO needs
      (title,description,priority,target_quantity,current_quantity,unit) VALUES (?,?,?,?,?,?)`);
    insert.run('Ração para cães', 'Reposição mensal para os animais acolhidos.', 'alta', 80, 34, 'kg');
    insert.run('Medicamentos veterinários', 'Ajuda para tratamentos e prevenção.', 'alta', 20, 7, 'unidades');
    insert.run('Cobertores e caminhas', 'Itens limpos e em bom estado para o abrigo.', 'media', 25, 16, 'unidades');
  }
}

function seedAnimalCatalog(db) {
  const currentVersion = db.prepare("SELECT value FROM app_metadata WHERE key='demo_catalog_version'").get()?.value;
  const applications = db.prepare('SELECT COUNT(*) total FROM adoption_applications').get().total;
  const customAnimals = db.prepare("SELECT COUNT(*) total FROM animals WHERE name NOT IN ('Luna','Bento','Sol')").get().total;

  if (currentVersion !== '2' && applications === 0 && customAnimals === 0) {
    db.prepare('DELETE FROM animals').run();
  }

  if (!db.prepare('SELECT 1 FROM animals LIMIT 1').get()) {
    const insert = db.prepare(`INSERT INTO animals
      (name,species,sex,age_years,size,description,photo_url,vaccination_status,neutered,dewormed,special_needs,health_notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run('Cacau', 'cao', 'femea', 3, 'medio', 'Doce, companheira e apaixonada por passeios. Convive bem com adultos e procura uma casa com rotina ativa.', '/assets/animals/cacau.jpg', 'em_dia', 1, 1, null, 'Acompanhamento veterinário preventivo em dia.', 'disponivel');
    insert.run('Nino', 'cao', 'macho', 2, 'pequeno', 'Curioso, brincalhão e muito sociável. Gosta de companhia e se adapta bem a ambientes menores.', '/assets/animals/nino.jpg', 'em_dia', 1, 1, null, null, 'disponivel');
    insert.run('Joca', 'cao', 'macho', 4, 'medio', 'Calmo e observador, adora carinho e caminhadas tranquilas. Precisa de uma família paciente nos primeiros dias.', '/assets/animals/joca.jpg', 'parcial', 1, 1, null, 'Aguardando reforço anual da vacina múltipla.', 'em_processo');
    insert.run('Pipoca', 'gato', 'femea', 1, 'pequeno', 'Jovem, curiosa e cheia de personalidade. Adora brinquedos, lugares altos e uma boa janela ensolarada.', '/assets/animals/pipoca.jpg', 'em_dia', 1, 1, null, null, 'disponivel');
    insert.run('Zeca', 'gato', 'macho', 2, 'pequeno', 'Carinhoso e tranquilo, costuma pedir colo quando ganha confiança. Está acostumado a viver dentro de casa.', '/assets/animals/zeca.jpg', 'em_dia', 1, 1, 'Prefere um lar sem acesso à rua.', 'Sem restrições clínicas conhecidas.', 'disponivel');
    insert.run('Amora', 'gato', 'femea', 3, 'pequeno', 'Gentil e independente, gosta de ambientes silenciosos e já está em adaptação com uma possível família.', '/assets/animals/amora.jpg', 'em_dia', 1, 1, null, null, 'em_processo');
  }

  db.prepare(`INSERT INTO app_metadata (key,value) VALUES ('demo_catalog_version','2')
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
}
