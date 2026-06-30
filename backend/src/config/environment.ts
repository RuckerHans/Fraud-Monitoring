export interface Environment {
  DATACENTER_API_URL: string;
  AUTH_MYSQL_HOST: string;
  AUTH_MYSQL_USER: string;
  AUTH_MYSQL_PASSWORD: string;
  AUTH_MYSQL_DATABASE: string;
  API_KEY: string;
  JWT_SECRET: string;
  [key: string]: unknown;
}

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const required = [
    'DATACENTER_API_URL',
    'AUTH_MYSQL_HOST',
    'AUTH_MYSQL_USER',
    'AUTH_MYSQL_PASSWORD',
    'AUTH_MYSQL_DATABASE',
    'API_KEY',
    'JWT_SECRET',
  ] as const;
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
