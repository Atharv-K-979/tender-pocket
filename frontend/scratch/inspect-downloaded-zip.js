const fs = require('fs');
const JSZip = require('jszip');

async function run() {
  const content = fs.readFileSync('scratch/downloaded-all-docs.zip');
  try {
    const zip = new JSZip();
    const zipData = await zip.loadAsync(content);
    console.log("Files in ZIP:");
    for (const [filename, file] of Object.entries(zipData.files)) {
      console.log(`- ${filename} (dir: ${file.dir}, size: ${file._data ? file._data.uncompressedSize : 'unknown'})`);
    }
  } catch (err) {
    console.error("ZIP load failed:", err.message);
  }
}

run();
