# Patas na Rua - Plataforma Full Stack

Aplicação para apoiar protetores independentes e pequenas organizações no cadastro de animais, triagem de pedidos de adoção, divulgação de necessidades e registro de doações.

## Tecnologias

- Front-end: HTML semântico, CSS responsivo e JavaScript modular.
- Back-end: Node.js 24 e Express 5.
- Banco de dados: SQLite, por meio do módulo nativo `node:sqlite`.
- Testes: executor nativo `node:test` e testes HTTP de integração.

## Requisitos

- Node.js 24 ou superior.
- pnpm, npm ou outro gerenciador compatível.

## Instalação

```bash
pnpm install
copy .env.example .env
pnpm start
```

Abra `http://localhost:3000`.

Na primeira execução, o sistema cria o banco, as tabelas e dados demonstrativos. Para desenvolvimento, as credenciais padrão são:

- E-mail: `admin@patasnarua.local`
- Senha: `TroqueEstaSenha123!`

Defina `ADMIN_EMAIL` e `ADMIN_PASSWORD` no ambiente antes da primeira execução para trocar essas credenciais. Nunca utilize a senha demonstrativa em produção.
O servidor recusa a inicialização em `NODE_ENV=production` enquanto a senha demonstrativa estiver configurada. A senha também pode ser alterada no painel, encerrando todas as sessões anteriores.

## Testes

```bash
pnpm test
pnpm check
pnpm test:e2e
```

Os testes usam um banco SQLite temporário isolado e não alteram os dados locais da aplicação.

## Restaurar dados demonstrativos

Com o servidor parado, execute:

```bash
pnpm db:reset -- --confirm
```

O comando é bloqueado em produção e atua somente sobre o arquivo SQLite configurado em `DATABASE_PATH`.

## Execução em produção com Docker

Crie o `.env` com uma senha administrativa forte e execute:

```bash
docker compose up --build -d
```

O volume `patas-storage` mantém o banco SQLite e as imagens enviadas mesmo após a recriação do container. O container inclui healthcheck e o servidor encerra conexões e banco de forma segura ao receber um sinal de parada.

## Estrutura

```text
public/          interface entregue pelo Express
src/             servidor, banco, regras, autenticação e API
test/            testes de integração
docs/            requisitos, arquitetura, API, UX e plano de testes
data/            banco SQLite local, criado automaticamente
```

## Principais fluxos

1. Visitante consulta animais e necessidades.
2. Visitante envia um pedido de adoção ou registra uma doação.
3. Administrador entra no painel.
4. Administrador gerencia animais, necessidades e o andamento das solicitações.
5. Administrador mantém a ficha de saúde e envia fotos validadas dos animais.

Consulte a documentação em `docs/` para conhecer o escopo, regras de negócio e contratos da API.
