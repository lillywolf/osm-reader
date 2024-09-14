import { createLogger, transports, format } from "winston"
import LokiTransport from "winston-loki"
 
let logger;
 
const initializeLogger = () => {
  if (logger) {
    return
  }
 
  logger = createLogger({
    transports: [new LokiTransport({
        host: "<YOUR API URL GOES HERE (FROM PREVIOUS STEP)>",
        labels: { app: 'osm-reader'},
        json: true,
        format: format.json(),
        replaceTimestamp: true,
        onConnectionError: (err) => console.error(err)
      }),
      new transports.Console({
        format: format.combine(format.simple(), format.colorize())
      })]
  })
}
 
export const getLogger = () => {
  initializeLogger()
  return logger
}
