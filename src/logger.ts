import { createLogger, transports, format, Logger as WinstonLogger } from "winston";
import LokiTransport from "winston-loki";
 
class Logger {
  public static _winston: WinstonLogger;
  public static _instance: Logger;

  constructor() {
    if (!process.env.GRAFANA_API_HOST) {
      console.error(`Cannot instantiate Logger; no value found for GRAFANA_API_HOST`);
      return;
    }

    Logger._instance = this;

    Logger._winston = createLogger({
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
    });
  }

  public static getInstance() {
    if (!Logger._instance) {
      Logger._instance = new Logger();
    }

    return Logger._winston;
  }
}

export default Logger;
