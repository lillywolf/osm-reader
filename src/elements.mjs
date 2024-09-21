import fs from 'fs';
import { getLogger } from './logger.js';
import path from 'path';
import XmlStream from 'xml-stream-saxjs';
import sax from 'sax';
import * as db from './db.js';

let sql;
let counter = 0;

const logger = getLogger();

const filename = process.argv[2];
const start = parseInt(process.argv[3]) || 0;
const end = parseInt(process.argv[4]);

function isNumber(value) {
  return typeof value === 'number' && !isNaN(value);
}

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

function readXmlStream({ start, end, filename }) {
  let currentByte = start;

  const readableStream = fs.createReadStream(
    path.join(import.meta.dirname, `./data/${filename}`),
    {
      objectMode: true,
      highWaterMark: 1000,
      start,
      ...(end && {end})
    }
  );

  const saxStream = sax.createStream(true);
  const xmlStream = new XmlStream(readableStream);

  saveXml({ xmlStream, filename });

  readableStream
    .pipe(saxStream)
    .on('data', (chunk) => {
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
    })
    .on('end', () => {
      logger.info(`COMPLETE: elements - stream processing complete for file ${filename}`);
      readableStream.close();
    });
}

async function saveXml({
  xmlStream,
  filename,
}) {
  await connect();

  xmlStream
    .on('error', (e) => {
      logger.error(`ERROR: elements - sax stream error in file ${filename}`, e);
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
      logger.info(`UPSERT WAY: upsert way id ${way.$.id}`, filename);
      try {
        db.upsert({
          sql,
          table: 'osm_ways_test',
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

async function osm(filename, start, end) {
  let startByte;

  const filepath = path.join(import.meta.dirname, `./data/${filename}`);
  const validationStream = fs.createReadStream(
    filepath,
    {
      objectMode: true,
      highWaterMark: 1000,
      start,
    }
  );

  validationStream
    .on('data', (chunk) => {
      const regex = /(<[^/]*>)/;
      const openingTag = regex.exec(chunk);
      startByte = openingTag.index;

      if (isNumber(startByte)) {
        logger.info(`START BYTE ${startByte}`);

        const modifiedData = chunk.toString('utf-8').replace(openingTag[0], `<osm version="0.6" generator="osmium/1.14.0">\n  ${openingTag[0]}`);
      
        readXmlStream({ start: startByte, end, filename });
        validationStream.destroy();
      }
    })
    .pipe(new TransformStream())
    .pipe(fs.createWriteStream('output/file'));
}

logger.info('Starting OSM reader ...');

osm(filename, start, end);

export default osm;
