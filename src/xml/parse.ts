import crypto from 'crypto';
import truthyFilter from '../util/truthyFilter';
import Logger from '../logger';

export type TagData = {
  name: string;
  properties: Record<string, string>;
  tag: string;
  lastIndex?: number;
  index?: number;
  chunkId?: string;
  children?: TagData[];
};

export type ParentTagData = {
  tag: string;
  lastIndex: number;
  index: number;
}

class OSMXmlParser {
  currentParentTag: TagData | null;
  callbackMap: Record<string, (element: TagData) => any>;
  chunk: string;

  constructor() {
    this.callbackMap = {};
    this.chunk = '';
  }

  handleChunk(_chunk: string = '') {
    const logger = Logger.getInstance();
    const chunkId = crypto.randomBytes(10).toString('hex');

    // If there is a chunk left over from the last run
    // Append it to the current chunk
    this.chunk = this.chunk + _chunk;

    if (!this.chunk.length) return;

    if (!this.currentParentTag) {
      // Get the next parent tag
      const nextParent = getNextParentTag(this.chunk);

      // If none found, exit early
      // Note that _chunk has already been appended to this.chunk
      if (!nextParent) return;

      // If the tag is the parent <?xml> tag
      if (nextParent.tag.match(/<\?(\w*) (.*)\?>/)) {
        this.chunk = this.chunk.slice(nextParent.lastIndex);
        this.handleChunk();
        return;
      };

      let decorated;

      try {
        // @ts-ignore
        decorated = this.appendPropertiesToParentTag(nextParent);

        if (isClosed(nextParent.tag)) {
          // Call the callback registered for the tag
          this.callbackMap[decorated.name](decorated);
    
          // Proceed to recurse early
          this.chunk = this.chunk.slice(decorated.lastIndex);
          this.handleChunk();
          return;
        }
      }
      catch (e) {
        logger.error(e);
        return;
      }

      // Set the currentParentTag to the newly found parent tag
      this.currentParentTag = {
        ...decorated,
        chunkId,
      } as TagData;
    }

    // Match the next closing parent tag
    const chunkAfterParentTag = this.chunk.slice(this.getCurrentParentLastIndex(chunkId));
    const closingParent = getClosingTag(chunkAfterParentTag);

    // If none found, break out of the processing sequence
    if (!closingParent) {
      this.chunk = this.chunk.slice(this.currentParentTag.index);
      return;
    };

    // Get the string inside the parent tag
    const chunkInsideParentTag = chunkAfterParentTag.slice(0, closingParent.index);

    // Parse the child tags out of the inner string
    // const childTagRegex = new RegExp(/<(.*)\/>/);
    const childTags = chunkInsideParentTag.match(/<(.*)\/>/g);

    // Get the child tags' properties
    this.currentParentTag.children = childTags?.map((childTag) => {
      let childData = getClosedTagPropertiesString(childTag);

      if (!childData) {
        logger.error(`ERROR: error getting properties string for child tag`, childTag);
        return null;
      }

      const childProperties = getTagProperties(childData.propertiesString, childTag);

      return {
        tag: childTag,
        name: childData.name,
        lastIndex: 0,
        index: 0,
        properties: childProperties,
        chunkId
      };
    })
    .filter(truthyFilter);

    if (!this.callbackMap[this.currentParentTag.name]) {
      logger.error(`ERROR: No callback found for tagName`, this.currentParentTag.name);
      return;
    }

    // Call the callback registered for the tag
    this.callbackMap[this.currentParentTag.name](this.currentParentTag);

    // Get the next chunk and pass it into the recursive function
    this.chunk = this.chunk.slice(this.getCurrentParentLastIndex(chunkId) + closingParent.lastIndex);

    this.currentParentTag = null;
    this.handleChunk();
  }

  on(tagName: string, callback: (element: TagData) => any) {
    this.callbackMap[tagName] = callback;
  }

  appendPropertiesToParentTag(parentTag: ParentTagData) {
    const parentTagData = getOpenTagPropertiesString(parentTag.tag);

    if (!parentTagData) {
      throw new Error(`ERROR: error getting data for parent tag ${parentTag.tag}`);
    }

    // Parse each parent tag property string
    const properties = getTagProperties(parentTagData.propertiesString, parentTag.tag);

    return {
      ...parentTag,
      properties,
      name: parentTagData.name,
    };
  }

  getCurrentParentLastIndex(chunkId: string) {
    if (this.currentParentTag?.chunkId === chunkId) return this.currentParentTag.lastIndex || 0;

    return 0;
  }
}

function getOpenTag(chunk: string) {
  const regex = new RegExp(/(<[^/]*>)/, 'g');
  const execResult = regex.exec(chunk);

  if (!execResult?.[0]) return null;

  return {
    tag: execResult?.[0],
    lastIndex: regex.lastIndex,
    index: execResult?.index || 0,
  };
}

function getClosingTag(chunk: string) {
  const regex = new RegExp(/<\/(.*)>/, 'g');
  const execResult = regex.exec(chunk);

  if (!execResult?.[0]) return null;
  
  return {
    tag: execResult?.[0],
    lastIndex: regex.lastIndex,
    index: execResult?.index || 0,
  };
}

function getClosedTag(chunk: string) {
  const regex = new RegExp(/(<node[^/<]*\/>)/, 'g');
  const execResult = regex.exec(chunk);

  if (!execResult?.[0]) return null;

  return {
    tag: execResult?.[0],
    lastIndex: regex.lastIndex,
    index: execResult?.index || 0,
  };
}

function isClosed(tag: string): boolean {
  return Boolean(tag.match(/(<node[^/<]*\/>)/)?.[0]);
}

function getOpenTagPropertiesString(tag: string) {
  const deconstructedTag = /<(\w*) (.*)>/.exec(tag);
  const tagName = deconstructedTag?.[1];
  const tagProperties = deconstructedTag?.[2];

  if (!tagName || !tagProperties) return null;

  return {
    name: tagName,
    propertiesString: tagProperties
  };
}

function getClosedTagPropertiesString(tag: string) {
  const deconstructedTag = /<(\w*) (.*)\/>/.exec(tag);
  const tagName = deconstructedTag?.[1];
  const tagProperties = deconstructedTag?.[2];

  if (!tagName || !tagProperties) return null;

  return {
    name: tagName,
    propertiesString: tagProperties
  };
}

function getTagProperties(str: string, tag: string) {
  return str.match(/([^\s]*)="(.*?)"/g)?.reduce((acc, pair) => {
    const separated = /([^\s]*)="(.*?)"/g.exec(pair);
    const key = separated?.[1];
    const value = separated?.[2];

    if (!key || !value) {
      console.error(`ERROR: error reading key/value pairs in tag`, pair, tag);
      return acc;
    }

    return {
      ...acc,
      [key]: value,
    }
  }, {}) as Record<string, string>;
}

function getNextParentTag(chunk: string) {
  // Get the next closed parent tag
  const closedParent = getClosedTag(chunk);
  // Get the next open parent tag
  const openParent = getOpenTag(chunk);

  if (!closedParent && openParent) return openParent;
  if (!openParent && closedParent) return closedParent;
  if (!openParent && !closedParent) return null;
  if (closedParent && openParent) {
    return closedParent.index < openParent.index
      ? closedParent
      : openParent;
  }
}

export default OSMXmlParser;
