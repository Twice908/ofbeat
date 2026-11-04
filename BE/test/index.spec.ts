import {
	env,
	applyD1Migrations,
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

const testEnv: Env = {
	...env,
	RAZORPAY_KEY_ID: "rzp_test_id",
	RAZORPAY_KEY_SECRET: "razorpay-test-secret",
	RAZORPAY_WEBHOOK_SECRET: "razorpay-webhook-test-secret",
	RESEND_API_KEY: "resend-test-key",
	RESEND_FROM_EMAIL: "OFFBEAT <entries@example.test>",
	ALLOWED_ORIGINS: "https://offbeat.example",
};
declare const __D1_MIGRATIONS__: Array<{ name: string; queries: string[] }>;

const registrationInput = {
	competitionName: "OFFBEAT",
	category: "solo",
	categoryLabel: "Untrusted client label",
	danceStyle: "Hip-hop",
	ageGroup: "18–25",
	participantCount: 1,
	participants: ["Dancer One"],
	teamName: "",
	contact: {
		name: "Organizer Contact",
		phone: "9876543210",
		email: "contestant@example.test",
		city: "Pune",
	},
	notes: "",
	consent: true,
};

async function sign(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(message),
	);
	return Array.from(new Uint8Array(signature), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

async function postRegistration() {
	const context = createExecutionContext();
	const response = await worker.fetch(
		new Request("https://worker.example/api/registrations", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(registrationInput),
		}),
		testEnv,
		context,
	);
	return { response, context };
}

describe("OFFBEAT Worker API", () => {
	beforeAll(async () => {
		await applyD1Migrations(testEnv.DB, __D1_MIGRATIONS__);
	});

	beforeEach(async () => {
		await testEnv.DB.batch([
			testEnv.DB.prepare("DELETE FROM email_outbox"),
			testEnv.DB.prepare("DELETE FROM processed_webhooks"),
			testEnv.DB.prepare("DELETE FROM registrations"),
		]);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("reports database and service readiness without exposing credentials", async () => {
		const response = await worker.fetch(
			new Request("https://worker.example/api/health"),
			testEnv,
			createExecutionContext(),
		);
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload).toEqual({
			status: "ok",
			services: {
				database: "ok",
				payments: true,
				webhooks: true,
				email: true,
				cors: true,
			},
		});
	});

	it("rejects unapproved browser origins", async () => {
		const response = await worker.fetch(
			new Request("https://worker.example/api/health", {
				headers: { Origin: "https://not-approved.example" },
			}),
			testEnv,
			createExecutionContext(),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Origin is not allowed." });
	});

	it("validates registrations before contacting Razorpay", async () => {
		const providerFetch = vi.fn();
		vi.stubGlobal("fetch", providerFetch);
		const response = await worker.fetch(
			new Request("https://worker.example/api/registrations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...registrationInput, participantCount: 2 }),
			}),
			testEnv,
			createExecutionContext(),
		);

		expect(response.status).toBe(400);
		expect(providerFetch).not.toHaveBeenCalled();
	});

	it("creates an order at the server-side fee and confirms captured payment", async () => {
		let resendCalls = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url === "https://api.razorpay.com/v1/orders") {
					return Response.json({
						id: "order_test_123",
						amount: 49_900,
						currency: "INR",
						status: "created",
					});
				}
				if (url === "https://api.razorpay.com/v1/payments/pay_test_123") {
					return Response.json({
						id: "pay_test_123",
						order_id: "order_test_123",
						amount: 49_900,
						currency: "INR",
						status: "captured",
						captured: true,
					});
				}
				if (url === "https://api.resend.com/emails") {
					resendCalls += 1;
					return Response.json({ id: "email_test_123" });
				}
				throw new Error(`Unexpected provider request: ${url}`);
			}),
		);

		const created = await postRegistration();
		const order = (await created.response.json()) as {
			registrationId: string;
			orderId: string;
			amount: number;
			currency: string;
		};
		expect(created.response.status).toBe(200);
		expect(order).toMatchObject({
			orderId: "order_test_123",
			amount: 49_900,
			currency: "INR",
		});
		expect(order.registrationId).toMatch(/^OFF-[A-F0-9]{24}$/);
		const stored = await testEnv.DB.prepare(
			"SELECT payment_status, amount_paise FROM registrations WHERE id = ?",
		)
			.bind(order.registrationId)
			.first<{ payment_status: string; amount_paise: number }>();
		expect(stored).toEqual({ payment_status: "pending", amount_paise: 49_900 });

		const signature = await sign(
			testEnv.RAZORPAY_KEY_SECRET!,
			"order_test_123|pay_test_123",
		);
		const verifyContext = createExecutionContext();
		const verified = await worker.fetch(
			new Request("https://worker.example/api/payments/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					registrationId: order.registrationId,
					razorpay_order_id: "order_test_123",
					razorpay_payment_id: "pay_test_123",
					razorpay_signature: signature,
				}),
			}),
			testEnv,
			verifyContext,
		);
		await waitOnExecutionContext(verifyContext);

		expect(verified.status).toBe(200);
		expect(await verified.json()).toMatchObject({
			verified: true,
			status: "paid",
			registrationId: order.registrationId,
		});
		const paid = await testEnv.DB.prepare(
			"SELECT payment_status, razorpay_payment_id FROM registrations WHERE id = ?",
		)
			.bind(order.registrationId)
			.first<{ payment_status: string; razorpay_payment_id: string }>();
		expect(paid).toEqual({
			payment_status: "paid",
			razorpay_payment_id: "pay_test_123",
		});
		expect(resendCalls).toBe(1);
	});

	it("verifies and deduplicates captured-payment webhooks", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				if (String(input) === "https://api.razorpay.com/v1/orders") {
					return Response.json({
						id: "order_webhook_123",
						amount: 49_900,
						currency: "INR",
						status: "created",
					});
				}
				if (String(input) === "https://api.resend.com/emails") {
					return Response.json({ id: "email_webhook_123" });
				}
				throw new Error(`Unexpected provider request: ${String(input)}`);
			}),
		);
		const created = await postRegistration();
		const order = (await created.response.json()) as { registrationId: string };
		const body = JSON.stringify({
			event: "payment.captured",
			payload: {
				payment: {
					entity: {
						id: "pay_webhook_123",
						order_id: "order_webhook_123",
						amount: 49_900,
						currency: "INR",
						status: "captured",
						captured: true,
					},
				},
			},
		});
		const signature = await sign(testEnv.RAZORPAY_WEBHOOK_SECRET!, body);
		const request = () =>
			new Request("https://worker.example/api/payments/webhook", {
				method: "POST",
				headers: {
					"X-Razorpay-Signature": signature,
					"X-Razorpay-Event-Id": "evt_test_123",
				},
				body,
			});
		const webhookContext = createExecutionContext();
		const response = await worker.fetch(request(), testEnv, webhookContext);
		await waitOnExecutionContext(webhookContext);
		const duplicate = await worker.fetch(request(), testEnv, createExecutionContext());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: true });
		expect(await duplicate.json()).toEqual({ received: true, duplicate: true });
		const stored = await testEnv.DB.prepare(
			"SELECT payment_status, razorpay_payment_id FROM registrations WHERE id = ?",
		)
			.bind(order.registrationId)
			.first<{ payment_status: string; razorpay_payment_id: string }>();
		expect(stored).toEqual({
			payment_status: "paid",
			razorpay_payment_id: "pay_webhook_123",
		});
	});
});
