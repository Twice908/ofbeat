# OFFBEAT — Dance Competition Website

A mobile-first static frontend with GSAP + ScrollTrigger animations, Lenis smooth scrolling, a registration modal, dynamic participant fields, category pricing, and Razorpay Checkout integration.

## Files

- `FE/HTML/index.html` — page structure, reference layout and registration form.
- `FE/CSS/theme.css` — active visual theme and responsive component styles.
- `FE/JS/animation.js` — GSAP, ScrollTrigger, Lenis, Three.js, and page interactions.
- `FE/JS/app.js` — registration validation, API integration and Razorpay checkout.
- `BE/` — Cloudflare Worker API, D1 migrations, payment/email integrations, and deployment workflow.
- `ref.html` — preserved design reference; the running page uses the split FE files above.
- `README.md` — backend contract and deployment guide.

## 1. Frontend configuration

Set these public frontend values in `FE/.env`, using `FE/.env.example` as a reference:

```dotenv
FE_API_BASE_URL=
FE_RAZORPAY_KEY_ID=
```

Generate the browser config with `node FE/scripts/generate-config.mjs`. The script reads `FE/.env`; process environment variables override those file values. It creates ignored `FE/JS/config.js`, which the static page loads. Browsers cannot read `.env` files directly.

The Razorpay Key ID is public by design. Never place Razorpay secrets, Resend keys, or database credentials in frontend configuration.

The amounts in the frontend are for display only. The backend must independently calculate the amount from its own trusted configuration. Do not trust a client-supplied amount.

## 2. Frontend deployment on GitHub Pages

1. In GitHub repository **Settings → Pages**, choose **GitHub Actions** as the source.
2. Add repository Actions variables `FE_API_BASE_URL` (deployed Worker origin) and `FE_RAZORPAY_KEY_ID` (public key).
3. Push to `main` or run **Deploy frontend** from **Actions**. The workflow generates the ignored config and publishes `FE/`.
4. The page will be at `<site-url>/FE/HTML/`.
5. Add the exact GitHub Pages origin to the Cloudflare Worker `ALLOWED_ORIGINS` variable. Also allow your custom domain if used.

The site uses CDN-hosted GSAP, ScrollTrigger, Lenis, Razorpay Checkout and Google Fonts. Internet access is required for those assets. For production, pin and review dependency versions.

## 3. Backend (Cloudflare)

The backend is implemented in `BE/` as a Cloudflare Worker with D1 persistence, Razorpay payment verification, and Resend confirmation emails. See [BE/README.md](./BE/README.md) for local setup, Cloudflare configuration, secrets, and GitHub Actions deployment.

