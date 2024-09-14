#!/bin/sh

# Set the current directory to the directory the script is in
cd "$(dirname "$0")"

stage="$1"
filename="$2"
echo $stage

if [ ! $stage ]; then
  echo "No stage argument provided; exiting"
  echo "Usage: $0 --stage stage --filename filename"
  echo -e "\t--stage Stage must be one of 'elements' or 'tags'"
  echo -e "\t--filename Filename must be a valid file in the /data folder"
  exit 1
fi

if [ ! $filename ]; then
  echo "No filename argument provided; exiting"
  echo "Usage: $0 --stage stage --filename filename"
  echo -e "\t--stage Stage must be one of 'elements' or 'tags'"
  echo -e "\t--filename Filename must be a valid file in the /data folder"
  exit 1
fi

if [ "$stage" = "elements" ]; then
  node --env-file=.env.production ./elements.mjs $filename
elif [ "$stage" = "tags" ]; then
  node --env-file=.env.production ./tags.mjs $filename
else
  echo "Invalid stage passed to osm.sh; must be either 'elements' or 'tags'";
  echo "Usage: $0 --stage stage --filename filename"
  echo -e "\t--stage Stage must be one of elements or tags"
  echo -e "\t--filename Filename must be a valid file in the /data folder"
  exit 1
fi
