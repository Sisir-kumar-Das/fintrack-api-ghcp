# FinTrack API

FinTrack is a Node.js and Express API for recording personal transactions,
creating shared expenses, and calculating balances between participants. It
uses MongoDB through Mongoose and stores monetary values as integer cents to
avoid floating-point rounding errors.

> **Current authentication status:** this repository contains a development and
> test authentication stub. It reads `x-user-id` and sets `req.user.id` from
> that header. The header is not proof of identity and must be replaced with
> real authentication before the API is used outside a trusted local
> environment.

## Contents

- [Project summary](#project-summary)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Request lifecycle and architecture](#request-lifecycle-and-architecture)
- [Initialization from a fresh checkout](#initialization-from-a-fresh-checkout)
- [Environment configuration](#environment-configuration)
- [Running the API](#running-the-api)
- [Authentication during local development](#authentication-during-local-development)
- [API reference](#api-reference)
- [Data and business rules](#data-and-business-rules)
- [Testing](#testing)
- [Logging and error handling](#logging-and-error-handling)
- [Security and production readiness](#security-and-production-readiness)
- [Development workflow](#development-workflow)
- [Implementation summary](#implementation-summary)

## Project summary

The API currently supports two bounded domains:

1. **Transactions**
   - Create a transaction owned by the authenticated user.
   - Retrieve the user's active transactions with bounded pagination.
   - Soft-delete all active transactions belonging to the user.
   - Support idempotent creation with an optional idempotency key.
2. **Shared expenses**
   - Create an expense paid by the authenticated user.
   - Split the expense equally or by explicit participant shares.
   - Calculate signed net balances against every relevant counterpart.

The code follows the intended layering:

```text
Route -> Controller -> Service -> Repository -> Mongoose Model
```

Routes define HTTP paths, controllers translate HTTP requests and responses,
services enforce business rules, repositories encapsulate persistence, and
models define MongoDB schemas and indexes.

## Technology stack

- Node.js using a current LTS-compatible release
- JavaScript with CommonJS modules
- Express 5
- MongoDB with Mongoose 9
- Pino structured logging
- Jest 30 and Supertest 7 for tests
- dotenv for loading local environment variables

## Repository structure

```text
.
├── .github/
│   └── copilot-instructions.md     Project engineering conventions
├── src/
│   ├── app.js                      Express app, middleware, routes, errors
│   ├── server.js                   dotenv, MongoDB connection, HTTP startup
│   ├── config/
│   │   ├── currencies.js           ISO 4217 currency allowlist
│   │   └── logger.js               Shared redacted Pino logger
│   ├── transactions/
│   │   ├── transaction.routes.js
│   │   ├── transaction.controller.js
│   │   ├── transaction.service.js
│   │   ├── transaction.repository.js
│   │   ├── transaction.model.js
│   │   └── transaction.errors.js
│   └── expenses/
│       ├── sharedExpense.routes.js
│       ├── sharedExpense.controller.js
│       ├── sharedExpense.service.js
│       ├── sharedExpense.repository.js
│       ├── sharedExpense.model.js
│       └── sharedExpense.errors.js
├── tests/
│   ├── transactions/
│   └── expenses/
├── package.json
├── package-lock.json
└── README.md
```

Generated `node_modules/`, coverage reports, environment files, and local
secrets are excluded by `.gitignore`.

## Request lifecycle and architecture

1. `src/server.js` loads `.env`, validates `MONGODB_URI`, connects to MongoDB,
   and starts the HTTP listener.
2. `src/app.js` enables JSON parsing and installs the local authentication
   stub.
3. A route selects the controller for the request.
4. The controller obtains the authenticated user ID, calls the service, and
   maps domain errors to safe HTTP responses.
5. The service validates input, applies authorization and financial rules, and
   calls the repository.
6. The repository performs the Mongoose operation with user-scoped filters.
7. The model applies persistence-level validation and indexes.
8. Unexpected errors reach the final middleware, which logs structured context
   and returns a generic `500` response without internal details.

## Initialization from a fresh checkout

### 1. Install prerequisites

Install:

- Node.js LTS
- npm (installed with Node.js)
- A running MongoDB instance, either local or hosted
- Git, if cloning the repository

Verify the runtime:

```powershell
node --version
npm --version
```

### 2. Clone and enter the repository

```powershell
git clone https://github.com/Sisir-kumar-Das/fintrack-api-ghcp.git
cd fintrack-api
```

Use the repository's configured default branch:

```powershell
git checkout main
```

### 3. Install locked dependencies

Use `npm ci` for a reproducible installation from `package-lock.json`:

```powershell
npm ci
```

Use `npm install` only when intentionally changing dependencies and updating
the lockfile.

### 4. Prepare MongoDB

Start MongoDB locally or create a database on a hosted MongoDB provider. The
database does not need pre-created collections; Mongoose creates collections
when the first documents are written.

### 5. Create local environment configuration

Create a `.env` file in the project root:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/fintrack
PORT=3000
LOG_LEVEL=info
```

Do not commit `.env`. It is ignored by Git.

### 6. Run the test suite

```powershell
npm test -- --runInBand
```

The current suite covers service and controller behavior for transactions and
shared expenses. Tests mock repositories and do not require a live MongoDB
connection.

### 7. Start the API

```powershell
node src/server.js
```

Successful startup requires a valid `MONGODB_URI`. The server listens on
`PORT`, defaulting to `3000`.

## Environment configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MONGODB_URI` | Yes | None | MongoDB connection string |
| `PORT` | No | `3000` | HTTP port |
| `LOG_LEVEL` | No | `info` | Pino log level |

`src/server.js` exits with a failure status when `MONGODB_URI` is missing or
MongoDB cannot be reached. `src/config/logger.js` redacts passwords, tokens,
authorization headers, cookies, and card numbers from structured logs.

## Running the API

With the server running on port `3000`, a local request can use a valid
24-character MongoDB ObjectId as the development user identity:

```powershell
$headers = @{ "x-user-id" = "507f1f77bcf86cd799439011" }
Invoke-RestMethod -Method Get `
  -Uri http://localhost:3000/api/transactions `
  -Headers $headers
```

The application is exported from `src/app.js`, which makes it possible to test
the HTTP layer without starting a network listener. `src/server.js` is the
process entry point that adds the database connection and listener.

## Authentication during local development

For local development only, `src/app.js` reads:

```text
x-user-id: 507f1f77bcf86cd799439011
```

The services independently validate that the ID is a valid ObjectId-shaped
string and scope repository queries to it. Requests without the header receive
`401 UNAUTHORIZED` from protected controllers.

This stub does not authenticate or authorize a real person. Before production
deployment, replace it with the project's real authentication middleware and
ensure that `req.user.id` comes from a verified identity rather than a client
controlled header.

## API reference

All successful responses use a `data` property. Protected routes require the
development `x-user-id` header described above.

### Transactions

#### Create a transaction

```http
POST /api/transactions
Content-Type: application/json
x-user-id: <user-object-id>
```

Request body:

```json
{
  "description": "Dinner",
  "amountCents": 2599,
  "currency": "USD",
  "idempotencyKey": "dinner-2026-09-20"
}
```

- `description` is required and is trimmed.
- `amountCents` must be a non-negative integer.
- `currency` defaults to `USD` and must be a supported ISO 4217 code.
- `idempotencyKey` is optional, trimmed, and limited to 128 characters.
- A repeated key for the same user returns the existing transaction rather
  than creating a duplicate.

Returns `201`:

```json
{
  "data": {
    "_id": "...",
    "userId": "...",
    "description": "Dinner",
    "amountCents": 2599,
    "currency": "USD",
    "idempotencyKey": "dinner-2026-09-20",
    "deletedAt": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

#### List transactions

```http
GET /api/transactions?limit=25&skip=0
x-user-id: <user-object-id>
```

`limit` defaults to `25` and cannot exceed `100`. `skip` defaults to `0`.
Only active transactions owned by the authenticated user are returned,
newest first.

Returns `200`:

```json
{
  "data": [],
  "pagination": {
    "limit": 25,
    "skip": 0
  }
}
```

#### Soft-delete all transactions

```http
DELETE /api/transactions
x-user-id: <user-object-id>
```

Returns `200`:

```json
{
  "data": {
    "deletedCount": 2
  }
}
```

The records remain in MongoDB with `deletedAt` set and are excluded from
active transaction queries.

### Shared expenses

#### Create a shared expense

```http
POST /api/expenses
Content-Type: application/json
x-user-id: <creator-object-id>
```

Equal split request:

```json
{
  "description": "Groceries",
  "totalAmountCents": 1000,
  "currency": "USD",
  "splitType": "equal",
  "participants": [
    { "userId": "507f1f77bcf86cd799439011" },
    { "userId": "507f191e810c19729de860ea" },
    { "userId": "5f43b93b1c9d440000a1b2c3" }
  ]
}
```

Custom split request:

```json
{
  "description": "Concert tickets",
  "totalAmountCents": 5000,
  "splitType": "custom",
  "participants": [
    { "userId": "507f1f77bcf86cd799439011", "shareCents": 3000 },
    { "userId": "507f191e810c19729de860ea", "shareCents": 2000 }
  ]
}
```

Rules:

- At least two participants are required.
- Participant IDs must be valid and unique.
- The authenticated user is always stored as `creatorId`; a client-supplied
  `creatorId` is not trusted.
- For `equal`, shares are calculated using integer division. Any remainder
  cents are assigned deterministically to participants sorted by `userId`.
- For `custom`, every `shareCents` must be a non-negative integer and all
  shares must sum exactly to `totalAmountCents`.

Returns `201` with the persisted shared expense under `data`.

#### Get net balances

```http
GET /api/expenses/balances
x-user-id: <user-object-id>
```

Returns `200`:

```json
{
  "data": [
    {
      "userId": "507f191e810c19729de860ea",
      "netAmountCents": -2000
    }
  ]
}
```

Balance semantics:

- Positive `netAmountCents`: the counterpart owes the authenticated user.
- Negative `netAmountCents`: the authenticated user owes the counterpart.
- Zero balances are omitted.
- Active expenses involving the authenticated user are queried and aggregated
  on demand.
- The result is sorted by counterpart user ID.

### Error responses

Domain validation, authentication, and not-found failures use this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "amountCents must be a non-negative integer representing cents."
  }
}
```

Common status codes are:

| Status | Codes | Meaning |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | Request data violates domain rules |
| `401` | `UNAUTHORIZED` | No valid authenticated user ID is available |
| `404` | `NOT_FOUND` | A requested domain resource was not found |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected failure; details are logged, not exposed |

## Data and business rules

### Monetary values

All monetary fields are integers in the smallest currency unit:

- `amountCents` for transactions
- `totalAmountCents` for shared expenses
- `shareCents` for participants
- `netAmountCents` for calculated balances

The services reject negative or non-integer monetary values. Calculations use
integer-safe arithmetic only.

### Transaction persistence

Transactions include ownership, description, amount, currency, optional
idempotency key, timestamps, and a nullable `deletedAt` marker. The model has:

- an index for user and newest-first retrieval;
- a unique sparse compound index for `(userId, idempotencyKey)`;
- Mongoose validation for integer cents, currency, and description length.

### Shared expense persistence

Shared expenses include the creator, total, currency, split type,
participants, timestamps, and soft-delete state. The model validates:

- at least two participants;
- no duplicate participant IDs;
- integer non-negative participant shares;
- exact equality between participant share sum and total;
- supported ISO 4217 currencies.

## Testing

Run all tests:

```powershell
npm test
```

Run deterministically in one process:

```powershell
npm test -- --runInBand
```

The tests cover:

- transaction creation and idempotency;
- transaction pagination and soft deletion;
- integer-cents and currency validation;
- equal and custom shared-expense splitting;
- deterministic remainder distribution;
- debt calculation and bidirectional netting;
- ownership scoping through the authenticated user;
- controller status codes and safe error responses;
- propagation of unexpected failures to Express error middleware.

The current test command does not define a coverage threshold in
`package.json`. Coverage output may be generated locally by Jest tooling and
should not be committed.

## Logging and error handling

Pino is configured as the shared structured logger. Services log successful
domain operations and log repository failures before rethrowing them.
Controllers handle known domain errors and forward unexpected errors to the
application error middleware.

The final middleware logs the HTTP method, path, operation, and error, then
returns a generic response. It does not expose stack traces, database
messages, credentials, tokens, or other internal implementation details.

## Security and production readiness

Before production use, complete at least the following:

1. Replace the `x-user-id` authentication stub with verified authentication.
2. Add the user model and account lifecycle required by the chosen identity
   provider.
3. Add production request validation middleware at the route boundary if the
   application grows beyond the current service-level validation.
4. Configure MongoDB credentials and network restrictions through a secret
   manager, never source control.
5. Add rate limiting, HTTPS, security headers, request IDs, health checks, and
   operational monitoring.
6. Add repository/integration tests against the supported MongoDB test setup.
7. Add a production process manager or container deployment definition.
8. Define migration, backup, retention, and recovery procedures.

The current implementation already applies important safeguards: user-scoped
repository filters, integer-cent validation, currency allowlisting, soft
deletion, idempotency uniqueness, structured redacted logging, and generic
unexpected-error responses.

## Development workflow

1. Create a feature branch from `main`.
2. Install dependencies with `npm ci`.
3. Update `.env` locally without committing secrets.
4. Implement changes within the route-controller-service-repository-model
   layering.
5. Add or update focused Jest tests for success and failure paths.
6. Run `npm test -- --runInBand`.
7. Review `git diff` and confirm generated files and secrets are ignored.
8. Commit with a descriptive message and push the branch.
9. Open a pull request to `main` after reviewing the tests and API behavior.

## Implementation summary

The initial repository implementation was committed to `main` and includes:

- Express application and MongoDB startup entry point;
- transaction creation, retrieval, idempotency, and soft deletion;
- shared expense creation with equal/custom integer-cent splits;
- on-demand net balance calculation;
- Mongoose schemas and ownership-focused indexes;
- Pino logging with sensitive-field redaction;
- domain error classes and generic error middleware;
- Jest unit/controller coverage for the implemented behavior;
- locked dependency installation through `package-lock.json`.

The next architectural milestone is replacing the local authentication stub
with a verified authentication system while preserving the existing
`req.user.id` contract used by controllers and services.
