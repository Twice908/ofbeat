import type {
	Env,
	RazorpayOrder,
	RazorpayPayment,
	RegistrationRecord,
} from "./types";

const RAZORPAY_API = "https://api.razorpay.com/v1";
const RESEND_API = "https://api.resend.com/emails";
const encoder = new TextEncoder();

function hexToBytes(value: string): Uint8Array | null {
	if (!/^(?:[a-fA-F0-9]{2})+$/.test(value)) return null;
	const bytes = new Uint8Array(value.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

function bytesToHex(value: ArrayBuffer): string {
	return Array.from(new Uint8Array(value), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) {
		difference |= left[index] ^ right[index];
	}
	return difference === 0;
}

export async function verifyHmac(
	secret: string,
	message: string,
	signature: string,
): Promise<boolean> {
	const supplied = hexToBytes(signature);
	if (!supplied) return false;
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const expected = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
	);
	return constantTimeEqual(expected, supplied);
}

export async function sha256(value: string): Promise<string> {
	return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function razorpayAuthorization(env: Env): string {
	if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
		throw new Error("Razorpay credentials are not configured.");
	}
	return `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`;
}

async function razorpayRequest<T>(
	env: Env,
	path: string,
	init: RequestInit,
): Promise<T> {
	const response = await fetch(`${RAZORPAY_API}${path}`, {
		...init,
		headers: {
			Authorization: razorpayAuthorization(env),
			"Content-Type": "application/json",
			...init.headers,
		},
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		console.error("Razorpay API request failed.", {
			path,
			status: response.status,
		});
		throw new Error("Payment service could not complete the request.");
	}
	return (await response.json()) as T;
}

export function createRazorpayOrder(
	env: Env,
	input: {
		amount: number;
		currency: string;
		receipt: string;
		registrationId: string;
	},
): Promise<RazorpayOrder> {
	return razorpayRequest<RazorpayOrder>(env, "/orders", {
		method: "POST",
		body: JSON.stringify({
			amount: input.amount,
			currency: input.currency,
			receipt: input.receipt,
			notes: { registration_id: input.registrationId },
		}),
	});
}

export function fetchRazorpayPayment(
	env: Env,
	paymentId: string,
): Promise<RazorpayPayment> {
	return razorpayRequest<RazorpayPayment>(
		env,
		`/payments/${encodeURIComponent(paymentId)}`,
		{ method: "GET" },
	);
}

export function fetchRazorpayOrder(
	env: Env,
	orderId: string,
): Promise<RazorpayOrder> {
	return razorpayRequest<RazorpayOrder>(
		env,
		`/orders/${encodeURIComponent(orderId)}`,
		{ method: "GET" },
	);
}

export async function fetchCapturedPaymentForOrder(
	env: Env,
	orderId: string,
): Promise<RazorpayPayment | null> {
	const result = await razorpayRequest<{ items: RazorpayPayment[] }>(
		env,
		`/orders/${encodeURIComponent(orderId)}/payments`,
		{ method: "GET" },
	);
	return (
		result.items.find(
			(payment) =>
				payment.order_id === orderId &&
				payment.status === "captured" &&
				payment.captured,
		) ?? null
	);
}

export async function sendConfirmationEmail(
	env: Env,
	registration: RegistrationRecord,
): Promise<void> {
	if (!env.RESEND_API_KEY) {
		console.warn("Confirmation email is queued; RESEND_API_KEY is not configured.", {
			registrationId: registration.id,
		});
		throw new Error("Email provider is not configured.");
	}
	if (!env.RESEND_FROM_EMAIL) {
		console.error("Confirmation email is queued; RESEND_FROM_EMAIL is not configured.", {
			registrationId: registration.id,
		});
		throw new Error("Email sender is not configured.");
	}

	const participants = JSON.parse(registration.participants_json) as string[];
	const escapeHtml = (value: string) =>
		value.replace(/[&<>"']/g, (character) => {
			const entities: Record<string, string> = {
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			};
			return entities[character];
		});
	const fee = new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: registration.currency,
		maximumFractionDigits: 0,
	}).format(registration.amount_paise / 100);
	const safeParticipants = participants.map(escapeHtml);
	const participantList = safeParticipants.map((name) => `<li>${name}</li>`).join("");
	const text = [
		`Hello ${registration.contact_name},`,
		"",
		"Your OFFBEAT registration is confirmed.",
		`Registration ID: ${registration.id}`,
		`Category: ${registration.category}`,
		`Participants: ${participants.join(", ")}`,
		`Amount paid: ${fee}`,
		registration.razorpay_payment_id
			? `Payment ID: ${registration.razorpay_payment_id}`
			: "",
		"",
		"Thank you for registering.",
	]
		.filter(Boolean)
		.join("\n");
	const html = [
		`<p>Hello ${escapeHtml(registration.contact_name)},</p>`,
		"<p>Your OFFBEAT registration is confirmed.</p>",
		"<ul>",
		`<li><strong>Registration ID:</strong> ${escapeHtml(registration.id)}</li>`,
		`<li><strong>Category:</strong> ${escapeHtml(registration.category)}</li>`,
		`<li><strong>Participants:</strong><ul>${participantList}</ul></li>`,
		`<li><strong>Amount paid:</strong> ${escapeHtml(fee)}</li>`,
		registration.razorpay_payment_id
			? `<li><strong>Payment ID:</strong> ${escapeHtml(registration.razorpay_payment_id)}</li>`
			: "",
		"</ul>",
		"<p>Thank you for registering.</p>",
	].join("");

	const response = await fetch(RESEND_API, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
			"Content-Type": "application/json",
			"Idempotency-Key": `offbeat-registration-${registration.id}`,
		},
		body: JSON.stringify({
			from: env.RESEND_FROM_EMAIL,
			to: [registration.email],
			subject: "OFFBEAT registration confirmed",
			html,
			text,
		}),
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		console.error("Resend API request failed.", {
			registrationId: registration.id,
			status: response.status,
		});
		throw new Error("Email provider could not deliver the confirmation.");
	}
}
