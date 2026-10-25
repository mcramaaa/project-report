/** Global route prefix for the REST API (docs/API.md: base `/api`). */
export const API_PREFIX = 'api';

export interface HealthResponse {
  status: 'ok';
}

export * from './audit.js';
export * from './auth.js';
export * from './projects.js';
export * from './users.js';
