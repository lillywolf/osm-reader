import crypto from 'crypto';

type TagData = {
  name: string;
  properties: Record<string, string>;
  tag: string;
  lastIndex: number;
  index: number;
  chunkId: string;
};

class OSMXmlParser {
  currentParentTag: TagData | null;
  callbackMap: Record<string, (element: object) => any>;
  leftoverChunk: string;

  constructor() {
    this.callbackMap = {};
  }

  handleChunk(chunk: string) {
    const chunkId = crypto.randomBytes(10).toString('hex');

    // If there is a chunk left over from the last run
    // Append it to the current chunk
    if (this.leftoverChunk) {
      chunk = this.leftoverChunk + chunk;
      this.leftoverChunk = '';
    }

    if (!this.currentParentTag) {
      // Get the next open parent tag
      const openParent = getOpenTag(chunk);

      // If none found, get the rest of the chunk
      // To append to the next incoming chunk
      if (!openParent.tag) {
        this.leftoverChunk = chunk;
        return;
      };

      // If the tag is the parent <?xml> tag
      if (openParent.tag.match(/<\?(\w*) (.*)\?>/)) {
        this.handleChunk(chunk.slice(openParent.lastIndex).toString());
        return;
      };

      // Get the parent tag's properties string
      const openParentData = getTagPropertiesString(openParent.tag);

      if (!openParentData) {
        console.error(`ERROR: error getting data for parent tag`, openParent.tag);
        return;
      }

      // Parse each parent tag property string
      const properties = getTagProperties(openParentData.propertiesString, openParent.tag);

      // Set the currentParentTag to the newly found parent tag
      this.currentParentTag = {
        ...openParent,
        name: openParentData.name,
        properties,
        chunkId,
      } as TagData;
    }

    // Match the next closing parent tag
    const closingParent = getClosingTag(chunk.slice(this.getCurrentParentLastIndex(chunkId)).toString());

    // If none found, break out of the processing sequence
    if (!closingParent.tag) {
      this.leftoverChunk = chunk.slice(this.currentParentTag.index);
      return;
    };

    if (!this.callbackMap[this.currentParentTag.name]) {
      console.error(`ERROR: No callback found for tagName`, this.currentParentTag.name);
      return;
    }

    // Call the callback registered for the tag
    this.callbackMap[this.currentParentTag.name](this.currentParentTag);

    // Get the string inside the parent tag
    const parentTagInnerString = chunk.slice(this.currentParentTag.lastIndex, closingParent.index).toString();

    // Parse the child tags out of the inner string
    // const childTagRegex = new RegExp(/<(.*)\/>/);
    const childTags = parentTagInnerString.match(/<(.*)\/>/g);

    // Get the child tags' properties
    childTags?.forEach((childTag) => {
      let childData = getTagPropertiesString(childTag);

      if (!childData) {
        console.error(`ERROR: error getting properties string for child tag`, childTag);
        return;
      }

      const childProperties = getTagProperties(childData.propertiesString, childTag);

      this.callbackMap[childData.name](childProperties);
    });

    // Get the next chunk and pass it into the recursive function
    const newChunk = chunk.toString().slice(this.getCurrentParentLastIndex(chunkId) + closingParent.lastIndex).toString();

    this.currentParentTag = null;
    this.handleChunk(newChunk);
  }

  on(tagName: string, callback: (element: object) => any) {
    this.callbackMap[tagName] = callback;
  }

  getCurrentParentLastIndex(chunkId: string) {
    if (this.currentParentTag?.chunkId === chunkId) return this.currentParentTag.lastIndex;

    return 0;
  }
}

function getOpenTag(chunk: string) {
  const regex = new RegExp(/(<[^/]*>)/, 'g');
  const execResult = regex.exec(chunk);

  return {
    tag: execResult?.[0],
    lastIndex: regex.lastIndex,
    index: execResult?.index,
  };
}

function getClosingTag(chunk: string) {
  const regex = new RegExp(/<\/(.*)>/, 'g');
  const execResult = regex.exec(chunk);
  
  return {
    tag: execResult?.[0],
    lastIndex: regex.lastIndex,
    index: execResult?.index,
  };
}

function getTagPropertiesString(tag: string) {
  const deconstructedTag = /<(\w*) (.*)>/.exec(tag);
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
    const [key, value] = pair.split('=');

    if (!key || !value) {
      console.error(`ERROR: error reading key/value pairs in tag`, pair, tag);
      return acc;
    }

    return {
      ...acc,
      [key]: value.match(/(?<=")(.*?)(?=")/)?.[0],
    }
  }, {}) as Record<string, string>;
}

export default OSMXmlParser;
