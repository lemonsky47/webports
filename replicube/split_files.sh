#!/bin/bash
# Script to compress and split index.pck into 50MB chunks for GitHub storage

set -e

# Configuration
SOURCE_FILE="indexog.pck"
CHUNK_SIZE="19M"
OUTPUT_PREFIX="index.pck"

echo "Starting compression and splitting process..."

# Check if source file exists
if [ ! -f "$SOURCE_FILE" ]; then
    echo "Error: $SOURCE_FILE not found!"
    exit 1
fi

# Compress the file
echo "Compressing $SOURCE_FILE..."
gzip -c "$SOURCE_FILE" > "$OUTPUT_PREFIX"

# Get the original file size for metadata
ORIGINAL_SIZE=$(stat -c%s "$SOURCE_FILE")
COMPRESSED_SIZE=$(stat -c%s "$OUTPUT_PREFIX")
echo "Original size: $ORIGINAL_SIZE bytes"
echo "Compressed size: $COMPRESSED_SIZE bytes"
echo "Compression ratio: $(echo "scale=2; $COMPRESSED_SIZE * 100 / $ORIGINAL_SIZE" | bc)%"

# Split into chunks
echo "Splitting into $CHUNK_SIZE chunks..."
split -b "$CHUNK_SIZE" -d "$OUTPUT_PREFIX" "${OUTPUT_PREFIX}.part" --additional-suffix=""

# Rename chunks to have proper numbering (001, 002, etc.)
for file in ${OUTPUT_PREFIX}.part*; do
    # Extract the number and force it to be base-10
    num=$(echo "$file" | sed "s/.*part//")
    clean_num=$((10#$num))

    # Pad with zeros to make it 3 digits
    padded=$(printf "%03d" $clean_num)

    # Rename
    mv "$file" "${OUTPUT_PREFIX}.part${padded}"
done

# Create manifest file
echo "Creating manifest..."
cat > "chunks_manifest.json" <<EOF
{
  "originalFile": "$SOURCE_FILE",
  "originalSize": $ORIGINAL_SIZE,
  "compressedSize": $COMPRESSED_SIZE,
  "chunks": [
EOF

# List all chunk files and add to manifest
FIRST=1
for chunk in ${OUTPUT_PREFIX}.part*; do
    if [ $FIRST -eq 0 ]; then
        echo "," >> chunks_manifest.json
    fi
    FIRST=0
    SIZE=$(stat -c%s "$chunk")
    echo -n "    {\"name\": \"$chunk\", \"size\": $SIZE}" >> chunks_manifest.json
done

cat >> "chunks_manifest.json" <<EOF

  ]
}
EOF

# Clean up the combined compressed file (we only need the parts)
rm "$OUTPUT_PREFIX"

echo ""
echo "Process complete!"
echo "Created $(ls ${OUTPUT_PREFIX}.part* | wc -l) chunks:"
ls -lh ${OUTPUT_PREFIX}.part*

echo ""
echo "You can now commit these chunk files to GitHub:"
echo "  - ${OUTPUT_PREFIX}.part001, ${OUTPUT_PREFIX}.part002, etc."
echo "  - chunks_manifest.json"
echo ""
echo "Keep the original $SOURCE_FILE locally for testing, but add it to .gitignore"
