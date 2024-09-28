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

  async function saveMember({
    member,
    relation,
    tryCount = 0
  }: {
    member: TagData;
    relation: TagData;
    tryCount?: number;
  }) {
    if (tryCount > 0) {
      logger.warn(`RETRY: saveMember, count ${tryCount}`)
    }
    if (tryCount > 10) {
      logger.error(`FAILED: Max retries exceeded for save <member /> with role ${member.properties.role} and <relation /> id ${relation.properties.id}`);
      return;
    }
    try {
      db.insert({
        sql,
        table: 'osm_relations_members',
        data: {
          way_id: member.properties.type === 'way' ? member.properties.ref : null,
          node_id: member.properties.type === 'node' ? member.properties.ref : null,
          role: member.properties.role,
        },
      });
      if (tryCount > 0) {
        logger.info(`RETRY SUCCEEDED: <member /> role ${member.properties.role}`)
      }
    }
    catch (e) {
      logger.error(`POSTGRES ERROR: insert failed for upsert <member /> ${member.properties.role}. original tag: ${member.tag} in file ${filename}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)

      if (e.code === 'CONNECT_TIMEOUT') {
        await sleep(10);
        await saveMember({ relation, member, tryCount: tryCount + 1});
      }
    }
  }

  async function deleteMembers({
    relation,
    tryCount = 0
  }: {
    relation: TagData;
    tryCount?: number;
  }) {
    if (tryCount > 0) {
      logger.warn(`RETRY: deleteMembers, count ${tryCount}`)
    }
    if (tryCount > 10) {
      logger.error(`FAILED: Max retries exceeded for delete members from <relation /> id ${relation.properties.id}`);
      return;
    }
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
      logger.error(`POSTGRES ERROR: delete members failed for <relation /> ${relation.properties.id}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)

      if (e.code === 'CONNECT_TIMEOUT') {
        await sleep(10);
        await deleteMembers({ relation, tryCount: tryCount + 1});
      }
    }
  }

  async function saveRelation({
    relation,
    tryCount = 0
  }: {
    relation: TagData;
    tryCount?: number;
  }) {
    if (tryCount > 0) {
      logger.warn(`RETRY: saveRelation, count ${tryCount}`)
    }
    if (tryCount > 10) {
      logger.error(`FAILED: Max retries exceeded for <relation /> id ${relation.properties.id}`);
      return;
    }
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
      if (tryCount > 0) {
        logger.info(`RETRY SUCCEEDED: <relation /> id ${relation.properties.id}`)
      }
    }
    catch (e) {
      logger.error(`POSTGRES ERROR: insert failed for upsert <relation /> ${relation.properties.id}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)

      if (e.code === 'CONNECT_TIMEOUT') {
        await sleep(10);
        await saveRelation({ relation, tryCount: tryCount + 1});
      }
    }
  }

  async function saveWay({
    way,
    tryCount = 0
  }: {
    way: TagData,
    tryCount?: number,
  }) {
    try {
      if (tryCount > 0) {
        logger.warn(`RETRY: saveWay, count ${tryCount}`)
      }
      if (tryCount > 10) {
        logger.error(`FAILED: Max retries exceeded for <way /> id ${way.properties.id}`);
        return;
      }
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
      });
      if (tryCount > 0) {
        logger.info(`RETRY SUCCEEDED: <way /> id ${way.properties.id}`)
      }
    }
    catch (e) {
      logger.error(`POSTGRES ERROR: upsert failed for <way /> ${way.properties.id} in file ${filename}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`);

      if (e.code === 'CONNECT_TIMEOUT') {
        await sleep(10);
        await saveWay({ way, tryCount: tryCount + 1});
      }
    }
  }

  async function saveNd({
    nd,
    way,
    index,
    tryCount = 0
  }: {
    nd: TagData,
    way: TagData,
    index: number,
    tryCount?: number
  }) {
    if (tryCount > 0) {
      logger.warn(`RETRY: saveNd, count ${tryCount}`)
    }
    if (tryCount > 10) {
      logger.error(`FAILED: Max retries exceeded for <nd /> with ref ${nd.properties.ref} with way id ${way.properties.id}`);
      return;
    }
    try {
      await db.insert({
        sql,
        table: 'osm_ways_nodes',
        data: {
          way_id: way.properties.id,
          node_id: nd.properties.ref,
          order: index + 1,
        },
      })
      if (tryCount > 0) {
        logger.info(`RETRY SUCCEEDED: <nd /> id ${nd.properties.id}`)
      }
    }
    catch(e) {
      logger.error(`POSTGRES ERROR: insert failed for <nd /> with ref ${nd.properties.ref}. original tag: ${nd.tag} in file ${filename}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)

      if (e.code === 'CONNECT_TIMEOUT') {
        await sleep(10);
        await saveNd({ way, nd, index, tryCount: tryCount + 1});
      }
    }
  }

  async function saveNode({
    node,
    tryCount = 0
  }:
  {
    node: TagData,
    tryCount?: number
  }) {
    if (tryCount > 0) {
      logger.warn(`RETRY: saveNode, count ${tryCount}`)
    }
    if (tryCount > 10) {
      logger.error(`FAILED: Max retries exceeded for <node /> id ${node.properties.id}`);
      return;
    }
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
      if (tryCount > 0) {
        logger.info(`RETRY SUCCEEDED: <node /> id ${node.properties.id}`)
      }
    }
    catch (e) {
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)

      if (e.code === 'CONNECT_TIMEOUT') {
        await sleep(10);
        await saveNode({ node, tryCount: tryCount + 1});
      }
    }
  }

  async function saveTag(
    {
      node,
      way,
      relation,
      tag,
      tryCount = 0
    }:
    {
      node?: TagData;
      way?: TagData;
      relation?: TagData;
      tag: TagData;
      tryCount?: number;
    }) {
    if (tryCount > 0) {
      logger.warn(`RETRY: saveTag, count ${tryCount}`)
    }
    if (tryCount > 10) {
      logger.error(`FAILED: Max retries exceeded for <tag /> id ${tag.properties.id} with way id ${way?.properties.id || null} or node id ${node?.properties.id || null} or relation ${relation?.properties.id || null}`);
      return;
    }
    try {
      await db.upsert({
        sql,
        table: 'osm_meta_tags',
        data: {
          node_id: node?.properties.id || null,
          way_id: way?.properties.id || null,
          relation_id: relation?.properties.id || null,
          k: tag.properties.k,
          v: tag.properties.v.trim(),
        },
        conflict: way 
        ? [ 'way_id', 'k' ] 
        : node
          ? [ 'node_id', 'k' ]
          : [ 'relation_id', 'k' ],
        updateFields: [
          'v',
        ],
      });
      if (tryCount > 0) {
        logger.info(`RETRY SUCCEEDED: <tag /> key ${tag.properties.k}, node.id = ${node?.properties.id || null}, way.id=${way?.properties.id || null}, relation.id=${relation?.properties.id || null}`);
      }
    }
    catch (e) {
      logger.error(`POSTGRES ERROR: insert failed for upsert <tag /> where k = ${tag.properties.k}, v = ${tag.properties.v}, node.id = ${node?.properties.id || null}, way.id=${way?.properties.id || null}, relation.id=${relation?.properties.id || null}. original tag: ${tag.tag} in file ${filename}`);
      logger.error(`--> currentByte: ${currentByte} - ${filename}`)

      if (e.code === 'CONNECT_TIMEOUT') {
        await sleep(10);
        await saveTag({ tag, node, relation, tryCount: tryCount + 1 });
      }
    }
  }

  osmXmlParser.on('node', async (node: TagData) => {
    if (count % LOG_INCREMENT === 0) {
      logger.info(`FOUND <node>: upsert node ${JSON.stringify(node.properties)}`, filename);
    }
    await saveNode({node});
    node.children?.forEach(async (tag) => {
      if (count % LOG_INCREMENT === 0) {
        logger.info(`FOUND <tag>: upsert <tag /> with key = ${tag.properties.k} and value = ${tag.properties.v} for node id ${node.properties.id}`, filename);
      }
      saveTag({node, tag})
    })
  });

  osmXmlParser.on('way', async (way) => {
    if (count % LOG_INCREMENT === 0) {
      logger.info(`FOUND <way>: ${JSON.stringify(way.properties)}`, filename);
    }
    await saveWay({way});
    logger.info(`SAVED <way>: ${JSON.stringify(way.properties)}`, filename);
    if (count % LOG_INCREMENT === 0) {
      logger.info(`--> currentByte: ${currentByte} - ${filename}`)
    }

    const ndElements = way.children?.filter((child) => child.name === 'nd');
    const tagElements = way.children?.filter((child) => child.name === 'tag');
    ndElements?.forEach(async (nd, i) => {
      if (count % LOG_INCREMENT === 0) {
        logger.info(`FOUND <nd>: upsert <nd /> where ref = ${nd.properties.ref} and way id = ${way.properties.id}`, filename);
      }
      saveNd({way, nd, index: i});
    })
    tagElements?.forEach(async (tag) => {
      if (count % LOG_INCREMENT === 0) {
        logger.info(`FOUND <tag>: upsert <tag /> where key = ${tag.properties.k} and value = ${tag.properties.v} and way id = ${way.properties.id}`, filename);
      }
      saveTag({way, tag});
    })
  });

  osmXmlParser.on('relation', async (relation) => {
    if (count % LOG_INCREMENT === 0) {
      logger.info(`FOUND <relation>: ${JSON.stringify(relation)}`);
    }
    await saveRelation({relation});
    const memberElements = relation.children?.filter((child) => child.name === 'member');
    const tagElements = relation.children?.filter((child) => child.name === 'tag');
    await deleteMembers({relation});
    memberElements?.forEach(async (member, i) => {
      if (count % LOG_INCREMENT === 0) {
        logger.info(`FOUND <member>: upsert <member /> where ref = ${member.properties.ref} and relation id = ${relation.properties.id}`, filename);
      }
      saveMember({member, relation});
    });
    tagElements?.forEach(async (tag) => {
      saveTag({relation, tag});
    });
  });

  osmXmlParser.on('tag', (element) => {
    logger.info(`FOUND <tag />: ${JSON.stringify(element)}`);
  });

  osmXmlParser.on('nd', (element) => {
    logger.info(`FOUND <nd />: ${JSON.stringify(element)}`);
  });

  await connect();

  let timeoutId;

  readableStream
    .on('data', async (chunk) => {
      currentByte += chunk.length;

      if (count % LOG_INCREMENT === 0) {
        logger.info(`CHUNK COUNT: ${count} in file ${filename}`);
        logger.error(`--> currentByte: ${currentByte} - ${filename}`)
      }

      count++;
      readableStream.pause();
      timeoutId = setTimeout(async () => {
        osmXmlParser.handleChunk(chunk.toString());
        readableStream.resume();
      }, 60);
    })
    .on('error', (e) => {
      logger.error(`ERROR: elements - stream read error in file ${filename} at byte ${currentByte}`, e);
    })
    .on('end', () => {
      logger.info(`COMPLETE: elements - stream processing complete for file ${filename}`);
      readableStream.close();
      clearTimeout(timeoutId);
    });
}

osm(filename, start, end);

export default osm;
