import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import * as db from './db';
import OSMXmlParser from './xml/parse';
import Logger from './logger';

dotenv.config();

let sql;
let counter = 0;

const filename = process.argv[2];
const start = parseInt(process.argv[3]) || 0;
const end = parseInt(process.argv[4]);

async function connect() {
  sql = await connectWithRefresh();
}

async function connectWithRefresh() {
  const logger = Logger.getInstance();

  return db.connect({
    onclose: (connectionId: string) => {
      logger.error('POSTGRES CONNECTION CLOSED', connectionId);
      logger.info('ATTEMPTING RECONNECTION');
      connect();
    },
    onnotice: (message: string) => {
      logger.warn('POSTGRES CONNECTION NOTICE', message);
    }
  });
}

// async function saveXml({
//   xmlStream,
//   filename,
// }) {
//   await connect();

//   xmlStream
//     .on('error', (e) => {
//       logger.error(`ERROR: elements - sax stream error in file ${filename}`, e);
//     })
//     .on('endElement: node', (node) => {
//       logger.info(`UPSERT NODE: upsert node id ${node.$.id}`, filename);
//       try {
//         db.upsert({
//           sql,
//           table: 'osm_nodes_test',
//           data: {
//             id: node.$.id,
//             timestamp: node.$.timestamp,
//             lat: node.$.lat,
//             lon: node.$.lon,
//           },
//           conflict: [
//             'id',
//           ],
//           updateFields: [
//             'lat',
//             'lon',
//             'timestamp'
//           ],
//         })
//       }
//       catch (e) {
//         logger.error(`POSTGRES ERROR: insert failed for upsert node ${node.$.id}`);
//       }
//     })
//     .on('endElement: way', (way) => {
//       logger.info(`UPSERT WAY: upsert way id ${way.$.id}`, filename);
//       try {
//         db.upsert({
//           sql,
//           table: 'osm_ways_test',
//           data: {
//             id: way.$.id,
//             timestamp: way.$.timestamp,
//             version: way.$.version
//           },
//           conflict: [
//             'id',
//           ],
//           updateFields: [
//             'timestamp'
//           ],
//         })
//       }
//       catch (e) {
//         logger.error(`POSTGRES ERROR: insert failed for upsert way ${way.$.id}`);
//       }
//     })
//     .on('endElement: relation', (relation) => {
//       logger.info(`UPSERT RELATION: upsert relation id ${relation.$.id}`, filename);
//       try {
//         db.upsert({
//           sql,
//           table: 'osm_relations',
//           data: {
//             id: relation.$.id,
//             timestamp: relation.$.timestamp,
//             version: relation.$.version
//           },
//           conflict: [
//             'id',
//           ],
//           updateFields: [
//             'version',
//             'timestamp'
//           ],
//       }); 
//     }
//     catch (e) {
//       logger.error(`POSTGRES ERROR: insert failed for upsert relation ${relation.$.id}`);
//     }
//   });
// }

async function osm(filename: string, start: number, end: number) {
  let currentByte = start;
  let count = 0;

  const logger = Logger.getInstance();

  logger.info('Starting OSM reader ...');

  const osmXmlParser = new OSMXmlParser();
  const filepath = path.resolve(__dirname, `./data/${filename}`);
  const readableStream = fs.createReadStream(
    filepath,
    {
      // objectMode: true,
      highWaterMark: 1000,
      start,
    }
  );

  osmXmlParser.on('node', (element) => {
    logger.info(`FOUND <node />: ${JSON.stringify(element)}`);
  });

  osmXmlParser.on('way', (element) => {
    logger.info(`FOUND <way />: ${JSON.stringify(element)}`);
  });

  osmXmlParser.on('relation', (element) => {
    logger.info(`FOUND <relation />: ${JSON.stringify(element)}`);
  });

  osmXmlParser.on('tag', (element) => {
    logger.info(`FOUND <tag />: ${JSON.stringify(element)}`);
  });

  osmXmlParser.on('nd', (element) => {
    logger.info(`FOUND <nd />: ${JSON.stringify(element)}`);
  });

  readableStream
    .on('data', (chunk) => {
      currentByte += chunk.length;
      if (currentByte < 8000) {
        console.log('>> chunk count', count);
        count++;

        readableStream.pause();
        osmXmlParser.handleChunk(chunk.toString());
        readableStream.resume();
      }
    })
    .on('error', (e) => {
      logger.error(`ERROR: elements - stream read error in file ${filename} at byte ${currentByte}`, e);
    })
    .on('end', () => {
      logger.info(`COMPLETE: elements - stream processing complete for file ${filename}`);
      readableStream.close();
    });
}

osm(filename, start, end);

export default osm;
