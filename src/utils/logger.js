import pino from 'pino'

const isProd = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const logLevel = process.env.LOG_LEVEL ?? (isTest ? 'silent' : isProd ? 'info' : 'debug')

const logger = pino({
  level: logLevel,
  ...(isProd
    ? {
        // Production: JSON for log aggregation (Datadog, ELK, etc.)
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : isTest
      ? {
          // Test: silent — tests shouldn't produce log noise
          enabled: false,
        }
      : {
          // Development: pretty-printed for readability
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        }),
})

export default logger
