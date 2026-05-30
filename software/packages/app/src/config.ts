/**
 * App-wide config. Single source of truth for environment-specific values.
 *
 * API_BASE: the Eddi backend base URL. Currently the raw API Gateway URL —
 * swap to `https://api.eddi.audio` once that custom domain is set up (see
 * docs/STATUS.md "DNS / domains"). __DEV__ lets a future local/staging backend
 * be slotted in without touching call sites.
 */
const PROD_API_BASE = 'https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod'

export const API_BASE: string = __DEV__ ? PROD_API_BASE : PROD_API_BASE

/** Public web origin for shareable card links (eddi.audio/c/{id}). */
export const WEB_ORIGIN = 'https://eddi.audio'
