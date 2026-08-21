import pino from 'pino';

const DEFAULT_SCOPE = 'World Tree';
const SENSITIVE_KEY_PATTERN = /token|secret|authorization|verifier|state|code/i;
const SENSITIVE_MESSAGE_PATTERNS = [
  /(access_token=)[^&\s]+/gi,
  /(refresh_token=)[^&\s]+/gi,
  /(code=)[^&\s]+/gi,
  /(code_verifier=)[^&\s]+/gi,
  /(state=)[^&\s]+/gi,
  /(client_secret=)[^&\s]+/gi,
  /(authorization:\s*bearer\s+)[^\s]+/gi
];

function redactMessage(value) {
  return SENSITIVE_MESSAGE_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, '$1[REDACTED]'),
    String(value)
  );
}

function sanitizeDetails(value) {
  if (value instanceof Error) {
    return {
      type: value.name,
      message: redactMessage(value.message),
      stack: value.stack ? redactMessage(value.stack) : undefined,
      code: value.code
    };
  }

  if (typeof value === 'string') {
    return redactMessage(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDetails(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeDetails(entry)
      ])
    );
  }

  return value;
}

function buildPinoOptions({ scope, level, bindings, isProduction, stream }) {
  const options = {
    level,
    base: {
      scope,
      ...sanitizeDetails(bindings)
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      }
    },
    redact: {
      paths: [
        'accessToken',
        'refreshToken',
        'clientSecret',
        'client_secret',
        'authorization',
        'codeVerifier',
        'code_verifier',
        'state',
        'details.accessToken',
        'details.refreshToken',
        'details.clientSecret',
        'details.client_secret',
        'details.authorization',
        'details.codeVerifier',
        'details.code_verifier',
        'details.state',
        'details.*.accessToken',
        'details.*.clientSecret',
        'details.*.client_secret'
      ],
      censor: '[REDACTED]'
    }
  };

  if (!isProduction && !stream) {
    try {
      options.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          singleLine: false
        }
      };
    } catch {}
  }

  return options;
}

function normalizeDetails(details) {
  return details === undefined ? undefined : sanitizeDetails(details);
}

export function createLogger({
  scope = DEFAULT_SCOPE,
  component = null,
  bindings = {},
  isProduction = process.env.NODE_ENV === 'production',
  level = isProduction ? 'info' : 'debug',
  stream
} = {}) {
  const loggerBindings = component ? { ...bindings, component } : bindings;
  const pinoLogger = pino(buildPinoOptions({ scope, level, bindings: loggerBindings, isProduction, stream }), stream);

  return createLoggerAdapter(pinoLogger);
}

function createLoggerAdapter(pinoLogger) {
  function emit(logLevel, message, details) {
    const safeMessage = redactMessage(message);
    const safeDetails = normalizeDetails(details);

    if (safeDetails === undefined) {
      pinoLogger[logLevel](safeMessage);
      return;
    }

    pinoLogger[logLevel]({ details: safeDetails }, safeMessage);
  }

  return Object.freeze({
    info(message, details) {
      emit('info', message, details);
    },

    warn(message, details) {
      emit('warn', message, details);
    },

    error(message, details) {
      emit('error', message, details);
    },

    debug(message, details) {
      emit('debug', message, details);
    },

    child(childBindings = {}) {
      return createLoggerAdapter(pinoLogger.child(sanitizeDetails(childBindings)));
    }
  });
}

export const logger = createLogger();
