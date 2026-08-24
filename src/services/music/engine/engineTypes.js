/**
 * @readonly
 * @enum {string}
 */
export const AudioEngineType = {
  JS: 'js',
  RUST: 'rust',
  AUTO: 'auto'
};

/**
 * @readonly
 * @enum {string}
 */
export const AudioEngineStatus = {
  ACTIVE: 'active',
  FALLBACK: 'fallback',
  UNAVAILABLE: 'unavailable'
};
