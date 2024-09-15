import path from 'path';
import XmlStream from 'xml-stream-saxjs';
import sax from 'sax';
import { createReadStream } from 'fs';
import * as db from './db.mjs';

let sql;
let counter = 0;

async function connect() {
  sql = await connectWithRefresh();
}

async function connectWithRefresh() {
  return db.connect({
    onclose: (message) => {
      console.log('POSTGRES CONNECTION CLOSED', message);
      connect();
    },
    onnotice: (message) => {
      console.log('POSTGRES CONNECTION NOTICE', message);
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
      console.error(`ERROR: tags - sax stream error in file ${filename}`, e);
      osm(currentByte);
    })
    .preserve('tag')
    .collect('tag')
    .on('endElement: node', (node) => {
      node.tag?.forEach((tag) => {
        console.log(`UPSERT TAG: upsert tag id ${tag.$.id} for node id ${node.$.id}`, filename);
        db.upsert({
          sql,
          table: 'osm_meta_tags',
          data: {
            node_id: node.$.id,
            k: tag.$.k,
            v: tag.$.v,
          },
          conflict: [
            'node_id',
            'k'
          ],
          updateFields: [
            'v',
          ],
        });
      });
    })
    .preserve('nd')
    .collect('nd')
    .preserve('tag')
    .collect('tag')
    .on('endElement: way', (way) => {
      // Delete all nd rows associated with this way before writing them
      // console.log(`DELETE ROWS FOR WAY: delete rows where way id = ${way.$.id}`, filename);
      db.remove({
        sql,
        table: 'osm_ways_nodes',
        conditions: {
          way_id: way.$.id
        }
      });
      way.nd?.forEach((nd, i) => {
        console.log(`UPSERT MEMBER NODE FOR WAY: upsert member node where nd id = ${nd.$.ref} and way id = ${way.$.id}`, filename);
        db.insert({
          sql,
          table: 'osm_ways_nodes',
          data: {
            way_id: way.$.id,
            node_id: nd.$.ref,
            order: i+1,
          },
        });
      });
      way.tag?.forEach((tag) => {
        console.log(`UPSERT TAG FOR WAY: upsert tag where tag key = ${tag.$.key} and way id = ${way.$.id}`, filename);
        db.upsert({
          sql,
          table: 'osm_meta_tags',
          data: {
            way_id: way.$.id,
            k: tag.$.k,
            v: tag.$.v.trim(),
          },
          conflict: [
            'way_id',
            'k'
          ],
          updateFields: [
            'v',
          ],
        });
      });
    })
    .preserve('member')
    .collect('member')
    .preserve('tag')
    .collect('tag')
    .on('endElement: relation', (relation) => {
      console.log(`UPSERT TAG FOR RELATION: upsert tag where tag key = ${tag.$.key} and relation id = ${relation.$.id}`, filename);
      console.log(`DELETE ROWS FOR RELATION: delete rows where relation id = ${relation.$.id}`, filename);
      db.deleteRows({
        sql,
        table: 'osm_relations_members',
        conditions: {
          relation_id: relation.$.id,
        }
      });
      relation.member?.forEach((member, i) => {
        console.log(`UPSERT MEMBER FOR WAY: upsert member node where member ref = ${member.$.ref} and relation id = ${relation.$.id}`, filename);
        db.insert({
          sql,
          table: 'osm_relations_members',
          data: {
            way_id: member.$.type === 'way' ? member.$.ref : null,
            node_id: member.$.type === 'node' ? member.$.ref : null,
            role: member.$.role,
          },
        });
      });
      relation.tag?.forEach((tag) => {
        console.log(`UPSERT TAG FOR RELATION: upsert tag where tag key = ${tag.$.key} and relation id = ${relation.$.id}`, filename);
        db.upsert({
          sql,
          table: 'osm_meta_tags',
          data: {
            relation_id: relation.$.id,
            k: tag.$.k,
            v: tag.$.v.trim(),
          },
          conflict: [
            'relation_id',
            'k'
          ],
          updateFields: [
            'v',
          ],
        });
      });
  });
}

async function osm(filename, start = 0, end) {
  let currentByte = start;

  connect();

  const readableStream = createReadStream(
    path.join(import.meta.dirname, `./data/${filename}`),
    {
      objectMode: true,
      highWaterMark: 500,
      start,
      ...(end && {end})
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
        console.log('CHUNK: tags', counter.toString(), filename);
        console.log('CURRENT BYTE: tags', currentByte, filename);
      }
      readableStream.pause();
      setTimeout(() => {
        counter++;
        readableStream.resume();
      }, 10);
    })
    .on('error', (e) => {
      console.error(`ERROR: tags - stream read error in file ${filename} at byte ${currentByte}`, e);
      osm(currentByte);
    })
    .on('end', () => {
      console.log(`COMPLETE: tags - stream processing complete for file ${filename}`);
      readableStream.close();
    });
}

const filename = process.argv[2];
const start = parseInt(process.argv[3]) || 0;
const end = parseInt(process.argv[4]);

osm(filename, start, end);

export default osm;
