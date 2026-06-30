export interface Environment {
  DATACENTER_API_URL: string;
  AUTH_SERVICE_URL: string;
  API_KEY: string;
  JWT_SECRET: string;
  [key: string]: unknown;
}

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const required = ['DATACENTER_API_URL', 'AUTH_SERVICE_URL', 'API_KEY', 'JWT_SECRET'] as const;
  for (const name of required) {
    if (typeof input[name] !== 'string' || input[name].trim() === '') {
      throw new Error(`${name} is required.`);
    }
  }
  if ((input.JWT_SECRET as string).length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }
  return input as Environment;
}
