export interface Env {
	DB: D1Database;
	RAZORPAY_KEY_ID?: string;
	RAZORPAY_KEY_SECRET?: string;
	RAZORPAY_WEBHOOK_SECRET?: string;
	RESEND_API_KEY?: string;
	RESEND_FROM_EMAIL?: string;
	ALLOWED_ORIGINS?: string;
}

export interface RegistrationInput {
	competitionName: string;
	category: "solo" | "duo" | "group" | "formation";
	danceStyle: string;
	ageGroup: string;
	participantCount: number;
	participants: string[];
	teamName: string;
	contact: {
		name: string;
		phone: string;
		email: string;
		city: string;
	};
	notes: string;
	consent: true;
}

export interface RegistrationRecord {
	id: string;
	category: RegistrationInput["category"];
	dance_style: string;
	age_group: string;
	participant_count: number;
	participants_json: string;
	team_name: string | null;
	contact_name: string;
	phone: string;
	email: string;
	city: string;
	notes: string | null;
	amount_paise: number;
	currency: string;
	razorpay_order_id: string | null;
	razorpay_payment_id: string | null;
	payment_status: "pending" | "paid";
	created_at: string;
	paid_at: string | null;
}

export interface RazorpayPayment {
	id: string;
	order_id: string;
	amount: number;
	currency: string;
	status: string;
	captured: boolean;
}

export interface RazorpayOrder {
	id: string;
	amount: number;
	currency: string;
	status: string;
}

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}
