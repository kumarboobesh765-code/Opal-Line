import pino from 'pino'

const isProd = process.env.NODE_ENV === 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() }
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'opal-line-server',
    env: process.env.NODE_ENV ?? 'development',
  },
})

export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings)
}

export function logError(err: Error, context: Record<string, unknown> = {}) {
  const errObj: Record<string, unknown> = { message: err.message, name: err.name }
  if (!isProd) errObj.stack = err.stack
  logger.error({ err: errObj, ...context })
}

export function logWarn(message: string, context: Record<string, unknown> = {}) {
  logger.warn({ ...context, message })
}

export function logInfo(message: string, context: Record<string, unknown> = {}) {
  logger.info({ ...context, message })
}

export function logDebug(message: string, context: Record<string, unknown> = {}) {
  logger.debug({ ...context, message })
}