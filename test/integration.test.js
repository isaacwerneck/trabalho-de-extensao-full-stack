import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let baseUrl;
let db;
let tempDir;
let token;
let animalId;
let adoptionId;
let needId;
let donationId;

async function request(route, { method = 'GET', body, auth = false } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(auth ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patas-test-'));
  const created = createApp({
    databasePath: path.join(tempDir, 'test.sqlite'),
    uploadDir: path.join(tempDir, 'uploads'),
    adminEmail: 'teste@patas.local',
    adminPassword: 'SenhaSegura123!'
  });
  db = created.db;
  server = created.app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('entrega a interface e informa a saúde da API', async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Patas na Rua/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const { response, payload } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { status: 'ok', service: 'patas-na-rua' });
});

test('lista e filtra os animais sem autenticação', async () => {
  const all = await request('/api/animals');
  assert.equal(all.response.status, 200);
  assert.ok(all.payload.length >= 3);
  const cats = await request('/api/animals?species=gato');
  assert.ok(cats.payload.every(animal => animal.species === 'gato'));
  const paginated = await request('/api/animals?status=disponivel&size=pequeno&q=carinhoso&page=1&limit=2');
  assert.equal(paginated.response.status, 200);
  assert.equal(paginated.payload.pagination.page, 1);
  assert.ok(paginated.payload.items.length <= 2);
  assert.ok(paginated.payload.items.every(animal => animal.status === 'disponivel' && animal.size === 'pequeno'));
});

test('protege operações administrativas', async () => {
  const { response, payload } = await request('/api/animals', { method: 'POST', body: {} });
  assert.equal(response.status, 401);
  assert.match(payload.error, /Autenticação/);
});

test('rejeita login inválido e autentica administrador válido', async () => {
  const invalid = await request('/api/auth/login', { method: 'POST', body: { email: 'teste@patas.local', password: 'senha-incorreta' } });
  assert.equal(invalid.response.status, 401);
  const valid = await request('/api/auth/login', { method: 'POST', body: { email: 'teste@patas.local', password: 'SenhaSegura123!' } });
  assert.equal(valid.response.status, 200);
  assert.ok(valid.payload.token);
  token = valid.payload.token;
  const me = await request('/api/auth/me', { auth: true });
  assert.equal(me.payload.user.email, 'teste@patas.local');
});

test('valida e executa o CRUD de animais', async () => {
  const invalid = await request('/api/animals', { method: 'POST', auth: true, body: { name: 'X' } });
  assert.equal(invalid.response.status, 400);
  const created = await request('/api/animals', { method: 'POST', auth: true, body: {
    name: 'Amora', species: 'cao', sex: 'femea', ageYears: 3, size: 'medio',
    description: 'Dócil, vacinada e muito companheira durante os passeios.', photoUrl: '', status: 'disponivel',
    vaccinationStatus: 'em_dia', neutered: true, dewormed: true,
    specialNeeds: 'Precisa de passeios leves.', healthNotes: 'Avaliação veterinária realizada recentemente.'
  } });
  assert.equal(created.response.status, 201);
  animalId = created.payload.id;
  const updated = await request(`/api/animals/${animalId}`, { method: 'PUT', auth: true, body: { ...created.payload, ageYears: 3.5 } });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.ageYears, 3.5);
  assert.equal(updated.payload.vaccinationStatus, 'em_dia');
  assert.equal(updated.payload.neutered, true);
  assert.equal(updated.payload.specialNeeds, 'Precisa de passeios leves.');
});

test('envia imagem validada para o cadastro de animais', async () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  const response = await fetch(`${baseUrl}/api/uploads/images`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' }, body: image
  });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.match(payload.url, /^\/uploads\/[\w-]+\.jpg$/);
  assert.equal(fs.existsSync(path.join(tempDir, payload.url.replace('/uploads/', 'uploads/'))), true);
  const invalid = await fetch(`${baseUrl}/api/uploads/images`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' }, body: Buffer.from('arquivo falso')
  });
  assert.equal(invalid.status, 400);
});

test('recebe uma adoção e aplica suas regras de status', async () => {
  const invalid = await request('/api/adoptions', { method: 'POST', body: { animalId } });
  assert.equal(invalid.response.status, 400);
  const created = await request('/api/adoptions', { method: 'POST', body: {
    animalId, applicantName: 'Maria da Silva', email: 'maria@example.com', phone: '21999998888',
    housingType: 'casa', hasOtherPets: true,
    reason: 'Tenho espaço seguro, experiência com cães e tempo diário para passeios e cuidados.'
  } });
  assert.equal(created.response.status, 201);
  adoptionId = created.payload.id;
  const duplicate = await request('/api/adoptions', { method: 'POST', body: {
    animalId, applicantName: 'Maria da Silva', email: 'MARIA@example.com', phone: '21999998888',
    housingType: 'casa', hasOtherPets: true,
    reason: 'Quero reforçar a mesma solicitação, mas o sistema deve identificar a duplicidade.'
  } });
  assert.equal(duplicate.response.status, 409);
  await request(`/api/adoptions/${adoptionId}/status`, { method: 'PATCH', auth: true, body: { status: 'em_analise' } });
  let animal = await request(`/api/animals/${animalId}`);
  assert.equal(animal.payload.status, 'em_processo');
  const approved = await request(`/api/adoptions/${adoptionId}/status`, { method: 'PATCH', auth: true, body: { status: 'aprovada' } });
  assert.equal(approved.payload.status, 'aprovada');
  assert.deepEqual(approved.payload.history.map(item => item.newStatus), ['recebida', 'em_analise', 'aprovada']);
  const invalidTransition = await request(`/api/adoptions/${adoptionId}/status`, { method: 'PATCH', auth: true, body: { status: 'recusada' } });
  assert.equal(invalidTransition.response.status, 409);
  animal = await request(`/api/animals/${animalId}`);
  assert.equal(animal.payload.status, 'adotado');
  const unavailable = await request('/api/adoptions', { method: 'POST', body: {
    animalId, applicantName: 'João da Silva', email: 'joao@example.com', phone: '21988887777',
    housingType: 'casa', hasOtherPets: false,
    reason: 'Tenho uma casa segura e disponibilidade para oferecer todos os cuidados necessários.'
  } });
  assert.equal(unavailable.response.status, 409);
  const archived = await request(`/api/animals/${animalId}`, { method: 'DELETE', auth: true });
  assert.equal(archived.response.status, 204);
  const hidden = await request(`/api/animals/${animalId}`);
  assert.equal(hidden.response.status, 404);
  const restored = await request(`/api/animals/${animalId}/restore`, { method: 'PATCH', auth: true });
  assert.equal(restored.payload.archivedAt, null);
});

