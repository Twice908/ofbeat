/* OFFBEAT — Dance competition frontend. Public settings are generated from FE/.env. */
const publicConfig = window.OFFBEAT_CONFIG || {};
const CONFIG = {
  competitionName: "OFFBEAT",
  currency: "INR",
  apiBase: publicConfig.apiBaseUrl || "",
  razorpayKeyId: publicConfig.razorpayKeyId || "",
  fees: { solo: 499, duo: 799, group: 1299, formation: 1799 },
  participantLimits: { solo: [1, 1], duo: [2, 2], group: [3, 8], formation: [9, 15] },
  paymentDescription: "Dance competition entry fee"
};

const CATEGORY_LABELS = { solo: "Solo Spotlight", duo: "Duo Sync", group: "Crew Mode", formation: "Big Formation" };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $("#registrationForm");
const modal = $("#modal");
const categorySelect = $("#category");
const countInput = $("#participantCount");
const participantFields = $("#participantFields");
const feeAmount = $("#feeAmount");
const formError = $("#formError");
const payButton = $("#payButton");
const successPanel = $("#successPanel");
let selectedRegistration = null;
let registrationReturnFocus = null;

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initRegistration();
});

function initNavigation() {
  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const bookButton = target.closest("[data-book]");
    if (bookButton) {
      event.preventDefault();
      if (bookButton.closest("#menu") && $("#menu").style.visibility === "visible") $("#menuBtn")?.click();
      const category = bookButton.dataset.category || bookButton.dataset.entry || "";
      openRegistration(category === "crew" ? "group" : category);
      return;
    }
    if (target.closest("[data-close], #doneButton")) closeRegistration();
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && modal.classList.contains("is-open")) closeRegistration(); });
}

function openRegistration(category = "") {
  registrationReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("m-open");
  form.hidden = false;
  successPanel.hidden = true;
  showError("");
  if (category) categorySelect.value = category;
  updateCategoryFields();
  window.setTimeout(() => categorySelect.focus(), 100);
}
function closeRegistration() {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("m-open");
  registrationReturnFocus?.focus({ preventScroll: true });
  registrationReturnFocus = null;
}

function initRegistration() {
  categorySelect.addEventListener("change", updateCategoryFields);
  countInput.addEventListener("input", () => {
    clampParticipantCount();
    renderParticipantInputs();
  });
  form.addEventListener("submit", handleRegistrationSubmit);
  updateCategoryFields();
}

