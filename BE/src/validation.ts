import { HttpError, type RegistrationInput } from "./types";

const CATEGORY_LIMITS = {
	solo: { min: 1, max: 1, amountPaise: 49_900 },
	duo: { min: 2, max: 2, amountPaise: 79_900 },
	group: { min: 3, max: 8, amountPaise: 129_900 },
	formation: { min: 9, max: 15, amountPaise: 179_900 },
} as const;

const DANCE_STYLES = new Set([
	"Bollywood",
	"Hip-hop",
	"Contemporary",
	"Classical",
	"Freestyle",
	"Western",
	"Folk",
	"Other",
]);
const AGE_GROUPS = new Set(["Under 12", "12–17", "18–25", "26+", "Mixed age"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[6-9]\d{9}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
	value: unknown,
	name: string,
	maxLength: number,
): string {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.trim().length > maxLength
	) {
		throw new HttpError(400, `Invalid ${name}.`);
	}
	return value.trim();
}

function optionalString(value: unknown, name: string, maxLength: number): string {
	if (value === undefined || value === null || value === "") return "";
	if (typeof value !== "string" || value.trim().length > maxLength) {
		throw new HttpError(400, `Invalid ${name}.`);
	}
	return value.trim();
}

export function getCategoryPrice(category: RegistrationInput["category"]) {
	return CATEGORY_LIMITS[category];
}

export function validateRegistration(value: unknown): RegistrationInput {
	if (!isRecord(value)) throw new HttpError(400, "Request body must be a JSON object.");
	if (value.competitionName !== "OFFBEAT") {
		throw new HttpError(400, "Invalid competition name.");
	}

	if (
		typeof value.category !== "string" ||
		!Object.hasOwn(CATEGORY_LIMITS, value.category)
	) {
		throw new HttpError(400, "Choose a valid competition category.");
	}
	const category = value.category as RegistrationInput["category"];
	const limits = getCategoryPrice(category);

	if (typeof value.participantCount !== "number" || !Number.isInteger(value.participantCount)) {
		throw new HttpError(400, "Participant count must be a whole number.");
	}
	if (
		value.participantCount < limits.min ||
		value.participantCount > limits.max
	) {
		throw new HttpError(
			400,
			`This category allows ${limits.min}–${limits.max} participant(s).`,
		);
	}
	if (!Array.isArray(value.participants) || value.participants.length !== value.participantCount) {
		throw new HttpError(400, "Enter the name of every participant.");
	}
	const participants = value.participants.map((participant, index) =>
		requiredString(participant, `participant ${index + 1} name`, 80),
	);

	const danceStyle = requiredString(value.danceStyle, "dance style", 40);
	if (!DANCE_STYLES.has(danceStyle)) throw new HttpError(400, "Choose a valid dance style.");
	const ageGroup = requiredString(value.ageGroup, "age group", 20);
	if (!AGE_GROUPS.has(ageGroup)) throw new HttpError(400, "Choose a valid age group.");

	if (!isRecord(value.contact)) throw new HttpError(400, "Contact details are required.");
	const contactName = requiredString(value.contact.name, "contact name", 80);
	const phone = requiredString(value.contact.phone, "phone number", 10);
	if (!PHONE_PATTERN.test(phone)) {
		throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.");
	}
	const email = requiredString(value.contact.email, "email address", 120).toLowerCase();
	if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, "Enter a valid email address.");
	const city = requiredString(value.contact.city, "city", 60);
	const teamName = optionalString(value.teamName, "team name", 70);
	const notes = optionalString(value.notes, "notes", 500);
	if (value.consent !== true) {
		throw new HttpError(400, "Consent is required to complete registration.");
	}

	return {
		competitionName: "OFFBEAT",
		category,
		danceStyle,
		ageGroup,
		participantCount: value.participantCount,
		participants,
		teamName,
		contact: { name: contactName, phone, email, city },
		notes,
		consent: true,
	};
}

export function validateRegistrationId(value: string): boolean {
	return /^OFF-[A-F0-9]{24}$/.test(value);
}
