import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import * as db from './db';
import OSMXmlParser, { TagData } from './xml/parse';
import Logger from './logger';
import sleep from './util/sleep';

dotenv.config({ path: '../.env' });

const LOG_INCREMENT = 100;

let sql;

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
      // logger.info('ATTEMPTING RECONNECTION');
      // connect();
    },
    onnotice: (message: string) => {
      logger.warn('POSTGRES CONNECTION NOTICE', message);
    }
  });
}

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
      highWaterMark: 10000,
      start,
      ...(end && {end})
    }
  );

  async function upsertNode(node: TagData) {
    try {
      await db.upsert({
        sql,
        table: 'osm_nodes',
        data: {
          id: node.properties.id,
          timestamp: node.properties.timestamp,
          lat: node.properties.lat,
          lon: node.properties.lon,
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
      logger.error(`POSTGRES ERROR: insert failed for upsert <node /> ${node.properties.id} in file ${filename}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)

      // if (e.code === 'CONNECT_TIMEOUT') {
        await sleep(10);
        await upsertNode(node);
      // }
    }
  }

  osmXmlParser.on('node', async (node: TagData) => {
    // if (count % LOG_INCREMENT === 0) {
    //   logger.info(`FOUND <node>: upsert node ${JSON.stringify(node.properties)}`, filename);
    // }
    await upsertNode(node);
    node.children?.forEach(async (tag) => {
      try {
        if (count % LOG_INCREMENT === 0) {
          logger.info(`FOUND <tag>: upsert <tag /> with key = ${tag.properties.k} and value = ${tag.properties.v} for node id ${node.properties.id}`, filename);
        }
        db.upsert({
          sql,
          table: 'osm_meta_tags',
          data: {
            node_id: node.properties.id,
            k: tag.properties.k,
            v: tag.properties.v,
          },
          conflict: [
            'node_id',
            'k'
          ],
          updateFields: [
            'v',
          ],
        });
      }
      catch (e) {
        logger.error(`POSTGRES ERROR: insert failed for upsert <tag /> where k = ${tag.properties.key}, v = ${tag.properties.v}, node.id = ${node.properties.id}. original tag: ${tag.tag} in file ${filename}`);
        logger.error(`--> currentByte: ${currentByte} - ${filename}`)
      }
    })
  });

  osmXmlParser.on('way', async (way) => {
    // if (count % LOG_INCREMENT === 0) {
    //   logger.info(`FOUND <way>: ${JSON.stringify(way.properties)}`, filename);
    // }
    try {
      await db.upsert({
        sql,
        table: 'osm_ways',
        data: {
          id: way.properties.id,
          timestamp: way.properties.timestamp,
          version: way.properties.version
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
      logger.error(`POSTGRES ERROR: insert failed for upsert <way /> ${way.properties.id} in file ${filename}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)
    }
    const ndElements = way.children?.filter((child) => child.name === 'nd');
    const tagElements = way.children?.filter((child) => child.name === 'tag');
    ndElements?.forEach(async (nd, i) => {
      try {
        // if (count % LOG_INCREMENT === 0) {
        //   logger.info(`FOUND <nd>: upsert <nd /> where ref = ${nd.properties.ref} and way id = ${way.properties.id}`, filename);
        // }
        db.insert({
          sql,
          table: 'osm_ways_nodes',
          data: {
            way_id: way.properties.id,
            node_id: nd.properties.ref,
            order: i + 1,
          },
        })
      }
      catch(e) {
        logger.error(`POSTGRES ERROR: insert failed for upsert <nd /> ${nd.properties.id}. original tag: ${nd.tag} in file ${filename}`);
        logger.error(`--> currentByte: ${currentByte} - ${filename}`)
      }
    })
    tagElements?.forEach(async (tag, i) => {
      try {
        // if (count % LOG_INCREMENT === 0) {
        //   logger.info(`FOUND <tag>: upsert <tag /> where key = ${tag.properties.k} and value = ${tag.properties.v} and way id = ${way.properties.id}`, filename);
        // }
        db.upsert({
          sql,
          table: 'osm_meta_tags',
          data: {
            way_id: way.properties.id,
            k: tag.properties.k,
            v: tag.properties.v.trim(),
          },
          conflict: [
            'way_id',
            'k'
          ],
          updateFields: [
            'v',
          ],
        });
      }
      catch(e) {
        logger.error(`POSTGRES ERROR: insert failed for upsert <tag /> where k = ${tag.properties.key}, v = ${tag.properties.v}, way.id = ${way.properties.id}. original tag: ${tag.tag} in filename ${filename}`);
        logger.error(`--> currentByte: ${currentByte} - ${filename}`)
      }
    })
  });

  osmXmlParser.on('relation', async (relation) => {
    // if (count % LOG_INCREMENT === 0) {
    //   logger.info(`FOUND <relation>: ${JSON.stringify(relation)}`);
    // }
    try {
      await db.upsert({
        sql,
        table: 'osm_relations',
        data: {
          id: relation.properties.id,
          timestamp: relation.properties.timestamp,
          version: relation.properties.version
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
      logger.error(`POSTGRES ERROR: insert failed for upsert <relation /> ${relation.properties.id}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)
    }
    const memberElements = relation.children?.filter((child) => child.name === 'member');
    const tagElements = relation.children?.filter((child) => child.name === 'tag');
    try {
      await db.remove({
        sql,
        table: 'osm_relations_members',
        conditions: {
          relation_id: relation.properties.id,
        }
      });
    }
    catch (e) {
      logger.error(`POSTGRES ERROR: remove failed for delete member nodes from ${relation.properties.id} in file ${filename}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)
    }
    memberElements?.forEach(async (member, i) => {
      try {
        // if (count % LOG_INCREMENT === 0) {
        //   logger.info(`FOUND <member>: upsert <member /> where ref = ${member.properties.ref} and relation id = ${relation.properties.id}`, filename);
        // }
        db.insert({
          sql,
          table: 'osm_relations_members',
          data: {
            way_id: member.properties.type === 'way' ? member.properties.ref : null,
            node_id: member.properties.type === 'node' ? member.properties.ref : null,
            role: member.properties.role,
          },
        });
      }
      catch (e) {
        logger.error(`POSTGRES ERROR: insert failed for upsert <member /> ${member.properties.id}. original tag: ${member.tag} in file ${filename}`);
        logger.error(`--> currentByte: ${currentByte} - ${filename}`)
      }
    });
    tagElements?.forEach(async (tag) => {
      try {
        // if (count % LOG_INCREMENT === 0) {
        //   logger.info(`FOUND <tag>: upsert <tag /> where k = ${tag.properties.k}, v = ${tag.properties.v}, relation.id = ${relation.properties.id}`, filename);
        // }
        db.upsert({
          sql,
          table: 'osm_meta_tags',
          data: {
            relation_id: relation.properties.id,
            k: tag.properties.k,
            v: tag.properties.v.trim(),
          },
          conflict: [
            'relation_id',
            'k'
          ],
          updateFields: [
            'v',
          ],
        });
      }
      catch (e) {
        logger.error(`POSTGRES ERROR: insert failed for upsert <tag /> where k = ${tag.properties.key}, v = ${tag.properties.v}, relation.id = ${relation.properties.id}. original tag: ${tag.tag} in file ${filename}`);
        logger.error(`--> currentByte: ${currentByte} - ${filename}`)
      }
    });
  });

  osmXmlParser.on('tag', (element) => {
    logger.info(`FOUND <tag />: ${JSON.stringify(element)}`);
  });

  osmXmlParser.on('nd', (element) => {
    logger.info(`FOUND <nd />: ${JSON.stringify(element)}`);
  });

  await connect();

  readableStream
    .on('data', async (chunk) => {
      currentByte += chunk.length;

      if (count % LOG_INCREMENT === 0) {
        logger.info(`CHUNK COUNT: ${count} in file ${filename}`);
      }

      count++;
      readableStream.pause();
      setTimeout(async () => {
        osmXmlParser.handleChunk(chunk.toString());
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

osm(filename, start, end);

export default osm;
