#!/bin/sh

# Set the current directory to the directory the script is in
cd "$(dirname "$0")"

filename="$1"
start="$2"
end="$3"

if [ ! $filename ]; then
  echo "No filename argument provided; exiting"
  echo "Usage: $0 --filename filename"
  echo -e "\t--filename Filename must be a valid file in the /data folder"
  exit 1
fi

npx tsx ./osm.ts $filename $start $end
# npx tsx --trace_gc --inspect ./osm.ts $filename $start $end
