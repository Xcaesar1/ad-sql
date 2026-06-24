export function nowIso() {
  return new Date().toISOString();
}

export function safeTimestamp(input = new Date()) {
  return input.toISOString().replace(/[:.]/g, "-");
}
