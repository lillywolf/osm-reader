import { createReadStream } from 'fs';
import path from 'path';
import XmlStream from 'xml-stream-saxjs';
import sax from 'sax';
import * as db from './db.mjs';

async function streamData({
  xmlStream,
  filename,
  currentByte
}) {
  const sql = await db.connect();

  xmlStream
    .on('error', (e) => {
      console.error(`ERROR: elements - sax stream error in file ${filename} at byte ${currentByte}`, e);
      osm(currentByte);
    })
    .on('endElement: node', (node) => {
      console.log(`UPSERT NODE: upsert node id ${node.$.id}`, filename);
      try {
        db.upsert({
          sql,
          table: 'osm_nodes',
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
        console.error(`POSTGRES ERROR: insert failed for upsert node ${node.$.id}`);
      }
    })
    .on('endElement: way', (way) => {
      console.log(`UPSERT WAY: upsert way id ${way.$.id}`, filename);
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
        console.error(`POSTGRES ERROR: insert failed for upsert way ${way.$.id}`);
      }
    })
    .on('endElement: relation', (relation) => {
      console.log(`UPSERT RELATION: upsert relation id ${relation.$.id}`, filename);
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
      console.error(`POSTGRES ERROR: insert failed for upsert relation ${relation.$.id}`);
    }
  });
}

async function osm(byte) {
  let counter = 0;
  let currentByte = byte || 0;

  const filename = process.argv[2];
  const readableStream = createReadStream(path.join(import.meta.dirname, `./data/${filename}`), { objectMode: true, highWaterMark: 500, start: currentByte });
  const saxStream = sax.createStream(true);
  const xmlStream = new XmlStream(readableStream);

  streamData({
    xmlStream,
    filename,
    currentByte,
  });

  readableStream
    .pipe(saxStream)
    .on('data', (chunk) => {
      currentByte += chunk.length;
      console.log('CHUNK: elements', counter.toString(), filename);
      readableStream.pause();
      setTimeout(() => {
        counter++;
        readableStream.resume();
      }, 10);
    })
    .on('error', (e) => {
      console.error(`ERROR: elements - stream read error in file ${filename} at byte ${currentByte}`, e);
      osm(currentByte);
    })
    .on('end', () => {
      console.log(`COMPLETE: elements - stream processing complete for file ${filename}`);
      readableStream.close();
    });
}

osm();

export default osm;