Implemented Worker routes:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/registrations` | Validate registration, create pending record and Razorpay order |
| `POST` | `/api/payments/verify` | Verify Razorpay checkout signature and fetch/confirm payment |
| `POST` | `/api/payments/webhook` | Verify webhook signature and reconcile payment state |
| `GET` | `/api/registrations/:id` | Optional public status lookup with safe, limited response |
| `GET` | `/api/health` | Health check |

The server validates input and calculates fees independently of browser values. D1 migrations, webhook deduplication, and a retryable confirmation-email outbox are included.

### CORS and database

The Worker allows only exact origins listed in `ALLOWED_ORIGINS` and handles `OPTIONS` preflight requests. The current schema, indexes, webhook deduplication, and email outbox are defined in the [D1 migration](./BE/migrations/0001_initial.sql). Registration IDs are cryptographically random; sequential database IDs are not exposed.

## 4. API contract required by this frontend

### `POST /api/registrations`

Request JSON (sent by `app.js`):

```json
{
  "competitionName": "OFFBEAT",
  "category": "solo",
  "categoryLabel": "Solo Spotlight",
  "danceStyle": "Hip-hop",
  "ageGroup": "18–25",
  "participantCount": 1,
  "participants": ["Participant Name"],
  "teamName": "",
  "contact": {
    "name": "Contact Name",
    "phone": "9876543210",
    "email": "name@example.com",
    "city": "Pune"
  },
  "notes": "",
  "consent": true
}
```

Backend responsibilities:

1. Validate every field again on the server. Apply category-specific participant limits.
2. Validate phone, email, string lengths and consent. Reject unexpected category values.
3. Calculate the fee using a server-side map, e.g. `solo: 49900`, `duo: 79900`, `group: 129900`, `formation: 179900` (amounts in paise).
4. Create a pending D1 registration with a random registration ID.
5. Create a Razorpay Order using the server-side Key ID and Key Secret. Use the registration ID as `receipt` (within Razorpay's receipt length limit) and include a registration reference in order notes.
6. Store the Razorpay order ID against the pending registration.
7. Respond with:

```json
{
  "registrationId": "OFF-A1B2C3D4",
  "orderId": "order_xxxxxxxxxxxxxx",
  "amount": 49900,
  "currency": "INR"
}
```

`amount` must be an integer in paise. Razorpay's secret key must only be used inside the Worker.

### `POST /api/payments/verify`

Request JSON:

```json
{
  "registrationId": "OFF-A1B2C3D4",
  "razorpay_order_id": "order_xxxxxxxxxxxxxx",
  "razorpay_payment_id": "pay_xxxxxxxxxxxxxx",
  "razorpay_signature": "signature_from_checkout"
}
```

Backend responsibilities:

1. Load the registration and confirm the submitted order ID matches the stored order ID.
2. Verify the checkout signature using HMAC-SHA256 with the Razorpay Key Secret. The signed message is `razorpay_order_id + "|" + razorpay_payment_id`; compare signatures using a timing-safe comparison.
3. Fetch the payment/order from Razorpay's API server-to-server and confirm the payment belongs to the expected order, has the exact expected amount/currency, and is captured (or capture it according to your configured flow).
4. Make the update idempotent. Never downgrade a paid registration to pending/failed.
5. Return:

```json
{
  "verified": true,
  "status": "paid",
  "registrationId": "OFF-A1B2C3D4",
  "message": "Your entry is confirmed."
}
```

If payment is not fully confirmed, return a non-2xx response with a safe error message and leave the registration pending until the webhook/reconciliation confirms it.

### `POST /api/payments/webhook`

Configure this URL in Razorpay Dashboard and subscribe to at least `payment.captured`, `payment.failed`, and `order.paid`.

- Read the **raw request body** before parsing JSON.
- Verify `X-Razorpay-Signature` with the Webhook Secret using HMAC-SHA256 and constant-time comparison.
- Use Razorpay's event/payment/order identifiers to find the matching registration.
- Verify amount, currency and order association before marking paid.
- Make webhook processing idempotent; Razorpay can retry webhook deliveries.
- Return HTTP 2xx only after the event is safely handled.
- Do not use the checkout signature algorithm/secret for webhook verification; the webhook secret is separate.

## 5. Cloudflare setup and deployment

Follow [BE/README.md](./BE/README.md) to create the D1 database, configure Worker secrets and GitHub Actions variables, enable the Razorpay webhook, and deploy using the CI/CD workflow. The deployment workflow applies D1 migrations before publishing the Worker. Set the frontend's Worker URL and Razorpay public Key ID through `FE/.env` locally and GitHub Actions variables when deploying.

## 6. Production checklist

- [ ] Confirm the event date, venue, rules and organiser contact details before launch.
- [ ] Confirm the server-side fees and participant limits with the organiser.
- [ ] Enforce server-side validation and pricing; do not trust browser values.
- [ ] Verify checkout signatures and webhook signatures independently.
- [ ] Confirm the payment is captured and the amount/order match before marking an entry paid.
- [ ] Add rate limiting and bot protection (Turnstile is recommended for a public registration form).
- [ ] Restrict CORS to production origins.
- [ ] Add privacy/consent text and a clear refund/cancellation policy.
- [ ] Decide how minors' data and parent/guardian consent will be handled.
- [ ] Verify Resend delivery using a verified sender domain.
- [ ] Test successful, failed, cancelled, duplicate and delayed webhook payment flows.
- [ ] Export/backup registrations and restrict access to participant personal data.
- [ ] Use Razorpay Live Mode only after account activation and end-to-end testing.

## 8. Important notes

- Live payments require the deployed backend. A static GitHub Pages site cannot safely create Razorpay orders or verify payment signatures by itself.
- Do not mark a registration paid based only on the browser's Razorpay success callback. The Worker must verify it, and the webhook is the reliable reconciliation path.
- Do not publish participant lists or expose phone/email addresses in public URLs.
- Replace the generic event date, venue, rules and organiser communication text before publishing the event.