function getLimits() {
  return CONFIG.participantLimits[categorySelect.value] || [1, 15];
}
function clampParticipantCount() {
  const [min, max] = getLimits();
  let value = Number(countInput.value || min);
  value = Math.min(max, Math.max(min, value));
  countInput.value = value;
}
function updateCategoryFields() {
  const category = categorySelect.value;
  const [min, max] = getLimits();
  countInput.min = min;
  countInput.max = max;
  if (category) {
    countInput.value = min;
    countInput.disabled = min === max;
    feeAmount.textContent = formatCurrency(CONFIG.fees[category]);
    $("#feeNote").textContent = `${CATEGORY_LABELS[category]} · ${min === max ? `${min} participant${min > 1 ? "s" : ""}` : `${min}–${max} participants`}`;
  } else {
    countInput.value = 1;
    countInput.disabled = false;
    feeAmount.textContent = "Select a category";
    $("#feeNote").textContent = "Final fee is shown before checkout.";
  }
  renderParticipantInputs();
}
function renderParticipantInputs() {
  const count = Number(countInput.value || 1);
  const currentValues = $$(".participant-input", participantFields).map(input => input.value);
  participantFields.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const label = document.createElement("label");
    label.className = "field-label";
    label.htmlFor = `participant-${i + 1}`;
    label.textContent = count === 1 ? "Participant name" : `Participant ${i + 1} name`;
    const input = document.createElement("input");
    input.className = "participant-input";
    input.id = `participant-${i + 1}`;
    input.name = "participants";
    input.type = "text";
    input.maxLength = 80;
    input.required = true;
    input.placeholder = count === 1 ? "Full name" : `Full name of participant ${i + 1}`;
    input.value = currentValues[i] || (i === 0 ? $("#leaderName").value : "");
    participantFields.append(label, input);
  }
}
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: CONFIG.currency, maximumFractionDigits: 0 }).format(amount);
}
function collectRegistration() {
  const category = categorySelect.value;
  return {
    competitionName: CONFIG.competitionName,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    danceStyle: $("#danceStyle").value,
    ageGroup: $("#ageGroup").value,
    participantCount: Number(countInput.value),
    participants: $$(".participant-input", participantFields).map(input => input.value.trim()),
    teamName: $("#teamName").value.trim(),
    contact: {
      name: $("#leaderName").value.trim(),
      phone: $("#phone").value.trim(),
      email: $("#email").value.trim().toLowerCase(),
      city: $("#city").value.trim()
    },
    notes: $("#notes").value.trim(),
    consent: $("#consent").checked
  };
}
function validateRegistration(data) {
  if (!data.category) return "Please select a competition category.";
  if (!data.danceStyle || !data.ageGroup) return "Please select your dance style and age category.";
  const [min, max] = getLimits();
  if (data.participantCount < min || data.participantCount > max) return `This category allows ${min}–${max} dancer(s).`;
  if (data.participants.length !== data.participantCount || data.participants.some(name => !name)) return "Please enter the name of every participant.";
  if (!data.contact.name || !/^[6-9]\d{9}$/.test(data.contact.phone)) return "Enter a valid 10-digit Indian mobile number.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact.email)) return "Enter a valid email address.";
  if (!data.contact.city) return "Please enter your city.";
  if (!data.consent) return "Please accept the declaration to continue.";
  return "";
}
function showError(message) { formError.textContent = message; }
function setBusy(busy, label = "Continue to payment") {
  payButton.disabled = busy;
  payButton.textContent = busy ? label : "";
  if (!busy) payButton.innerHTML = 'Continue to payment <span>↗</span>';
}
async function apiRequest(path, options = {}) {
  if (!CONFIG.apiBase) {
    throw new Error("Backend is not configured yet. Set FE_API_BASE_URL in FE/.env and run the frontend config generator.");
  }
  const response = await fetch(`${CONFIG.apiBase.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `Request failed (${response.status}).`);
  return payload;
}

async function handleRegistrationSubmit(event) {
  event.preventDefault();
  showError("");
  const data = collectRegistration();
  const validationError = validateRegistration(data);
  if (validationError) { showError(validationError); return; }
  if (!window.Razorpay) { showError("Payment checkout could not load. Check your connection and try again."); return; }
  if (!CONFIG.razorpayKeyId) {
    showError("Razorpay Key ID is not configured. Set FE_RAZORPAY_KEY_ID in FE/.env and run the frontend config generator.");
    return;
  }

  setBusy(true, "Creating secure order…");
  try {
    // Backend stores a pending registration and creates the Razorpay order using its secret key.
    const order = await apiRequest("/api/registrations", { method: "POST", body: JSON.stringify(data) });
    if (!order.orderId || !order.registrationId || !order.amount) throw new Error("The backend returned an incomplete payment order.");
    selectedRegistration = { registrationId: order.registrationId, data };
    openRazorpayCheckout(order);
  } catch (error) {
    showError(error.message || "Unable to start registration. Please try again.");
    setBusy(false);
  }
}

function openRazorpayCheckout(order) {
  const options = {
    key: CONFIG.razorpayKeyId,
    amount: order.amount,
    currency: order.currency || CONFIG.currency,
    name: CONFIG.competitionName,
    description: CONFIG.paymentDescription,
    order_id: order.orderId,
    prefill: {
      name: selectedRegistration.data.contact.name,
      email: selectedRegistration.data.contact.email,
      contact: selectedRegistration.data.contact.phone
    },
    notes: { registration_id: order.registrationId },
    theme: { color: "#d7ff54" },
    modal: {
      ondismiss: () => {
        setBusy(false);
        showError("Checkout was closed. Your entry is still pending; you can try payment again or contact the organiser.");
      }
    },
    handler: async paymentResponse => {
      // Frontend response is not trusted as proof. Ask backend to verify signature and order/payment state.
      setBusy(true, "Verifying payment…");
      try {
        const result = await apiRequest("/api/payments/verify", {
          method: "POST",
          body: JSON.stringify({
            registrationId: selectedRegistration.registrationId,
            razorpay_order_id: paymentResponse.razorpay_order_id,
            razorpay_payment_id: paymentResponse.razorpay_payment_id,
            razorpay_signature: paymentResponse.razorpay_signature
          })
        });
        if (!result.verified || result.status !== "paid") throw new Error("Payment verification is pending. Please keep your payment ID and contact the organiser.");
        showSuccess(result);
      } catch (error) {
        showError(`${error.message} Payment ID: ${paymentResponse.razorpay_payment_id}`);
        setBusy(false);
      }
    }
  };
  const checkout = new Razorpay(options);
  checkout.on("payment.failed", response => {
    const description = response.error?.description || "Payment failed. Please try another payment method.";
    showError(description);
    setBusy(false);
  });
  setBusy(false);
  checkout.open();
}

function showSuccess(result) {
  form.hidden = true;
  successPanel.hidden = false;
  $("#successRegistrationId").textContent = result.registrationId || selectedRegistration.registrationId;
  $("#successMessage").textContent = result.message || "A confirmation has been recorded. Please check your email or WhatsApp for event updates.";
  $(".m-panel", modal).scrollTo({ top: 0, behavior: "smooth" });
  showToast("Registration confirmed!");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}
