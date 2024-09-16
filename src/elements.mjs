import { createReadStream } from 'fs';
import { getLogger } from './logger.mjs';
import path from 'path';
import XmlStream from 'xml-stream-saxjs';
import sax from 'sax';
import * as db from './db.mjs';

let sql;
let counter = 0;

const logger = getLogger();

const filename = process.argv[2];
const start = parseInt(process.argv[3]) || 0;
const end = parseInt(process.argv[4]);

async function connect() {
  sql = await connectWithRefresh();
}

async function connectWithRefresh() {
  return db.connect({
    onclose: (connectionId) => {
      logger.error('POSTGRES CONNECTION CLOSED', connectionId);
      logger.info('ATTEMPTING RECONNECTION');
      connect();
    },
    onnotice: (message) => {
      logger.warn('POSTGRES CONNECTION NOTICE', message);
    }
  });
}

async function streamData({
  xmlStream,
  filename,
  currentByte
}) {
  xmlStream
    .on('error', (e) => {
      logger.error(`ERROR: elements - sax stream error in file ${filename} at byte ${currentByte}`, e);
      xmlStream._parser._parser.error = null;
    })
    .on('endElement: node', (node) => {
      logger.info(`UPSERT NODE: upsert node id ${node.$.id}`, filename);
      try {
        db.upsert({
          sql,
          table: 'osm_nodes_test',
          data: {
            id: node.$.id,
            timestamp: node.$.timestamp,
            lat: node.$.lat,
            lon: node.$.lon,
          },
          conflict: [
            'id',
          ],
          updateFields: [
            'lat',
            'lon',
            'timestamp'
          ],
        })
      }
      catch (e) {
        logger.error(`POSTGRES ERROR: insert failed for upsert node ${node.$.id}`);
      }
    })
    .on('endElement: way', (way) => {
      try {
        db.upsert({
          sql,
          table: 'osm_ways',
          data: {
            id: way.$.id,
            timestamp: way.$.timestamp,
            version: way.$.version
          },
          conflict: [
            'id',
          ],
          updateFields: [
            'timestamp'
          ],
        })
      }
      catch (e) {
        logger.error(`POSTGRES ERROR: insert failed for upsert way ${way.$.id}`);
      }
    })
    .on('endElement: relation', (relation) => {
      logger.info(`UPSERT RELATION: upsert relation id ${relation.$.id}`, filename);
      try {
        db.upsert({
          sql,
          table: 'osm_relations',
          data: {
            id: relation.$.id,
            timestamp: relation.$.timestamp,
            version: relation.$.version
          },
          conflict: [
            'id',
          ],
          updateFields: [
            'version',
            'timestamp'
          ],
      }); 
    }
    catch (e) {
      logger.error(`POSTGRES ERROR: insert failed for upsert relation ${relation.$.id}`);
    }
  });
}

async function osm(filename, start = 0, end) {
  let currentByte = start;

  await connect();

  const readableStream = createReadStream(
    path.join(import.meta.dirname, `./data/${filename}`),
    {
      objectMode: true,
      highWaterMark: 1000,
      start,
      ...(end && {end})
    }
  );
  const saxStream = sax.createStream(false);
  const xmlStream = new XmlStream(readableStream);
  
  streamData({
    xmlStream,
    filename,
    currentByte,
  });

  readableStream
    .pipe(saxStream)
    .on('data', (chunk) => {
      // This is a hack
      // xml-stream-saxjs doesn't make it clear how to set the strict property
      // on the underlying sax class. So we are doing it this way
      // xmlStream._parser._parser.strict = false;

      currentByte += chunk.length;
      if (counter % 10 === 0) {
        logger.info(`CHUNK: position ${counter.toString()} when parsing elements for ${filename}`);
        logger.info(`CURRENT BYTE: ${currentByte} when parsing elements for ${filename}`);
        logger.info(`CURRENT TAG: ${JSON.stringify(xmlStream._parser._parser.tag)} when parsing elements for ${filename}`);
        logger.info(`CURRENT TAG START POSITION: ${xmlStream._parser._parser.startTagPosition} when parsing elements for ${filename}`);
      }
      readableStream.pause();
      setTimeout(() => {
        counter++;
        readableStream.resume();
      }, 20);
    })
    .on('error', (e) => {
      logger.error(`ERROR: elements - stream read error in file ${filename} at byte ${currentByte}`, e);
      osm(currentByte);
    })
    .on('end', () => {
      logger.info(`COMPLETE: elements - stream processing complete for file ${filename}`);
      readableStream.close();
    });
}

logger.info('Starting OSM reader ...');

osm(filename, start, end);

export default osm;
