import path from 'path';
import XmlStream from 'xml-stream-saxjs';
import { createReadStream } from 'fs';
import * as db from './db.mjs';

async function osm() {
  const filename = process.argv[2];
  const readableStream = createReadStream(path.join(import.meta.dirname, `./data/${filename}`), { objectMode: true, highWaterMark: 500 });
  const xmlStream = new XmlStream(readableStream);
  const sql = await db.connect();

  let counter = 0;

  xmlStream
    .on('error', (e) => {
      console.error(`ERROR: elements - sax stream error in file ${filepath}`, e);
    })
    .on('endElement: node', (node) => {
      console.log(`UPSERT NODE: upsert node id ${node.$.id}`, filepath);
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
    })
    .on('endElement: way', (way) => {
      console.log(`UPSERT WAY: upsert way id ${way.$.id}`, filepath);
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
    })
    .on('endElement: relation', (relation) => {
      console.log(`UPSERT RELATION: upsert relation id ${relation.$.id}`, filepath);
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
  });

  readableStream
    .pipe(saxStream)
    .on('data', (chunk) => {
      console.log('CHUNK: elements', counter.toString(), filepath);
      readableStream.pause();
      setTimeout(() => {
        counter++;
        readableStream.resume();
      }, 10);
    })
    .on('error', (e) => {
      console.error(`ERROR: elements - stream read error in file ${filepath}`, e);
    })
    .on('end', () => {
      console.log(`COMPLETE: elements - stream processing complete for file ${filepath}`);
    });
}

osm();

export default osm;
