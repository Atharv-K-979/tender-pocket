import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

async function findModule() {
  const logPath = path.join(__dirname, 'trace-output-post.txt');
  const logContent = fs.readFileSync(logPath, 'utf8');

  // Find all URLs ending with .js
  const regex = /https?:\/\/[^\s]+?\.js/gi;
  const matches = logContent.match(regex) || [];
  
  // Deduplicate URLs
  const scripts = Array.from(new Set(matches));

  console.log(`Found ${scripts.length} JS scripts from log to search.`);

  const targetModule = "79726";

  for (const src of scripts) {
    if (!src.includes('_next/static/chunks')) continue;
    try {
      const res = await axios.get(src);
      const code = res.data;
      
      // Look for targetModule as a key in webpack object definition
      const patterns = [
        new RegExp(`["']?${targetModule}["']?\\s*:\\s*function`, 'i'),
        new RegExp(`["']?${targetModule}["']?\\s*:\\s*\\(`, 'i')
      ];
      
      let found = false;
      for (const p of patterns) {
        if (p.test(code)) {
          found = true;
          break;
        }
      }
      
      if (found) {
        console.log(`\n🎉 FOUND Module ${targetModule} in script: ${src}`);
        const idx = code.indexOf(targetModule);
        console.log(code.substring(idx - 50, idx + 6000));
        break;
      }
    } catch (err: any) {
      // console.error(`Error loading ${src}:`, err.message);
    }
  }
}

findModule().catch(console.error);