test('executa o CRUD de necessidades', async () => {
  const created = await request('/api/needs', { method: 'POST', auth: true, body: {
    title: 'Areia para gatos', description: 'Reposição para os gatos acolhidos.', priority: 'media',
    targetQuantity: 30, currentQuantity: 5, unit: 'kg', active: true
  } });
  assert.equal(created.response.status, 201);
  needId = created.payload.id;
  const updated = await request(`/api/needs/${needId}`, { method: 'PUT', auth: true, body: { ...created.payload, currentQuantity: 18 } });
  assert.equal(updated.payload.currentQuantity, 18);
  const removed = await request(`/api/needs/${needId}`, { method: 'DELETE', auth: true });
  assert.equal(removed.response.status, 204);
  const adminNeeds = await request('/api/admin/needs', { auth: true });
  assert.equal(adminNeeds.payload.find(need => need.id === needId).archivedAt !== null, true);
  const restored = await request(`/api/needs/${needId}/restore`, { method: 'PATCH', auth: true });
  assert.equal(restored.payload.archivedAt, null);
});

test('registra, confirma e contabiliza uma doação', async () => {
  const invalid = await request('/api/donations', { method: 'POST', body: {
    donorName: 'Ana Souza', email: 'ana@example.com', type: 'financeira', amount: 0
  } });
  assert.equal(invalid.response.status, 400);
  const created = await request('/api/donations', { method: 'POST', body: {
    donorName: 'Ana Souza', email: 'ana@example.com', type: 'financeira', amount: 125.5
  } });
  assert.equal(created.response.status, 201);
  donationId = created.payload.id;
  const confirmed = await request(`/api/donations/${donationId}/status`, { method: 'PATCH', auth: true, body: { status: 'confirmada' } });
  assert.equal(confirmed.payload.status, 'confirmada');
  const stats = await request('/api/stats');
  assert.equal(stats.payload.confirmedDonations, 125.5);
  const dashboard = await request('/api/admin/dashboard', { auth: true });
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.payload.animals.total >= 1);
  assert.equal(dashboard.payload.adoptions.aprovada, 1);
  assert.equal(dashboard.payload.donations.confirmedAmount, 125.5);
  assert.equal(typeof dashboard.payload.needs.averageProgress, 'number');
  const auditLogs = await request('/api/audit-logs', { auth: true });
  assert.equal(auditLogs.response.status, 200);
  assert.ok(auditLogs.payload.some(log => log.action === 'alterou_status' && log.entityType === 'doacao'));
  assert.ok(auditLogs.payload.some(log => log.action === 'criou' && log.entityType === 'animal'));
});

test('encerra a sessão e invalida o token', async () => {
  const logout = await request('/api/auth/logout', { method: 'POST', auth: true });
  assert.equal(logout.response.status, 204);
  const me = await request('/api/auth/me', { auth: true });
  assert.equal(me.response.status, 401);
});

test('altera a senha e invalida todas as sessões anteriores', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'teste@patas.local', password: 'SenhaSegura123!' } });
  token = login.payload.token;
  const weak = await request('/api/auth/password', { method: 'PATCH', auth: true, body: { currentPassword: 'SenhaSegura123!', newPassword: 'senhafraca123' } });
  assert.equal(weak.response.status, 400);
  const changed = await request('/api/auth/password', { method: 'PATCH', auth: true, body: { currentPassword: 'SenhaSegura123!', newPassword: 'NovaSenhaSegura456!' } });
  assert.equal(changed.response.status, 204);
  const expired = await request('/api/auth/me', { auth: true });
  assert.equal(expired.response.status, 401);
  const oldLogin = await request('/api/auth/login', { method: 'POST', body: { email: 'teste@patas.local', password: 'SenhaSegura123!' } });
  assert.equal(oldLogin.response.status, 401);
  const newLogin = await request('/api/auth/login', { method: 'POST', body: { email: 'teste@patas.local', password: 'NovaSenhaSegura456!' } });
  assert.equal(newLogin.response.status, 200);
  token = newLogin.payload.token;
});
