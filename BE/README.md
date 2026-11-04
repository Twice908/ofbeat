# OFFBEAT Backend

Cloudflare Worker API for registrations, Razorpay orders and verification, webhook reconciliation, and Resend confirmation email.

## Local development

1. Install Node.js 22 or newer and run `npm ci` in this directory.
2. Copy `.dev.vars.example` to `.dev.vars` and add Razorpay test credentials. Add Resend credentials and a sender address after verifying a sending domain.
3. Run `npm run db:migrate:local`.
4. Run `npm run dev`. The API listens at `http://localhost:8787`.
5. Run checks with `npm run typecheck` and `npm test`.

The root `BE/.env.example` lists local settings and the D1 database ID used for remote deployment. Wrangler reads `.dev.vars` for local secrets and variables.

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Database and provider readiness |
| `POST` | `/api/registrations` | Validate input, save a pending registration, and create its Razorpay order |
| `POST` | `/api/payments/verify` | Verify checkout HMAC and confirm a captured payment with Razorpay |
| `POST` | `/api/payments/webhook` | Verify and process Razorpay payment and order events |
| `GET` | `/api/registrations/:id` | Return only the registration ID and payment status |

The API uses the current frontend fees as its trusted server-side prices: solo ₹499, duo ₹799, group ₹1,299, and formation ₹1,799. Confirm these with the organiser before accepting live payments.

Confirmation emails are queued in D1 when a registration becomes paid. The Worker's five-minute Cron Trigger retries unsent email messages. Resend uses a stable idempotency key for each registration.

## One-time Cloudflare setup

1. Create a Cloudflare account and create a D1 database named `dance-competition-db`.
2. Copy the D1 database ID. Set it as the GitHub Actions repository variable `CLOUDFLARE_D1_DATABASE_ID` for CI deployment. For local manual deployment, export the same variable in your shell.
3. Create a Cloudflare API token with permission to deploy Workers and manage the account's D1 databases. Save it as the GitHub Actions secret `CLOUDFLARE_API_TOKEN`; save the Cloudflare account ID as `CLOUDFLARE_ACCOUNT_ID`.
4. In GitHub **Settings → Secrets and variables → Actions**, add:
   - `CLOUDFLARE_D1_DATABASE_ID`: use either a repository secret or variable.
   - `ALLOWED_ORIGINS`: use either a repository secret or variable; for GitHub Pages, set `https://twice908.github.io` (no repository path or trailing slash).
   - `RESEND_FROM_EMAIL`: optional; add as a variable only after configuring Resend and verifying a sender domain.
   The workflow checks secrets first, then variables, and defaults `ALLOWED_ORIGINS` to `https://twice908.github.io`.
5. Push the workflow to GitHub or run it from the repository's **Actions** tab. Its first deployment applies the migration and creates the Worker.
6. In **Workers & Pages → dance-competition-api → Settings → Variables and Secrets**, add these as encrypted secrets when you configure payments and email:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`
   - `RESEND_API_KEY`
7. Once Razorpay is configured, create a webhook using the Worker URL shown in Cloudflare, followed by `/api/payments/webhook`. Subscribe to `payment.captured`, `payment.failed`, and `order.paid`. Use the same webhook secret in the Worker secret.
8. Set `FE_API_BASE_URL` to the Worker origin in GitHub Actions. `FE_RAZORPAY_KEY_ID` can remain unset until Razorpay is configured. Without Razorpay credentials, `/api/health` works, but creating payment orders and verifying payments returns a service-not-configured response.

The API permits only exact origins listed in `ALLOWED_ORIGINS`. Requests without an `Origin` header are allowed for server-to-server use. The webhook is authenticated by Razorpay's signature, not CORS.

## GitHub Actions deployment

The workflow at `.github/workflows/deploy-backend.yml` runs type-checks and tests, applies D1 migrations remotely, then deploys the Worker when backend files change on `main`. It can also be started manually from the repository's **Actions** tab. Resend and Razorpay credentials are not required to deploy; the API health response reports unconfigured integrations as degraded.

The D1 ID is inserted into a temporary Wrangler configuration at deploy time; no fake account-specific ID is committed. Secrets stay in Cloudflare and are not passed through the build or written into the repository.

For manual deployment after authenticating Wrangler, set `CLOUDFLARE_D1_DATABASE_ID` and `ALLOWED_ORIGINS`. `RESEND_FROM_EMAIL` is optional until email is configured. Then run:

```bash
npm run db:migrate:remote
npm run deploy
```

## Operational notes

- D1 stores participant and contact personal information. Restrict dashboard access and configure backups/retention appropriate to the event.
- Razorpay's Key Secret and webhook secret must be different and must never be exposed to the frontend.
- Confirmation email delivery is retried, but email delivery failure does not reverse a confirmed payment.
- The public status endpoint intentionally returns no participant/contact information.
