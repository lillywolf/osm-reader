import { createReadStream } from 'fs';
import path from 'path';
import XmlStream from 'xml-stream-saxjs';
import sax from 'sax';
import * as db from './db.mjs';

let sql;

async function streamData({
  xmlStream,
  filename,
  currentByte
}) {
  sql = await db.connect({
    onclose: async () => {
      console.log('POSTGRES CONNECTION CLOSED', message);
      sql = await db.connect();
    },
    onnotice: () => {
      console.log('POSTGRES CONNECTION NOTICE', message);
    }
  });

  xmlStream
    .on('error', (e) => {
      console.error(`ERROR: elements - sax stream error in file ${filename} at byte ${currentByte}`, e);
      osm(currentByte);
    })
    .on('endElement: node', (node) => {
      // console.log(`UPSERT NODE: upsert node id ${node.$.id}`, filename);
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
      // console.log(`UPSERT WAY: upsert way id ${way.$.id}`, filename);
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

async function osm(start = 0, end = Infinity) {
  let counter = 0;
  let currentByte = start;

  const filename = process.argv[2];
  const start = start || process.argv[3] || 0;
  const end = process.argv[4] || end;

  const readableStream = createReadStream(
    path.join(import.meta.dirname, `./data/${filename}`),
    {
      objectMode: true,
      highWaterMark: 500,
      start,
      end
    }
  );
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
      if (counter % 500 === 0) {
        console.log('CHUNK: elements', counter.toString(), filename);
        console.log('CURRENT BYTE: elements', currentByte, filename);
      }
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
