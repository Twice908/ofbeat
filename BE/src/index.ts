import {
	createRazorpayOrder,
	fetchCapturedPaymentForOrder,
	fetchRazorpayOrder,
	fetchRazorpayPayment,
	sendConfirmationEmail,
	sha256,
	verifyHmac,
} from "./providers";
import {
	getCategoryPrice,
	validateRegistration,
	validateRegistrationId,
} from "./validation";
import { HttpError, type Env, type RegistrationRecord } from "./types";

const MAX_JSON_BYTES = 32 * 1024;
const MAX_WEBHOOK_BYTES = 64 * 1024;
const CURRENCY = "INR";
const REGISTRATION_MESSAGE = "Your entry is confirmed.";
const ALLOWED_METHODS = "GET,POST,OPTIONS";

function jsonResponse(
	body: Record<string, unknown>,
	status = 200,
	headers: HeadersInit = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
	});
}

function withCors(
	request: Request,
	env: Env,
	response: Response,
): Response {
	const origin = request.headers.get("Origin");
	if (!origin) return response;
	const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	if (!allowedOrigins.includes(origin)) {
		return jsonResponse({ error: "Origin is not allowed." }, 403, {
			Vary: "Origin",
		});
	}
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", origin);
	headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
	headers.set("Access-Control-Allow-Headers", "Content-Type, X-Razorpay-Signature, X-Razorpay-Event-Id");
	headers.set("Access-Control-Max-Age", "86400");
	headers.append("Vary", "Origin");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

async function readBody(request: Request, maxBytes: number): Promise<string> {
	const reader = request.body?.getReader();
	if (!reader) throw new HttpError(400, "Request body is required.");
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel();
			throw new HttpError(413, "Request body is too large.");
		}
		chunks.push(value);
	}
	const combined = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(combined);
}

async function readJson(request: Request): Promise<unknown> {
	if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
		throw new HttpError(415, "Content-Type must be application/json.");
	}
	try {
		return JSON.parse(await readBody(request, MAX_JSON_BYTES)) as unknown;
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(400, "Request body must contain valid JSON.");
	}
}

function createRegistrationId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
	return `OFF-${token}`;
}

function requireRazorpayCredentials(env: Env): void {
	if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
		throw new HttpError(503, "Payment service is not configured.");
	}
}

function getRegistration(
	env: Env,
	registrationId: string,
): Promise<RegistrationRecord | null> {
	return env.DB.prepare("SELECT * FROM registrations WHERE id = ?")
		.bind(registrationId)
		.first<RegistrationRecord>();
}

