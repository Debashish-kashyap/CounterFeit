type SecretName = "JWT_SECRET" | "QR_HMAC_SECRET";

const localDemoSecrets: Record<SecretName, string> = {
  JWT_SECRET: "counterfeit-local-demo-jwt-secret-not-for-production",
  QR_HMAC_SECRET: "counterfeit-local-demo-qr-secret-not-for-production",
};

export function getAppSecret(name: SecretName): string {
  const configured = process.env[name];
  const secret =
    configured ?? (process.env.NODE_ENV === "production" ? undefined : localDemoSecrets[name]);

  if (
    !secret ||
    secret === "change-me" ||
    secret.startsWith("replace-with-") ||
    secret.length < 32 ||
    (process.env.NODE_ENV === "production" && secret === localDemoSecrets[name])
  ) {
    throw new Error(`${name} must be configured with a private value of at least 32 characters`);
  }

  return secret;
}
