# FinTrack Copilot Instructions

FinTrack is a production-oriented expense-splitting API. Follow these conventions for every new feature, bug fix, and refactor.

## 1. Technology stack

- **Runtime:** Node.js using the project's declared LTS-compatible version.
- **Language:** JavaScript with CommonJS or ECMAScript modules according to the existing project configuration; do not mix module systems within a feature.
- **Web framework:** Express.js.
- **Database:** MongoDB.
- **Data access:** Mongoose schemas, models, and query APIs.
- **Authentication and authorization:** Use the project's established authentication middleware and `req.user`; never bypass authorization checks in individual routes.
- **Validation:** Validate request bodies, parameters, and query strings at the API boundary using the project's existing validation library or middleware.
- **Logging:** Winston or Pino through the application's shared logger.
- **Testing:** Jest, with Supertest for HTTP/API integration tests where appropriate.

Prefer existing project dependencies, utilities, middleware, and patterns over introducing new packages.

## 2. Architecture convention

Use strict layering for all request and data flows:

**Route → Controller → Service → Repository → Model**

- **Route:** Defines the HTTP method, path, middleware, validation, and controller handler. Routes must not contain business logic or database calls.
- **Controller:** Translates HTTP requests into service inputs and service results into HTTP responses. Controllers handle HTTP concerns only and must not query Mongoose directly.
- **Service:** Owns business rules, authorization decisions, transaction boundaries, and orchestration. Services must be independently testable and must call repositories rather than models.
- **Repository:** Encapsulates all persistence operations, including Mongoose queries, updates, aggregation, and population. Repositories must return domain-oriented data and must not format HTTP responses.
- **Model:** Defines Mongoose schemas, indexes, model-level validation, and persistence representation. Models must not contain request or response logic.

Do not skip layers or call around them. For example, a controller must not call a repository directly, a service must not call a Mongoose model directly, and a route must not call a service inline. If shared behavior is needed, extract it into the appropriate layer or a clearly scoped utility.

Keep modules focused and maintain one primary responsibility per file. Preserve consistent error handling through the project's standard error types and error middleware.

## 3. Coding standards

- Use **camelCase** for variables, functions, parameters, object properties, and file-local identifiers.
- Use **PascalCase** for classes, Mongoose models, constructors, and other types.
- Use descriptive names that reflect the expense-splitting domain; avoid abbreviations unless they are established domain terms.
- Add **JSDoc type annotations to every exported function**, including parameters, return values, thrown errors where useful, and asynchronous return types.
- Keep functions small, deterministic where possible, and explicit about side effects.
- Prefer `const`; use `let` only when reassignment is required. Do not use `var`.
- Use `async`/`await` consistently and propagate errors to the standard error-handling middleware.
- Validate external input before it reaches services or repositories.
- Format and lint code using the repository's configured tools before submitting changes.

## 4. Security and financial-data rules

- Never use raw SQL, string-concatenated queries, or dynamically assembled query strings.
- Always use Mongoose's parameterized query APIs and pass values as query parameters or structured filter/update objects.
- Never interpolate untrusted input into MongoDB operators, collection names, sort expressions, projections, or aggregation stages. Allowlist dynamic fields and operators.
- Store **all monetary values as integers representing the smallest currency unit (cents)**. Never store or calculate money as JavaScript floating-point values.
- Convert and validate monetary input at the boundary, reject invalid, negative, or unsafe integer values according to the domain rules, and use integer-safe arithmetic.
- Every route that returns, changes, or deletes a resource must verify that `req.user` owns the resource, or that the user has an explicitly documented role or membership granting access, before returning or mutating data.
- Apply authorization checks in the service layer as the source of truth; route middleware may provide an early check but must not replace service-level authorization.
- Prevent insecure direct object references: scope repository lookups by the authenticated user's identity whenever ownership applies.
- Do not expose internal database errors, stack traces, password hashes, tokens, or other implementation details in API responses.
- Hash passwords with the project's approved password-hashing library. Never store or compare plaintext passwords.
- Use schema validation, least-privilege database access, and safe projection of fields to prevent accidental data exposure.

## 5. Logging and observability

- Use the shared **structured logger**, implemented with Winston or Pino, rather than `console.log`, `console.error`, or ad hoc output.
- Include useful structured context such as request ID, route, operation, user ID where permitted, resource ID, and error classification.
- Never log sensitive data, including passwords, password hashes, authentication tokens, refresh tokens, session identifiers, API keys, secrets, or full card numbers.
- Do not log complete request bodies, authorization headers, cookies, or payment details. Redact or allowlist fields before logging.
- Mask or tokenize financial identifiers; log only the minimum information needed for diagnosis.
- Use appropriate log levels: `error` for failed operations requiring attention, `warn` for rejected or suspicious behavior, `info` for important lifecycle events, and `debug` for development diagnostics.
- Ensure errors are logged once with context and are still passed to the standard error middleware.

## 6. Testing and quality gates

- Maintain a minimum **80% code coverage target** for statements, branches, functions, and lines unless the repository explicitly defines a stricter threshold.
- Every service function must have a corresponding Jest test covering:
  - the happy path;
  - at least one expected failure case, such as invalid input, unauthorized access, missing data, or a repository failure.
- Unit-test services with mocked repositories and dependencies so business rules are isolated.
- Test repositories against the project's supported MongoDB test setup, using fixtures that reflect real ownership and monetary-value constraints.
- Add route/controller integration tests with Supertest for authentication, authorization, validation, status codes, and response shapes.
- Include authorization tests proving users cannot access another user's expenses, groups, settlements, or other protected resources.
- Include monetary tests proving values remain integer cents and calculations do not use floating-point arithmetic.
- Keep tests deterministic, isolated, and free of real credentials or production data. Run the targeted Jest tests and coverage checks before considering a change complete.