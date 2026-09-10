const axios = require('axios');
const fs = require('fs');

const chunkNames = [
  'webpack-07b596847c4b816a.js',
  'fd9d1056-070f637fb298209b.js',
  '2117-7a3ecb39a740ebe5.js',
  'main-app-5294d1645fe5526e.js',
  '13b76428-62a6e4bbed6f1919.js',
  'aaea2bcf-b350f97bed25f4e3.js',
  '8711-bb461a8072989fdc.js',
  '2972-7d6c95ffbdde952d.js',
  '7317-eea6b1c9a3819c5f.js',
  '5991-0668177ee26767cd.js',
  '254-c4c61c9eb5598bb6.js',
  '5878-362fa44db3e7858e.js',
  '4116-d379b316d55a7561.js',
  '7218-5c1fd760fd696f4b.js',
  '4152-53888c4dc579445e.js',
  '9576-a75f896200443f60.js',
  '1668-eceef460fdc61513.js',
  '8366-ecf5805d5be740e1.js',
  '3095-74056d42c449b19d.js',
  '9082-4eeebe960057aa30.js',
  '1465-2d1e94a272c2d483.js',
  '7157-500d6eb1c517469c.js',
  '1926-d16c216dd0cf4594.js',
  '342-1b8fb21cc9cca3cf.js',
  '2658-756e5987cc414048.js',
  '1158-0ccb7ce97387ac88.js',
  '3956-cb6822db4d7d9d9e.js',
  'app/layout-633a23a514e25640.js',
  '2910-9bb304abdaaa0e34.js',
  'app/page-ad07e45d068c3d86.js',
  '0e5ce63c-a130e4df6d17de13.js',
  'bc9c3264-0ccc1216cbce768a.js',
  '164f4fb6-b7273b01edcf82a9.js',
  '5850-077e7a5a75838dfd.js',
  '4588-3be14196fd6119f1.js',
  '6447-df844bb00ae9433f.js',
  '9320-e00cd7a11fcf345b.js'
];

async function checkChunk(chunk) {
  const url = `https://www.tender247.com/auth/_next/static/chunks/${chunk}`;
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      timeout: 8000
    });
    
    // Check if the chunk contains archiveApi
    const index = res.data.indexOf('archiveApi');
    const indexRoute = res.data.indexOf('RouteUrls');
    if (index !== -1 || indexRoute !== -1) {
      console.log(`\n*** Chunk ${chunk} contains match! ***`);
      if (index !== -1) {
        console.log(`archiveApi found at ${index}`);
        console.log(res.data.slice(index - 100, index + 300));
      }
      if (indexRoute !== -1) {
        console.log(`RouteUrls found at ${indexRoute}`);
        console.log(res.data.slice(indexRoute - 50, indexRoute + 400));
      }
    }
  } catch (err) {
    // ignore fetch errors
  }
}

async function run() {
  console.log("Checking chunks for archiveApi and RouteUrls...");
  for (const chunk of chunkNames) {
    await checkChunk(chunk);
  }
  console.log("\nFinished checking chunks.");
}

run();
