import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app.js';

let server;
let db;
let tempDir;
let baseUrl;

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patas-e2e-'));
  const created = createApp({
    databasePath: path.join(tempDir, 'e2e.sqlite'),
    uploadDir: path.join(tempDir, 'uploads'),
    adminEmail: 'e2e@patas.local',
    adminPassword: 'SenhaE2eSegura123!'
  });
  db = created.db;
  server = created.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('visitante pesquisa, consulta ficha e acessa o painel administrativo', async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: /Todo encontro pode mudar/ })).toBeVisible();
  await expect(page.locator('.animal-card')).toHaveCount(4);

  await page.getByRole('searchbox', { name: /Buscar por nome/ }).fill('carinhoso');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.locator('.animal-card')).toHaveCount(1);
  await expect(page.locator('.animal-card')).toContainText('Zeca');

  await page.getByRole('button', { name: 'Ver ficha' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Zeca', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Vacinação');
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();

  await page.getByRole('button', { name: 'Área da equipe' }).click();
  await page.getByRole('dialog').getByLabel('E-mail').fill('e2e@patas.local');
  await page.getByRole('dialog').getByLabel('Senha').fill('SenhaE2eSegura123!');
  await page.getByRole('dialog').getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Painel da equipe' })).toBeVisible();
  await expect(page.locator('#admin-dashboard')).toContainText('Animais');

  await page.getByRole('button', { name: 'Novo animal' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Novo animal' })).toBeVisible();
});
