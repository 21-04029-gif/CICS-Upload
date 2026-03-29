export function getPaymongoSecretKey() {
  return process.env.PAYMONGO_SECRET_KEY || "";
}

export function getPaymongoAuthHeader() {
  const key = getPaymongoSecretKey();
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}
