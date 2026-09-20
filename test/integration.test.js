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
  const protectedDelete = await request(`/api/animals/${animalId}`, { method: 'DELETE', auth: true });
  assert.equal(protectedDelete.response.status, 409);
  await request(`/api/adoptions/${adoptionId}/status`, { method: 'PATCH', auth: true, body: { status: 'em_analise' } });
  let animal = await request(`/api/animals/${animalId}`);
  assert.equal(animal.payload.status, 'em_processo');
  const approved = await request(`/api/adoptions/${adoptionId}/status`, { method: 'PATCH', auth: true, body: { status: 'aprovada' } });
  assert.equal(approved.payload.status, 'aprovada');
  animal = await request(`/api/animals/${animalId}`);
  assert.equal(animal.payload.status, 'adotado');
  const unavailable = await request('/api/adoptions', { method: 'POST', body: {
    animalId, applicantName: 'João da Silva', email: 'joao@example.com', phone: '21988887777',
    housingType: 'casa', hasOtherPets: false,
    reason: 'Tenho uma casa segura e disponibilidade para oferecer todos os cuidados necessários.'
  } });
  assert.equal(unavailable.response.status, 409);
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
});

test('encerra a sessão e invalida o token', async () => {
  const logout = await request('/api/auth/logout', { method: 'POST', auth: true });
  assert.equal(logout.response.status, 204);
  const me = await request('/api/auth/me', { auth: true });
  assert.equal(me.response.status, 401);
});
