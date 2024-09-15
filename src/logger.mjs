import { createLogger, transports, format } from "winston"
import LokiTransport from "winston-loki"
 
let logger;
 
const initializeLogger = () => {
  if (logger) {
    return
  }
 
  logger = createLogger({
    transports: [new LokiTransport({
        basicAuth: `${process.env.GRAFANA_API_USER}:${process.env.GRAFANA_API_PASSWORD}`,
        host: process.env.GRAFANA_API_HOST,
        labels: { app: 'osm-reader'},
        json: true,
        format: format.json(),
        replaceTimestamp: false,
        onConnectionError: (err) => console.error(err)
      }),
      new transports.Console({
        forceConsole: true,
        format: format.combine(format.simple(), format.colorize())
      })]
  })
}
 
export const getLogger = () => {
  initializeLogger()
  return logger
}
