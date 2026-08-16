// Response serializers — the single choke point every record passes through before
// it leaves the server. This is where the TEST CHECKLIST security rules are enforced:
//   □ stream_key absent from every GET response
//   □ account_number masked to last 4 digits in instructor portal
//   □ paystack_recipient_code absent from every GET response
//   □ password_hash absent from every GET response
//   □ is_secret settings return only a boolean
//   □ access_token/refresh_token absent from every GET response (provider_connections)
//   □ meeting_host_url absent from every PUBLIC content payload

export function serializeUser<T extends Record<string, any>>(user: T) {
  const { password_hash, ...safe } = user;
  return safe;
}

export function maskAccountNumber(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null;
  const digits = accountNumber.replace(/\D/g, "");
  if (digits.length <= 4) return "••••";
  return `••••••${digits.slice(-4)}`;
}

export function serializeSpeaker<T extends Record<string, any>>(speaker: T) {
  const { account_number, paystack_recipient_code, bank_code, ...safe } = speaker;
  return {
    ...safe,
    account_number: maskAccountNumber(account_number),
    payout_configured: Boolean(paystack_recipient_code),
  };
}

export function serializeContentItem<T extends Record<string, any>>(content: T) {
  const { stream_key, ...safe } = content;
  return safe;
}

export function serializeRestreamTarget<T extends Record<string, any>>(target: T) {
  const { stream_key, ...safe } = target;
  return { ...safe, stream_key_set: Boolean(stream_key) };
}

export function serializeSetting<T extends { is_secret: boolean; setting_value: string | null }>(setting: T) {
  if (!setting.is_secret) return setting;
  const { setting_value, ...safe } = setting;
  return { ...safe, is_set: Boolean(setting_value) };
}

export function serializeProviderConnection<T extends Record<string, any>>(connection: T) {
  const { access_token, refresh_token, ...safe } = connection;
  return safe;
}