async function createRegistration(request: Request, env: Env): Promise<Response> {
	requireRazorpayCredentials(env);
	const input = validateRegistration(await readJson(request));
	const amount = getCategoryPrice(input.category).amountPaise;
	const registrationId = createRegistrationId();

	await env.DB.prepare(
		`INSERT INTO registrations (
			id, category, dance_style, age_group, participant_count,
			participants_json, team_name, contact_name, phone, email, city,
			notes, amount_paise, currency
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			registrationId,
			input.category,
			input.danceStyle,
			input.ageGroup,
			input.participantCount,
			JSON.stringify(input.participants),
			input.teamName || null,
			input.contact.name,
			input.contact.phone,
			input.contact.email,
			input.contact.city,
			input.notes || null,
			amount,
			CURRENCY,
		)
		.run();

	let order;
	try {
		order = await createRazorpayOrder(env, {
			amount,
			currency: CURRENCY,
			receipt: registrationId,
			registrationId,
		});
		if (
			!order.id ||
			order.amount !== amount ||
			order.currency !== CURRENCY
		) {
			throw new Error("Payment service returned an invalid order.");
		}
		await env.DB.prepare(
			"UPDATE registrations SET razorpay_order_id = ? WHERE id = ?",
		)
			.bind(order.id, registrationId)
			.run();
	} catch (error) {
		await env.DB.prepare(
			"DELETE FROM registrations WHERE id = ? AND razorpay_order_id IS NULL",
		)
			.bind(registrationId)
			.run();
		throw error;
	}

	return jsonResponse({
		registrationId,
		orderId: order.id,
		amount,
		currency: CURRENCY,
	});
}

async function markRegistrationPaid(
	env: Env,
	registration: RegistrationRecord,
	paymentId: string,
	ctx: ExecutionContext,
): Promise<void> {
	await env.DB.batch([
		env.DB.prepare(
			`UPDATE registrations
			 SET payment_status = 'paid',
			     razorpay_payment_id = ?,
			     paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
			 WHERE id = ? AND payment_status != 'paid'
			   AND amount_paise = ? AND currency = ?`,
		).bind(paymentId, registration.id, registration.amount_paise, registration.currency),
		env.DB.prepare(
			`INSERT OR IGNORE INTO email_outbox (id, registration_id, status)
			 SELECT ?, id, 'pending' FROM registrations
			 WHERE id = ? AND payment_status = 'paid'`,
		).bind(registration.id, registration.id),
	]);
	ctx.waitUntil(deliverConfirmationEmail(env, registration.id));
}

async function verifyPayment(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	requireRazorpayCredentials(env);
	const body = await readJson(request);
	if (
		typeof body !== "object" ||
		body === null ||
		!("registrationId" in body) ||
		!("razorpay_order_id" in body) ||
		!("razorpay_payment_id" in body) ||
		!("razorpay_signature" in body) ||
		typeof body.registrationId !== "string" ||
		typeof body.razorpay_order_id !== "string" ||
		typeof body.razorpay_payment_id !== "string" ||
		typeof body.razorpay_signature !== "string"
	) {
		throw new HttpError(400, "Payment verification details are invalid.");
	}
	if (!validateRegistrationId(body.registrationId)) {
		throw new HttpError(400, "Registration ID is invalid.");
	}

	const registration = await getRegistration(env, body.registrationId);
	if (!registration || !registration.razorpay_order_id) {
		throw new HttpError(404, "Registration was not found.");
	}
	if (registration.razorpay_order_id !== body.razorpay_order_id) {
		throw new HttpError(400, "Payment order does not match this registration.");
	}
	if (
		!(await verifyHmac(
			env.RAZORPAY_KEY_SECRET!,
			`${body.razorpay_order_id}|${body.razorpay_payment_id}`,
			body.razorpay_signature,
		))
	) {
		throw new HttpError(400, "Payment signature is invalid.");
	}

	const payment = await fetchRazorpayPayment(env, body.razorpay_payment_id);
	if (
		payment.order_id !== registration.razorpay_order_id ||
		payment.amount !== registration.amount_paise ||
		payment.currency !== registration.currency ||
		payment.status !== "captured" ||
		payment.captured !== true
	) {
		throw new HttpError(409, "Payment is not confirmed as captured.");
	}

	await markRegistrationPaid(env, registration, payment.id, ctx);
	return jsonResponse({
		verified: true,
		status: "paid",
		registrationId: registration.id,
		message: REGISTRATION_MESSAGE,
	});
}

async function findRegistrationByOrder(
	env: Env,
	orderId: string,
): Promise<RegistrationRecord | null> {
	return env.DB.prepare(
		"SELECT * FROM registrations WHERE razorpay_order_id = ?",
	)
		.bind(orderId)
		.first<RegistrationRecord>();
}

async function recordWebhook(
	env: Env,
	eventId: string,
	eventType: string,
): Promise<void> {
	await env.DB.prepare(
		"INSERT OR IGNORE INTO processed_webhooks (event_id, event_type) VALUES (?, ?)",
	)
		.bind(eventId, eventType)
		.run();
}

async function processWebhook(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (!env.RAZORPAY_WEBHOOK_SECRET) {
		throw new HttpError(503, "Payment webhook is not configured.");
	}
	const rawBody = await readBody(request, MAX_WEBHOOK_BYTES);
	const signature = request.headers.get("X-Razorpay-Signature") ?? "";
	if (!(await verifyHmac(env.RAZORPAY_WEBHOOK_SECRET, rawBody, signature))) {
		throw new HttpError(400, "Webhook signature is invalid.");
	}

	let event: unknown;
	try {
		event = JSON.parse(rawBody) as unknown;
	} catch {
		throw new HttpError(400, "Webhook body is invalid.");
	}
	if (
		typeof event !== "object" ||
		event === null ||
		!("event" in event) ||
		typeof event.event !== "string"
	) {
		throw new HttpError(400, "Webhook event is invalid.");
	}

	const eventId =
		request.headers.get("X-Razorpay-Event-Id") || (await sha256(rawBody));
	const existing = await env.DB.prepare(
		"SELECT event_id FROM processed_webhooks WHERE event_id = ?",
	)
		.bind(eventId)
		.first();
	if (existing) return jsonResponse({ received: true, duplicate: true });

	const payload =
		"payload" in event && typeof event.payload === "object" && event.payload !== null
			? event.payload
			: null;
	const paymentEntity =
		payload &&
		"payment" in payload &&
		typeof payload.payment === "object" &&
		payload.payment !== null &&
		"entity" in payload.payment
			? payload.payment.entity
			: null;
	const orderEntity =
		payload &&
		"order" in payload &&
		typeof payload.order === "object" &&
		payload.order !== null &&
		"entity" in payload.order
			? payload.order.entity
			: null;

	if (
		(event.event === "payment.captured" || event.event === "payment.failed") &&
		typeof paymentEntity === "object" &&
		paymentEntity !== null &&
		"id" in paymentEntity &&
		"order_id" in paymentEntity &&
		"amount" in paymentEntity &&
		"currency" in paymentEntity &&
		typeof paymentEntity.id === "string" &&
		typeof paymentEntity.order_id === "string"
	) {
		const registration = await findRegistrationByOrder(env, paymentEntity.order_id);
		if (registration) {
			const matchesExpectedCharge =
				paymentEntity.amount === registration.amount_paise &&
				paymentEntity.currency === registration.currency;
			if (!matchesExpectedCharge) {
				throw new HttpError(400, "Webhook payment does not match its registration.");
			}
			if (event.event === "payment.captured") {
				if (
					!("status" in paymentEntity) ||
					paymentEntity.status !== "captured" ||
					!("captured" in paymentEntity) ||
					paymentEntity.captured !== true
				) {
					throw new HttpError(400, "Webhook payment is not captured.");
				}
				await markRegistrationPaid(env, registration, paymentEntity.id, ctx);
			}
		}
	} else if (
		event.event === "order.paid" &&
		typeof orderEntity === "object" &&
		orderEntity !== null &&
		"id" in orderEntity &&
		"amount" in orderEntity &&
		"currency" in orderEntity &&
		typeof orderEntity.id === "string"
	) {
		const registration = await findRegistrationByOrder(env, orderEntity.id);
		if (registration) {
			if (
				orderEntity.amount !== registration.amount_paise ||
				orderEntity.currency !== registration.currency
			) {
				throw new HttpError(400, "Webhook order does not match its registration.");
			}
			const [remoteOrder, capturedPayment] = await Promise.all([
				fetchRazorpayOrder(env, orderEntity.id),
				fetchCapturedPaymentForOrder(env, orderEntity.id),
			]);
			if (
				remoteOrder.status === "paid" &&
				remoteOrder.amount === registration.amount_paise &&
				remoteOrder.currency === registration.currency &&
				capturedPayment?.amount === registration.amount_paise &&
				capturedPayment.currency === registration.currency
			) {
				await markRegistrationPaid(env, registration, capturedPayment.id, ctx);
			}
		}
	}

	await recordWebhook(env, eventId, event.event);
	return jsonResponse({ received: true });
}

async function deliverConfirmationEmail(
	env: Env,
	registrationId: string,
): Promise<void> {
	const claim = await env.DB.prepare(
		`UPDATE email_outbox
		 SET status = 'sending', lease_until = datetime('now', '+2 minutes')
		 WHERE id = ? AND (
		   (status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP) OR
		   (status = 'sending' AND lease_until < CURRENT_TIMESTAMP)
		 )`,
	)
		.bind(registrationId)
		.run();
	if (claim.meta.changes === 0) return;

	const registration = await getRegistration(env, registrationId);
	if (!registration || registration.payment_status !== "paid") {
		await env.DB.prepare(
			"UPDATE email_outbox SET status = 'pending', lease_until = NULL WHERE id = ?",
		)
			.bind(registrationId)
			.run();
		return;
	}
	try {
		await sendConfirmationEmail(env, registration);
		await env.DB.prepare(
			`UPDATE email_outbox
			 SET status = 'sent', sent_at = CURRENT_TIMESTAMP, lease_until = NULL,
			     last_error = NULL
			 WHERE id = ?`,
		)
			.bind(registrationId)
			.run();
	} catch (error) {
		const attempts = await env.DB.prepare(
			"SELECT attempts FROM email_outbox WHERE id = ?",
		)
			.bind(registrationId)
			.first<{ attempts: number }>();
		const nextDelayMinutes = Math.min(360, 5 * 2 ** (attempts?.attempts ?? 0));
		console.error("Confirmation email delivery failed; it will be retried.", {
			registrationId,
			error: error instanceof Error ? error.message : "Unknown email error.",
		});
		await env.DB.prepare(
			`UPDATE email_outbox
			 SET status = 'pending', attempts = attempts + 1,
			     next_attempt_at = datetime('now', ?),
			     lease_until = NULL, last_error = ?
			 WHERE id = ?`,
		)
			.bind(`+${nextDelayMinutes} minutes`, "Confirmation email delivery failed.", registrationId)
			.run();
	}
}

async function processPendingEmails(env: Env): Promise<void> {
	if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
		console.warn("Email outbox is not being processed; Resend configuration is incomplete.");
		return;
	}
	const pending = await env.DB.prepare(
		`SELECT id FROM email_outbox
		 WHERE (status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP)
		    OR (status = 'sending' AND lease_until < CURRENT_TIMESTAMP)
		 ORDER BY next_attempt_at LIMIT 20`,
	).all<{ id: string }>();
	await Promise.all(
		pending.results.map((entry) => deliverConfirmationEmail(env, entry.id)),
	);
}

async function health(env: Env): Promise<Response> {
	try {
		await env.DB.prepare("SELECT 1").first();
	} catch (error) {
		console.error("D1 health check failed.", error);
		return jsonResponse({ status: "unavailable" }, 503);
	}
	const paymentReady = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
	const webhookReady = Boolean(env.RAZORPAY_WEBHOOK_SECRET);
	const emailReady = Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
	const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	const corsReady =
		allowedOrigins.length > 0 &&
		allowedOrigins.every((origin) => {
			try {
				const parsed = new URL(origin);
				return (
					(parsed.protocol === "https:" || parsed.protocol === "http:") &&
					parsed.origin === origin
				);
			} catch {
				return false;
			}
		});
	return jsonResponse({
		status:
			paymentReady && webhookReady && emailReady && corsReady
				? "ok"
				: "degraded",
		services: {
			database: "ok",
			payments: paymentReady,
			webhooks: webhookReady,
			email: emailReady,
			cors: corsReady,
		},
	});
}

async function route(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/api/health" && request.method === "GET") {
		return health(env);
	}
	if (url.pathname === "/api/registrations" && request.method === "POST") {
		return createRegistration(request, env);
	}
	if (url.pathname === "/api/payments/verify" && request.method === "POST") {
		return verifyPayment(request, env, ctx);
	}
	if (url.pathname === "/api/payments/webhook" && request.method === "POST") {
		return processWebhook(request, env, ctx);
	}
	const registrationMatch = url.pathname.match(/^\/api\/registrations\/([^/]+)$/);
	if (registrationMatch && request.method === "GET") {
		const registrationId = decodeURIComponent(registrationMatch[1]);
		if (!validateRegistrationId(registrationId)) {
			throw new HttpError(404, "Registration was not found.");
		}
		const registration = await getRegistration(env, registrationId);
		if (!registration) throw new HttpError(404, "Registration was not found.");
		return jsonResponse({
			registrationId: registration.id,
			status: registration.payment_status,
		});
	}
	if (url.pathname.startsWith("/api/")) {
		throw new HttpError(404, "API route was not found.");
	}
	throw new HttpError(404, "Route was not found.");
}

const worker = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const origin = request.headers.get("Origin");
		if (origin) {
			const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
			if (!allowedOrigins.includes(origin)) {
				return jsonResponse({ error: "Origin is not allowed." }, 403, {
					Vary: "Origin",
				});
			}
		}
		if (request.method === "OPTIONS") {
			return withCors(
				request,
				env,
				new Response(null, {
					status: 204,
					headers: {
						"Access-Control-Allow-Methods": ALLOWED_METHODS,
						"Access-Control-Allow-Headers":
							"Content-Type, X-Razorpay-Signature, X-Razorpay-Event-Id",
						"Access-Control-Max-Age": "86400",
					},
				}),
			);
		}

		try {
			return withCors(request, env, await route(request, env, ctx));
		} catch (error) {
			if (error instanceof HttpError) {
				return withCors(request, env, jsonResponse({ error: error.message }, error.status));
			}
			console.error("Unhandled Worker request error.", error);
			return withCors(
				request,
				env,
				jsonResponse({ error: "The request could not be completed." }, 500),
			);
		}
	},

	async scheduled(
		_controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	): Promise<void> {
		ctx.waitUntil(processPendingEmails(env));
	},
} satisfies ExportedHandler<Env>;

export default worker;
